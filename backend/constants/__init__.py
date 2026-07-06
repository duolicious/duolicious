MAX_IMAGE_BYTES = 10_000_000
MAX_NUM_IMAGES = 7;
MAX_CONTENT_LENGTH = MAX_NUM_IMAGES * MAX_IMAGE_BYTES;

MAX_AUDIO_BYTES = 10_000_000
MAX_AUDIO_SECONDS = 120 + 1

MAX_NOTIFICATION_LENGTH = 128

ONLINE_RECENTLY_SECONDS = 12 * 60 * 60  # 12 hours

# Cadence at which a live chat connection refreshes its `person.last_online_time`
# (see `service.chat.online.update_online_forever`).
LAST_UPDATE_INTERVAL_SECONDS = 4 * 60  # 4 minutes

# A user is treated as "currently online" -- and so worth running the expensive
# per-visitor query for, to push a real-time visitor update -- if the chat
# server has refreshed their `person.last_online_time` this recently. Derived
# from (and so guaranteed to stay larger than) the refresh cadence, with a
# safety factor for jitter/batching delay, so an online user is never briefly
# judged offline between refreshes and silently dropped from a live push.
VISITOR_ONLINE_TIMEOUT_SECONDS = 2 * LAST_UPDATE_INTERVAL_SECONDS  # 8 minutes

# Most online-status subscriptions a single chat connection may hold at once.
# Once reached, the earliest subscriptions are evicted to make room for new
# ones. Bounds the resources one client (possibly unauthenticated, since
# logged-out web viewers may subscribe to public profiles) can consume.
MAX_ONLINE_SUBSCRIPTIONS = 500

# Most devices a person may stay signed in on at once; older sessions are
# signed out on each new sign-in.
MAX_SIGNED_IN_SESSIONS = 100

# Club SEO page tunables. Shared by person/sql (API reads) and
# service/cron/clubseo/sql (cron aggregation); kept in this dependency-free
# module so both sides can import them without pulling each other in.

# Below this, a club's page is too thin to be worth indexing and risks
# Google's thin-content penalty.
MIN_CLUB_PAGE_MEMBERS = 50

# Cap on the deterministic md5-ordered member sample used to compute a
# club's stats. The biggest clubs have thousands of members; this sample
# size matches the full club's proportions closely. Displayed
# `member_count` is always the true count, not the sample size.
MAX_CLUB_SAMPLE_MEMBERS = 500

# Privacy floor: never display a demographic/overlap category with fewer
# than this many members, to prevent re-identification.
MIN_CLUB_CELL_SIZE = 5

MIN_CLUB_ANSWERS_PER_QUESTION = 10
MIN_ANSWER_DIVERGENCE_PCT = 15

MAX_CLUB_TOP_ANSWERS = 8
MAX_RELATED_CLUBS = 8
MAX_LLM_PROMPT_FACTS = 6

MIN_NOTABLE_TRAIT_SCORE = 10

# Members of more than this many clubs are dropped from the co-membership
# self-join. A person in k clubs contributes k*(k-1) pairs, so without a
# cap a handful of hyper-joiners dominate the cost and contribute mostly
# noise. Set to the gold-tier club quota (free is 50, gold is 100), so the
# cap only bites at the top of that quota.
MAX_CLUBS_PER_PERSON_FOR_OVERLAP = 100
