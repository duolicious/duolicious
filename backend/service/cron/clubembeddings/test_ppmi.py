import numpy
import unittest

from serviceshared.pgvector import parse_pgvector, to_pgvector
from service.cron.clubembeddings.ppmi import (
    DIMENSIONS,
    Membership,
    club_embeddings_from_memberships,
    changed_embeddings,
)

A_CLUBS = [f'a{i}' for i in range(6)]
B_CLUBS = [f'b{i}' for i in range(6)]


def community_memberships() -> list[Membership]:
    memberships: list[Membership] = []
    for person in range(20):
        for offset in range(3):
            memberships.append((person, A_CLUBS[(person + offset) % 6]))
        memberships.append((person, 'ubiquitous'))
    for person in range(20, 40):
        for offset in range(3):
            memberships.append((person, B_CLUBS[(person + offset) % 6]))
        memberships.append((person, 'ubiquitous'))
    memberships.append((40, 'lonely'))
    return memberships


def cosine(
    a: numpy.ndarray,
    b: numpy.ndarray,
) -> float:
    return float(
        a @ b / (numpy.linalg.norm(a) * numpy.linalg.norm(b))
    )


def person_vector(
    embeddings: dict[str, numpy.ndarray],
    clubs: list[str],
) -> numpy.ndarray:
    total = sum(
        (embeddings[c] for c in clubs if c in embeddings),
        numpy.zeros(DIMENSIONS, dtype=numpy.float32),
    )
    return total / numpy.linalg.norm(total)


class TestClubEmbeddings(unittest.TestCase):
    def test_empty_memberships_give_no_embeddings(self) -> None:
        self.assertEqual(club_embeddings_from_memberships([], {}), {})

    def test_pairless_memberships_give_no_embeddings(self) -> None:
        memberships: list[Membership] = [(0, 'a'), (1, 'b')]
        self.assertEqual(club_embeddings_from_memberships(memberships, {}), {})

    def test_communities_separate_and_pairless_clubs_are_omitted(self) -> None:
        embeddings = club_embeddings_from_memberships(
            community_memberships(), {})

        self.assertNotIn('lonely', embeddings)
        self.assertIn('ubiquitous', embeddings)

        within = [
            cosine(embeddings[a], embeddings[b])
            for a in A_CLUBS
            for b in A_CLUBS
            if a < b
        ]
        across = [
            cosine(embeddings[a], embeddings[b])
            for a in A_CLUBS
            for b in B_CLUBS
        ]
        self.assertGreater(min(within), max(across))

    def test_shared_niche_clubs_beat_a_shared_ubiquitous_club(self) -> None:
        embeddings = club_embeddings_from_memberships(
            community_memberships(), {})

        a_person = person_vector(embeddings, ['ubiquitous', 'a0', 'a1', 'a2'])
        a_person_2 = person_vector(embeddings, ['ubiquitous', 'a1', 'a2', 'a3'])
        b_person = person_vector(embeddings, ['ubiquitous', 'b0', 'b1', 'b2'])

        self.assertGreater(
            cosine(a_person, a_person_2),
            cosine(a_person, b_person),
        )

    def test_procrustes_alignment_stabilizes_reruns(self) -> None:
        memberships = community_memberships()
        first = club_embeddings_from_memberships(memberships, {}, seed=0)
        realigned = club_embeddings_from_memberships(
            memberships, first, seed=1)

        cosines = [
            cosine(first[name], realigned[name])
            for name in first
        ]
        self.assertGreater(float(numpy.mean(cosines)), 0.9)

    def test_pgvector_round_trip(self) -> None:
        vec = numpy.array([0.25, -1, 0, 1.5], dtype=numpy.float32)
        restored = parse_pgvector(to_pgvector(vec))
        self.assertTrue(numpy.array_equal(vec, restored))

    def test_unmoved_embeddings_are_not_rewritten(self) -> None:
        old = numpy.array([1, 0, 0, 0], dtype=numpy.float32)
        nudged = old * 1.0001
        rescaled = old * 1.5
        rotated = numpy.array([0, 1, 0, 0], dtype=numpy.float32)
        brand_new = numpy.array([0, 0, 1, 0], dtype=numpy.float32)

        changed = changed_embeddings(
            new=dict(
                unmoved=old,
                nudged=nudged,
                rescaled=rescaled,
                rotated=rotated,
                brand_new=brand_new,
            ),
            previous=dict(
                unmoved=old,
                nudged=old,
                rescaled=old,
                rotated=old,
            ),
        )

        self.assertEqual(
            sorted(changed), ['brand_new', 'rescaled', 'rotated'])

    def test_identical_reruns_produce_no_writes(self) -> None:
        memberships = community_memberships()
        first = club_embeddings_from_memberships(memberships, {})
        rerun = club_embeddings_from_memberships(memberships, first)

        changed = changed_embeddings(rerun, first)
        self.assertEqual(changed, {})
