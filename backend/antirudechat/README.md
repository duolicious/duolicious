# Rude intro classifier

Trains the model behind `serviceshared/antiabuse/antirude/chat`, which decides
whether an intro is rude enough to hide in the recipient's "Hidden intros"
folder. This is a training pipeline, not a service: a developer runs it by hand
against a copy of the production database.

## The corpus

Four files hold labelled messages, one JSON object per line with a `text`
and a `rude` field:

- `serviceshared/antiabuse/antirude/chat/random_intros.jsonl` is the main
  benchmark. Its intros were drawn at random from those sent since May 2026,
  so its precision and recall are what members see. About one in eight is
  rude.
- `serviceshared/antiabuse/antirude/chat/corpus.jsonl` holds far more rude
  intros and hard cases than random traffic does, so it shows changes on
  kinds of intro that a random sample holds few of. Besides intros, it holds
  the phrases from the unit tests the corpus replaced.
- `train.jsonl` is what the model learns from.
- `synthetic.jsonl` holds short messages written by hand rather than taken
  from the database. They cover coded requests that are rare there, such as
  "what's your menu?", and harmless look-alikes such as "do you send memes?".
  The model learns from them too.

`test_init.py` beside the benchmarks snapshots the classifier's precision and
recall on both, so any change to either shows up in CI and in review.

This repository is public and the intros are private messages, so no file
holds a real message. Every line of the first three is a paraphrase that keeps
the words that decide the label (rude terms, misspellings, self-censoring,
emoji) and rewrites or replaces everything else, names and places included.

`train.jsonl` also holds paraphrases of another random sample of intros sent
since May 2026. The other intros in it and those in `corpus.jsonl` were
sampled from a copy of the production database in four groups:
intros the old word-list filter blocked, the next intro the same sender sent
within ten minutes of a block (often the same message, reworded to get past
the filter), a random sample of intros sent after the filter stopped blocking,
and intros the old filter flags. Targeted searches then added intros of kinds
those groups held few of: telling the recipient to harm themselves ("jump off
a bridge", "commit sudoku"), transphobic slurs and insults, rude words hidden
by spacing, leetspeak or symbols ("k y s", "g00n"), short coded requests ("do
you send?", "how big is it?", "are you on onlyfans?"), imageboard slang
("foid", "tranner", "cope and seethe"), the slurs in `banned-club.sql`, members
describing themselves with slurs ("im a fag lol"), remarks that land badly from
a stranger ("you're jewish", "are you a man?"), praise of mass shooters and
eating-disorder codes ("ana buddy"). Many of the intros they found use the same
words harmlessly, and those are labelled ok. Senders were split so that
nobody's messages are in both a benchmark and `train.jsonl`.

Claude labelled every intro against `rubric.md` as rude, ok or unsure, left the
unsure ones out, and paraphrased the rest under the rubric's paraphrasing
rules. The rubric judges each intro by how its recipient would most likely take
it, so in-group slang and self-descriptions are ok while the same words aimed
at the recipient are rude. A second pass labelled the benchmarks' paraphrases
without seeing the originals, and only the paraphrases whose label matched the
original's were kept.

To fix a mistake the classifier makes, add paraphrased, labelled examples of it
to `train.jsonl` (never the real message), or invented ones to
`synthetic.jsonl` when the database has too few, retrain, and check the
benchmarks.

## How the model is trained

The classifier is a four-layer BERT
(`google/bert_uncased_L-4_H-256_A-4`), small enough to score an intro in a few
milliseconds on one CPU thread. It learns by distillation:

1. Three large "teacher" models
   (`cardiffnlp/twitter-roberta-large-2022-154m`, each from a different random
   seed) are fine-tuned on `train.jsonl` and `synthetic.jsonl`. They are more
   accurate than the small model but far too slow to serve.
2. The teachers score every intro in the database copy, plus the intros the
   old filter blocked, which are kept in `rude_message`, and their scores are
   averaged. Intros from the senders the
   benchmarks were paraphrased from are left out, which is what the
   `md5('rude-' || person_id)` condition in `train.py` does.
3. The small model learns from the same labelled messages and the averaged
   scores, then is exported to `model.onnx` and `tokenizer.json` beside the
   serving code.

Scoring every intro rather than the last six months' (2.2 million rather
than 440,000) raised the small model's recall on real intros by about six
points at the same rate of normal intros hidden. Training it for 8 epochs
rather than 4 added about two more in the one run measured. A wider small model
(`google/bert_uncased_L-4_H-512_A-8`) added a point or two on top, but took
three times as long to score an intro.

With a single teacher, the small model's precision on random intros varied by
up to six points between training runs on the same data. Averaging three
teachers steadies it and raises recall slightly, at the cost of about an hour
more training.

Training and serving read text through the same
`serviceshared.antiabuse.normalize.normalize_chat_message`. It drops quoted
profile text (it is the recipient's own words, so it can't offend them),
replaces look-alike letters in words that mix alphabets, and shortens runs of
three or more repeated characters.

## Running it

You need a copy of the production database (never point this at real
production), Python 3.12+, and a CUDA GPU with 8 GB. From `backend/`, with the
torch wheel matched to your driver (on CUDA 12.4, `torch==2.6.0 --index-url
https://download.pytorch.org/whl/cu124`):

    python3 -m venv antirudechat/venv
    antirudechat/venv/bin/pip install -r antirudechat/requirements.txt
    antirudechat/venv/bin/python -m antirudechat.train

`DUO_DB_DSN` says where the database copy lives (default
`host=localhost port=5432 dbname=duo_api user=postgres password=password`).
The virtualenv lives here, and the directory is excluded from the api and cron
images (`backend/.dockerignore`).

Training overwrites `model.onnx` and `tokenizer.json`. Run the unit tests
(`test/unit/unit.sh`), put the precision and recall that
`serviceshared/antiabuse/antirude/chat/test_init.py` reports into its
snapshot, and commit the model with the snapshot so that review sees both.
