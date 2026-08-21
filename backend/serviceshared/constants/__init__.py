MAX_IMAGE_BYTES = 10_000_000
MAX_NUM_IMAGES = 7;
MAX_CONTENT_LENGTH = MAX_NUM_IMAGES * MAX_IMAGE_BYTES;

MAX_AUDIO_BYTES = 10_000_000
MAX_AUDIO_SECONDS = 120 + 1

MAX_NOTIFICATION_LENGTH = 128

# How recently someone must have been seen to be treated as "online recently"
# by search (see `search.sql.feed`). Deliberately shorter than the window over
# which presence itself is retained: search is ranking on freshness, so it wants
# a tighter definition than the indicator, which just reports what it knows.
ONLINE_RECENTLY_SECONDS = 12 * 60 * 60  # 12 hours

# How long a sighting is retained in Redis, and so how far back a subscriber
# can be told someone was last seen. Retention only: the age reported to
# clients is measured from the stored sighting time, so changing this can't
# misdate anything already stored. The client decides for itself how much of
# that range is worth showing; nothing here has to agree with it.
ONLINE_PRESENCE_TTL_SECONDS = 24 * 60 * 60  # 24 hours

# Cadence at which a live chat connection refreshes its `person.last_online_time`
# (see `service.api.chat.online.update_online_forever`).
LAST_UPDATE_INTERVAL_SECONDS = 4 * 60  # 4 minutes

# A user is treated as "currently online" -- and so worth running the expensive
# per-visitor query for, to push a real-time visitor update -- if the chat
# server has refreshed their `person.last_online_time` this recently. Derived
# from (and so guaranteed to stay larger than) the refresh cadence, with a
# safety factor for jitter/batching delay, so an online user is never briefly
# judged offline between refreshes and silently dropped from a live push.
VISITOR_ONLINE_TIMEOUT_SECONDS = 2 * LAST_UPDATE_INTERVAL_SECONDS  # 8 minutes

LAST_ONLINE_NOW_SECONDS = VISITOR_ONLINE_TIMEOUT_SECONDS

LAST_ONLINE_DEFAULT_NAME = 'A month ago'
LAST_ONLINE_DEFAULT_SECONDS = 30 * 24 * 60 * 60

# Most online-status subscriptions a single chat connection may hold at once.
# Once reached, the earliest subscriptions are evicted to make room for new
# ones. Bounds the resources one client (possibly unauthenticated, since
# logged-out web viewers may subscribe to public profiles) can consume.
MAX_ONLINE_SUBSCRIPTIONS = 500

# Most devices a person may stay signed in on at once; older sessions are
# signed out on each new sign-in.
MAX_SIGNED_IN_SESSIONS = 100

# Refreshing someone's 'answered-question' feed event on every public answer
# would rewrite their (heavily indexed) person row once per swipe while they
# play Q&A, and flood the feed with Q&A answers. Refreshing at most this often
# caps that churn; the advertised question is at most this stale.
ANSWERED_QUESTION_EVENT_REFRESH_SECONDS = 60 * 60 * 24  # 1 day

# The first questions in the quiz are shown to everyone in the same order, so
# advertising them in the feed would surface the same handful of answers over
# and over. Questions with an id at or below this aren't advertised.
ANSWERED_QUESTION_EVENT_MIN_QUESTION_ID = 10

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

# What a visitor notification says. The periodic check can count the visitors
# in its window but can't name one, so a lone visitor is "someone", while a
# push sent as the visit happens knows exactly who it was.
VISITOR_NOTIFICATION_TITLE = 'Someone visited your profile 👀'
VISITOR_NOTIFICATION_BODY = 'Someone visited your profile!'

VISITOR_NOTIFICATION_TITLE_PLURAL = '{count} people visited your profile 👀'
VISITOR_NOTIFICATION_BODY_PLURAL = '{count} people visited your profile!'

IMMEDIATE_VISITOR_NOTIFICATION_TITLE = '{name} visited your profile 👀'
IMMEDIATE_VISITOR_NOTIFICATION_BODY = 'Open the app to see your visitors'
