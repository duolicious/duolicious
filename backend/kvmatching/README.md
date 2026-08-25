# Key-value matching model

Duolicious ranks prospects with more than one model. The two that run in
production today score *content similarity*:

* **Personality** (`service/api/qanda/personality.py`) — Q&A answers reduced
  to a 47-dimension trait vector, compared between two people.
* **Club embeddings** (`service/cron/clubembeddings/`) — clubs embedded from
  co-membership, so people in related clubs score highly.

This directory trains a third, different in kind: it learns from *behaviour*
— who actually messaged whom, and who skipped whom — rather than from how
similar two profiles look. It is a training pipeline, not a running service:
a developer runs it by hand against a copy of the production database, and it
writes vectors that can then be served.

Every person gets a "who I am" vector (`who`, 64 dims), a "looking for"
vector (`look`, 64 dims) and two scalars: `wbias` (how much people tend to
message this person) and `lbias` (how readily this person messages rather
than skips). The directed score "A is looking for B" is

    score(A -> B) = look_A . who_B + lbias_A + wbias_B

and the mutual score is `score(A -> B) + score(B -> A)`. Hence "key-value":
each person is both a key (what they want) and a value (what they are).
Appending the bias scalars as extra vector dimensions
(`[look, lbias, 1]` / `[who, 1, wbias]`) turns the whole thing into a single
inner product, so it can be served from pgvector exactly like the existing
`personality` column. Both encoders read only profile content (Q&A answers,
profile fields, location, clubs, search preferences), so brand-new users get
useful vectors immediately.

The model is two denoising VAEs (`model.py`): `WhoDVAE` encodes the profile,
`LookDVAE` additionally encodes search preferences, and both are trained
jointly on profile reconstruction (regulariser) plus a directional pair loss
over real behaviour: messaged pairs get a target of `log2(1 + messages sent)`,
skips −1, reported skips −2, random pairs 0.

## Requirements

* A copy of the production database (never point this at real production).
* Python 3.12+, and a CUDA GPU with 8 GB for training (about 25 minutes;
  data extraction and feature building work on any machine).

```
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

Match the torch wheel to your GPU driver: on a CUDA 12.4 driver, install
`torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124`.

This directory keeps its own virtualenv and `requirements.txt`; it is
deliberately excluded from the `api`/`cron` images (`backend/.dockerignore`)
and from type checking (`backend/mypy.ini`), because torch has no place in a
production container.

## Retraining

Two environment variables control everything:

* `DUO_DB_DSN` — where the database copy lives
  (default `host=localhost port=5432 dbname=duo_api user=postgres password=password`).
* `KV_SPLIT` — the temporal train/test split date. Training only sees
  behaviour before this date; all metrics are measured on what people did
  after it. Pick a date far enough back that at least a month or two of
  behaviour follows it. **Use the same value for every command**, extraction
  included: the extraction bakes pre-split message counts into
  `dir_msgs.parquet`, which keeps the training targets leak-free.

```
export KV_SPLIT=2026-05-01
venv/bin/python extract.py        # DB -> data/*.parquet (~10 min; also builds
                                  # the scratch_kv.msg helper table in the DB)
venv/bin/python build_cache.py    # parquet -> data/*.pkl feature caches
venv/bin/python train.py --out runs/model
```

`train.py`'s defaults are the shipped configuration. It logs per-epoch
metrics against the held-out window and writes `who.npy`, `look.npy`,
`wbias.npy`, `lbias.npy`, `model.pt` and `metrics.json` into `--out`.
`metrics.json` includes the production algorithm and popularity/reply-rate
baselines evaluated on the same held-out data for comparison.

## Serving-time knobs

* `dyn.py runs/model` — simulates serving with an inbound-load penalty
  (`score − λ·sd·log1p(times already shown)`) and reports how exposure
  concentration trades off against ranking quality as λ grows.
* `knobs.py runs/model` — grid over the load penalty and a values-agreement
  term (political/relationship questions), both folded into the inner
  product by appending dimensions, so neither needs retraining.

## Privacy

`data/` and `runs/` contain per-user data derived from the database
(interaction history, answers, learned per-user vectors). They are gitignored;
never commit them or share them. The code and SQL in this directory contain
no user data.
