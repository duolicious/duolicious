# Intro score

Trains the model behind `serviceshared/introscore`, which scores how likely an
intro is to get a positive reply. Clients use the score to put the most
promising intros first in the Intros list. This is a training pipeline, not a
service: a developer runs it by hand against a copy of the production database.

## How it works

The API scores each intro when it's sent, unless the rude intro filter hid it,
and stores the score in `inbox.intro_score`. Inbox entries carry the score to
clients. An intro keeps its first score: later messages from the same sender
don't change it.

The model is one network, stored as an 8-bit ONNX file. Its inputs are:

* the intro's text, read by the first four layers of all-MiniLM-L6-v2 through
  the rude intro filter's tokenizer, `antirude/chat/tokenizer.json`;
* for the sender and the recipient: age, gender, orientation, how many intros
  they've sent and received, the share of their sent intros which got a reply,
  the share of their received intros which they replied to, how many photos
  they have and how many are verified, their highest NSFW score, and the mean
  of their photos' CLIP embeddings.

`Q_PEOPLE` reads all of them from columns the API already maintains, so
scoring adds one query and one model call to sending an intro.

The network has four outputs: whether a reply would be negative, neutral or
positive, and whether the recipient replies at all. The score is the chance of
a reply times the chance that a reply is positive.

## How well it works

"Sort quality" is how often the model ranks an intro which got a positive
reply above another intro in the same inbox which didn't. Ordering at random
scores 0.5.

These figures are for 49,507 intros in the inboxes of 1,002 recipients. The
model that produced them trained on no intro sent to or by those recipients.
The model in this repository trained on them too.

| Order | Sort quality |
| --- | --- |
| By match percentage ("Top Matches") | 0.541 |
| By the rude intro filter's score, least rude first | 0.546 |
| By this model, trained without step 2 below | 0.702 |
| By this model | 0.713 |

Scoring an intro takes about 5 ms on one CPU core, and 17 ms for the longest
twentieth of intros.

## Training

Training needs CUDA GPUs and a file of labels, which isn't in this repository:
JSON lines with a `sender_id`, a `recipient_id` and a `label` of `negative`,
`neutral` or `positive`, saying how the recipient replied to the sender's
intro. Claude labelled the replies used so far.

From `backend/`, with the environment variables `docker-compose.test.yml`
gives the api service:

```sh
pip install -r introscore/requirements.txt
PYTHONPATH=. python introscore/train.py LABELS --evaluate
PYTHONPATH=. python introscore/train.py LABELS
```

`--evaluate` trains without the recipients whose id is a multiple of five and
prints the sort quality for their inboxes. Without it, the script trains on
everything and overwrites `model.onnx`.

`--evaluate` printed 0.697 for the labels behind the model in this repository.
That figure is for comparing one training run with another. It's lower than
the 0.713 above because it covers different inboxes, and only a sample of the
intros in each.

Training has three steps:

1. It reads the labelled intros, and as many other intros picked at random,
   from the database. The other intros have no label, and teach only the
   "replies at all" output.
2. A large text model, twitter-roberta-large, learns to predict the labels from
   the intro's text alone. Five copies each learn from four fifths of the
   labelled intros and score the rest, so every score comes from a copy which
   never saw that intro's label. One copy trains on each GPU.
3. The network learns from the labels, from whether each intro got a reply, and
   from the large model's scores, which its text layers learn to reproduce.
   Copying a stronger reader is worth about 0.01 of sort quality.

Training rebuilds the past from today's tables, so it differs from what the
API sees:

* the intro and reply counts are replayed from `messaged`, without the
  conversations of deleted accounts;
* ages are as of each intro, but photos are read as they are now.

## Attribution

The text layers come from
[all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2),
licensed under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
