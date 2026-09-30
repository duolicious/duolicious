from service.cron.videotranscoder import (
    Rejection,
    V_NOT_A_VIDEO,
    V_TOO_BIG,
    filter_graph,
    frame_rate,
    usable_video_stream,
)
from serviceshared.ffmpeg import Probe, ProbeFormat, ProbeStream
import unittest


def video(
    width: int = 1080,
    height: int = 1920,
    fps: str = '30/1',
    codec: str = 'h264',
    index: int = 0,
    color_transfer: str | None = None,
) -> ProbeStream:
    return ProbeStream(
        index=index,
        codec_type='video',
        codec_name=codec,
        width=width,
        height=height,
        avg_frame_rate=fps,
        color_transfer=color_transfer,
    )


def probe(*streams: ProbeStream) -> Probe:
    return Probe(streams=list(streams), format=ProbeFormat(duration=30))


class TestUsableVideoStream(unittest.TestCase):
    def assert_rejected(self, p: Probe, message: str) -> None:
        with self.assertRaises(Rejection) as context:
            usable_video_stream(p)
        self.assertEqual(str(context.exception), message)

    def test_rejects_files_without_a_supported_video_stream(self) -> None:
        self.assert_rejected(
            probe(ProbeStream(index=0, codec_type='audio', codec_name='aac')),
            V_NOT_A_VIDEO)
        self.assert_rejected(probe(video(codec='prores')), V_NOT_A_VIDEO)

    def test_skips_cover_art(self) -> None:
        stream = usable_video_stream(
            probe(video(codec='mjpeg'), video(index=1)))
        self.assertEqual(stream.index, 1)

    def test_rejects_tiny_videos(self) -> None:
        self.assert_rejected(probe(video(width=40, height=40)), V_NOT_A_VIDEO)

    def test_rejects_more_than_4k_or_more_than_4k_at_60_fps(self) -> None:
        self.assert_rejected(
            probe(video(width=7680, height=4320, fps='24/1')), V_TOO_BIG)
        self.assert_rejected(
            probe(video(width=3840, height=2160, fps='120/1')), V_TOO_BIG)

    def test_accepts_4k_at_60_fps_and_slow_motion_1080p(self) -> None:
        usable_video_stream(probe(video(width=2160, height=3840, fps='60/1')))
        usable_video_stream(probe(video(width=1920, height=1080, fps='240/1')))


class TestFrameRate(unittest.TestCase):
    def test_parses_ffprobe_rates(self) -> None:
        self.assertAlmostEqual(frame_rate(video(fps='30000/1001')), 29.97, 2)
        self.assertEqual(frame_rate(video(fps='0/0')), 0)


class TestFilterGraph(unittest.TestCase):
    def test_drops_to_30_fps_only_for_faster_sources(self) -> None:
        self.assertIn('fps=30,', filter_graph(video(fps='60/1'), 30, 0))
        self.assertNotIn('fps=30,', filter_graph(video(fps='30/1'), 30, 0))

    def test_tone_maps_hdr_sources(self) -> None:
        for transfer in ['arib-std-b67', 'smpte2084']:
            self.assertIn(
                'tonemap',
                filter_graph(video(color_transfer=transfer), 30, 0))
        self.assertNotIn(
            'tonemap', filter_graph(video(color_transfer='bt709'), 30, 0))

    def test_reads_the_chosen_stream(self) -> None:
        self.assertTrue(filter_graph(video(index=3), 30, 0).startswith('[0:3]'))

    def test_takes_short_clips_poster_from_their_first_frame(self) -> None:
        self.assertIn('trim=start=1,', filter_graph(video(), 30, 0))
        self.assertIn('trim=start=0,', filter_graph(video(), 1.5, 0))
        self.assertIn('trim=start=0,', filter_graph(video(), 0, 0))

    def test_starts_the_stills_at_the_given_offset(self) -> None:
        self.assertIn(
            "select='gte(t,2.500)*", filter_graph(video(), 30, 2.5))


if __name__ == '__main__':
    unittest.main()
