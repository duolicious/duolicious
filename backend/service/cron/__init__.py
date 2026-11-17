import logging

# Nothing else configures logging in this process; give the app's loggers a
# root handler in the same level-prefixed style as the api service. This runs
# before the cron-module imports so their import-time logging isn't dropped.
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s:     %(asctime)s %(name)s: %(message)s',
)

from service.cron.checkphotos import check_photos_forever
from service.cron.clubcounts import fold_club_count_deltas_forever
from service.cron.clubembeddings import (
    refresh_club_embeddings_forever,
    repool_queued_club_vectors_forever,
)
from service.cron.clubseo import (
    refresh_club_seo_forever,
    refresh_club_stats_forever,
    refresh_club_top_answers_forever,
)
from service.cron.garbagerecords import delete_garbage_records_forever
from service.cron.highrisk import check_high_risk_forever
from service.cron.spotifyrefresh import refresh_spotify_forever
from service.cron.messagenotifications import (
    CHAT_NOTIFICATIONS,
    INTRO_NOTIFICATIONS,
)
from service.cron.notificationdispatch import send_pending_notifications_forever
from service.cron.nsfwphotorunner import predict_nsfw_v2_photos_forever
from service.cron.visitornotifications import VISITOR_NOTIFICATIONS
from service.cron.photocleaner import clean_photos_forever
from service.cron.audiocleaner import clean_audio_forever
from service.cron.verificationjobrunner import verify_forever
from service.cron.profilereporter import report_profiles_forever
import asyncio
import signal
import threading
from contextlib import suppress
from http.server import SimpleHTTPRequestHandler
from socketserver import TCPServer
from serviceshared.database import db_pool_lifespan, triggers
from serviceshared.batcher import drain_all, start_all
from serviceshared.matching import MODELS

logger = logging.getLogger(__name__)

class HealthCheckHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == '/health':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'Healthy')
        else:
            self.send_response(404)
            self.end_headers()

def start_http_server() -> None:
    httpd = TCPServer(('0.0.0.0', 8080), HealthCheckHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    logger.info('Serving health check on port 8080...')

async def main() -> None:
    triggers.install(MODELS)

    # Open the DB pool (and its keepalive checker) for the process lifetime, then
    # start the batch consumers (e.g. notify's) on this loop before the jobs that
    # enqueue into them begin running.
    async with db_pool_lifespan():
        await start_all()
        start_http_server()

        jobs = asyncio.gather(
            # Fetched: 0.1k, returned: 2k
            delete_garbage_records_forever(),

            # Fetched: 0.1k, returned: 100k
            clean_photos_forever(),

            clean_audio_forever(),

            predict_nsfw_v2_photos_forever(),

            check_high_risk_forever(),

            # Should only be enabled when it's likely that the object store
            # contains photos which aren't tracked by the DB
            # check_photos_forever(),

            send_pending_notifications_forever(INTRO_NOTIFICATIONS),

            send_pending_notifications_forever(CHAT_NOTIFICATIONS),

            send_pending_notifications_forever(VISITOR_NOTIFICATIONS),

            verify_forever(),

            report_profiles_forever(),

            refresh_club_stats_forever(),

            refresh_club_top_answers_forever(),

            fold_club_count_deltas_forever(),

            refresh_club_embeddings_forever(),

            repool_queued_club_vectors_forever(),

            refresh_club_seo_forever(),

            refresh_spotify_forever(),
        )
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, jobs.cancel)

        with suppress(asyncio.CancelledError):
            await jobs

        await drain_all()

if __name__ == '__main__':
    asyncio.run(main())
