from PIL import Image, ImageDraw
from collections.abc import Awaitable, Callable
from unittest import mock
import io
import random
import unittest

import service.cron.photocrop as photocrop
from duophoto import PhotoGeometry

def _photo(width: int, height: int, seed: int) -> Image.Image:
    # Busy and non-repeating, so the crop offset is unambiguous (see the same
    # helper in duophoto/test_init.py).
    rng = random.Random(seed)
    image = Image.new('RGB', (width, height), (12, 12, 30))
    draw = ImageDraw.Draw(image)
    for _ in range(160):
        x, y = rng.randint(0, width), rng.randint(0, height)
        draw.ellipse(
            [x, y, x + rng.randint(15, 90), y + rng.randint(15, 90)],
            fill=(rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255)),
        )
    return image

def _jpeg(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format='jpeg', quality=85, subsampling=2)
    return buffer.getvalue()

# The original and its 450 square crop, as bytes - what the object store holds.
def _renditions(
    original: Image.Image,
    crop_left: int,
    crop_top: int,
) -> tuple[bytes, bytes]:
    min_dim = min(original.size)
    square = original.crop((
        crop_left,
        crop_top,
        crop_left + min_dim,
        crop_top + min_dim,
    )).resize((450, 450))
    return _jpeg(original), _jpeg(square)

class TestGeometryOf(unittest.TestCase):
    def test_recovers_the_geometry_of_a_matching_pair(self) -> None:
        original = _photo(1200, 800, seed=1)
        original_bytes, square_bytes = _renditions(original, crop_left=300, crop_top=0)

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
        original = _jpeg(_photo(1200, 800, seed=1))
        unrelated = _jpeg(_photo(800, 800, seed=2).resize((450, 450)))

        self.assertIsNone(
            photocrop._geometry_of('uuid', io.BytesIO(original), io.BytesIO(unrelated))
        )

    def test_skips_when_a_rendition_is_missing(self) -> None:
        original = io.BytesIO(_jpeg(_photo(1200, 800, seed=1)))

        self.assertIsNone(photocrop._geometry_of('uuid', original, None))
        self.assertIsNone(photocrop._geometry_of('uuid', None, original))

# Records what was run against the DB, standing in for a real transaction.
class _FakeTx:
    def __init__(self) -> None:
        self.executed: list[tuple[str, object]] = []
        self.executed_many: list[tuple[str, object]] = []

    async def execute(self, query: str, params: object = None) -> None:
        self.executed.append((query, params))

    async def executemany(self, query: str, seq: object) -> None:
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

    async def test_marks_the_whole_batch_even_when_a_match_fails(self) -> None:
        # One recoverable photo and one whose square is unrelated to its
        # original. The bad one must still be marked attempted, or the queue -
        # which selects `crop_attempted_at IS NULL` - would hand it back forever.
        good_original, good_square = _renditions(
            _photo(1200, 800, seed=1), crop_left=300, crop_top=0,
        )
        bad_original = _jpeg(_photo(1200, 800, seed=3))
        bad_square = _jpeg(_photo(800, 800, seed=9).resize((450, 450)))

        uuids = ['good', 'bad']
        originals = {'good': good_original, 'bad': bad_original}
        squares = {'good': good_square, 'bad': bad_square}

        tx = _FakeTx()
        with mock.patch.object(photocrop, 'download_images', self._download(originals, squares)), \
             mock.patch.object(photocrop, 'api_tx', lambda: _FakeApiTx(tx)), \
             mock.patch.object(photocrop, 'DRY_RUN', False):
            await photocrop._backfill(uuids)

        # The whole batch is marked attempted...
        self.assertEqual(len(tx.executed), 1)
        _, params = tx.executed[0]
        assert isinstance(params, dict)
        self.assertEqual(set(params['uuids']), {'good', 'bad'})

        # ...but only the recoverable photo's geometry is written.
        self.assertEqual(len(tx.executed_many), 1)
        _, written = tx.executed_many[0]
        assert isinstance(written, list)
        self.assertEqual([row['uuid'] for row in written], ['good'])

    async def test_writes_geometry_for_a_recovered_photo(self) -> None:
        original, square = _renditions(
            _photo(1000, 640, seed=5), crop_left=200, crop_top=0,
        )
        tx = _FakeTx()
        with mock.patch.object(photocrop, 'download_images', self._download({'a': original}, {'a': square})), \
             mock.patch.object(photocrop, 'api_tx', lambda: _FakeApiTx(tx)), \
             mock.patch.object(photocrop, 'DRY_RUN', False):
            await photocrop._backfill(['a'])

        _, written = tx.executed_many[0]
        assert isinstance(written, list)
        row = written[0]
        self.assertEqual(row['uuid'], 'a')
        self.assertEqual((row['width'], row['height']), (1000, 640))
        self.assertLessEqual(abs(row['crop_left'] - 200), 2)

    async def test_dry_run_writes_nothing(self) -> None:
        original, square = _renditions(
            _photo(1000, 640, seed=7), crop_left=100, crop_top=0,
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
