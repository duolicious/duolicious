"""The "Similar clubs" model: a person's club vector is the normalized sum of
their clubs' embeddings, recomputed whole (`Q_REFRESH_CLUB_VECTOR`) because
membership counts are tiny. The embeddings themselves are recomputed by the
clubembeddings cron, which sweeps everyone by `club_vector_computed_at`."""
from collections.abc import Mapping, Sequence

from serviceshared.commonsql import Q_REFRESH_CLUB_VECTOR
from serviceshared.tx import Tx
from serviceshared.matching.model import AnswerChange, Watch


class _SimilarClubsModel:
    name = 'similar_clubs'
    watched: Mapping[str, Watch] = {
        'person_club': Watch(inserts=True, deletes=True),
    }

    async def person_changed(
        self,
        tx: Tx,
        person_id: int,
        changes: Sequence[AnswerChange],
    ) -> None:
        await tx.execute(Q_REFRESH_CLUB_VECTOR, dict(person_id=person_id))


MODEL = _SimilarClubsModel()
