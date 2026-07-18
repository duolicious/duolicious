from collections.abc import Awaitable, Callable
from unittest import mock
import io
import unittest

import service.cron.photocrop as photocrop
from duophoto.fixtures import jpeg, photo, renditions

class TestGeometryOf(unittest.TestCase):
    def test_recovers_the_geometry_of_a_matching_pair(self) -> None:
        original = photo(1200, 800, seed=1)
        original_bytes, square_bytes = renditions(original, crop_left=300, crop_top=0)

        geometry = photocrop._geometry_of(
            'uuid', io.BytesIO(original_bytes), io.BytesIO(square_bytes),
        )

        self.assertIsNotNone(geometry)
        assert geometry is not None
        self.assertEqual((geometry.width, geometry.height), (1200, 800))
        self.assertLessEqual(abs(geometry.crop_left - 300), 2)

    def test_skips_a_pair_that_matches_too_poorly(self) -> None:
        # A square that isn't from this photo. Recording a crop from it would
        # make the photo jump when expanded, so it must be left alone.
        original = jpeg(photo(1200, 800, seed=1))
        unrelated = jpeg(photo(800, 800, seed=2).resize((450, 450)))

        self.assertIsNone(
            photocrop._geometry_of('uuid', io.BytesIO(original), io.BytesIO(unrelated))
        )

    def test_skips_when_a_rendition_is_missing(self) -> None:
        original = io.BytesIO(jpeg(photo(1200, 800, seed=1)))

        self.assertIsNone(photocrop._geometry_of('uuid', original, None))
        self.assertIsNone(photocrop._geometry_of('uuid', None, original))

    def test_skips_a_photo_that_fails_to_decode(self) -> None:
        # PIL only decodes on use, so truncation surfaces during the match
        # rather than on open. It must be caught per photo, or the whole batch
        # would never be marked attempted and would be re-selected forever.
        original = jpeg(photo(1200, 800, seed=1))
        truncated = original[:len(original) // 2]

        self.assertIsNone(
            photocrop._geometry_of(
                'uuid', io.BytesIO(truncated), io.BytesIO(original),
            )
        )

# Records what was run against the DB, standing in for a real transaction.
class _FakeTx:
    def __init__(self) -> None:
        self.executed: list[tuple[str, dict[str, list[str]] | None]] = []
        self.executed_many: list[tuple[str, list[dict[str, str | int]]]] = []

    async def execute(
        self,
        query: str,
        params: dict[str, list[str]] | None = None,
    ) -> None:
        self.executed.append((query, params))

    async def executemany(
        self,
        query: str,
        seq: list[dict[str, str | int]],
    ) -> None:
        self.executed_many.append((query, seq))

class _FakeApiTx:
    def __init__(self, tx: _FakeTx) -> None:
        self._tx = tx

    async def __aenter__(self) -> _FakeTx:
        return self._tx

    async def __aexit__(self, *_: object) -> bool:
        return False

class TestBackfill(unittest.IsolatedAsyncioTestCase):
    def _download(
        self,
        originals: dict[str, bytes],
        squares: dict[str, bytes],
    ) -> Callable[[list[str], str], Awaitable[list[io.BytesIO | None]]]:
        # Mirrors cronutil.download_images: a rendition per uuid, or None if the
        # object is missing. Fresh BytesIO each call since PIL consumes them.
        async def download(uuids: list[str], prefix: str) -> list[io.BytesIO | None]:
            source = originals if prefix == 'original-' else squares
            return [
                io.BytesIO(source[u]) if u in source else None
                for u in uuids
            ]
        return download

    async def test_marks_the_whole_batch_even_when_a_photo_fails(self) -> None:
        # One recoverable photo, one whose square is unrelated to its original,
        # and one whose original doesn't decode. The bad ones must still be
        # marked attempted, or the queue - which selects
        # `crop_attempted_at IS NULL` - would hand them back forever.
        good_original, good_square = renditions(
            photo(1200, 800, seed=1), crop_left=300, crop_top=0,
        )
        bad_original = jpeg(photo(1200, 800, seed=3))
        bad_square = jpeg(photo(800, 800, seed=9).resize((450, 450)))
        corrupt_original = good_original[:len(good_original) // 2]

        uuids = ['good', 'bad', 'corrupt']
        originals = {
            'good': good_original,
            'bad': bad_original,
            'corrupt': corrupt_original,
        }
        squares = {
            'good': good_square,
            'bad': bad_square,
            'corrupt': good_square,
        }

        tx = _FakeTx()
        with mock.patch.object(photocrop, 'download_images', self._download(originals, squares)), \
             mock.patch.object(photocrop, 'api_tx', lambda: _FakeApiTx(tx)), \
             mock.patch.object(photocrop, 'DRY_RUN', False):
            await photocrop._backfill(uuids)

        # The whole batch is marked attempted...
        self.assertEqual(len(tx.executed), 1)
        _, params = tx.executed[0]
        assert params is not None
        self.assertEqual(set(params['uuids']), {'good', 'bad', 'corrupt'})

        # ...but only the recoverable photo's geometry is written.
        self.assertEqual(len(tx.executed_many), 1)
        _, written = tx.executed_many[0]
        self.assertEqual([row['uuid'] for row in written], ['good'])

    async def test_writes_geometry_for_a_recovered_photo(self) -> None:
        original, square = renditions(
            photo(1000, 640, seed=5), crop_left=200, crop_top=0,
        )
        tx = _FakeTx()
        with mock.patch.object(photocrop, 'download_images', self._download({'a': original}, {'a': square})), \
             mock.patch.object(photocrop, 'api_tx', lambda: _FakeApiTx(tx)), \
             mock.patch.object(photocrop, 'DRY_RUN', False):
            await photocrop._backfill(['a'])

        _, written = tx.executed_many[0]
        row = written[0]
        self.assertEqual(row['uuid'], 'a')
        self.assertEqual((row['width'], row['height']), (1000, 640))
        assert isinstance(row['crop_left'], int)
        self.assertLessEqual(abs(row['crop_left'] - 200), 2)

    async def test_dry_run_writes_nothing(self) -> None:
        original, square = renditions(
            photo(1000, 640, seed=7), crop_left=100, crop_top=0,
        )
        tx = _FakeTx()
        with mock.patch.object(photocrop, 'download_images', self._download({'a': original}, {'a': square})), \
             mock.patch.object(photocrop, 'api_tx', lambda: _FakeApiTx(tx)), \
             mock.patch.object(photocrop, 'DRY_RUN', True):
            await photocrop._backfill(['a'])

        self.assertEqual(tx.executed, [])
        self.assertEqual(tx.executed_many, [])

if __name__ == '__main__':
    unittest.main()
