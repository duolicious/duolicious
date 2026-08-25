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
profile fields, location, search preferences), so brand-new users get
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

Everything below runs from the `backend/` directory:

```
python3 -m venv kvmatching/venv
kvmatching/venv/bin/pip install -r kvmatching/requirements.txt
```

Match the torch wheel to your GPU driver: on a CUDA 12.4 driver, install
`torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124`.

This directory keeps its own virtualenv and `requirements.txt`, and is
excluded from the `api`/`cron` images (`backend/.dockerignore`), because
torch has no place in a production container.

## Retraining

Three environment variables control everything:

* `DUO_DB_DSN` — where the database copy lives
  (default `host=localhost port=5432 dbname=duo_api user=postgres password=password`).
* `KV_WORK_DIR` — where extracted data, feature caches and trained runs are
  written (default `/tmp/duolicious-kvmatching`). Nothing derived from the
  database is ever written inside the repository. Allow a few GB, and note
  that `/tmp` is usually cleared on reboot: point this elsewhere to keep a
  run around.
* `KV_SPLIT` — the temporal train/test split date. Training only sees
  behaviour before this date; all metrics are measured on what people did
  after it. Pick a date far enough back that at least a month or two of
  behaviour follows it. **Use the same value for every command**, extraction
  included: the extraction bakes pre-split message counts into
  `dir_msgs.parquet`, which keeps the training targets leak-free.

```
export KV_SPLIT=2026-05-01
python=kvmatching/venv/bin/python
$python -m kvmatching.extract      # DB -> data/*.parquet (~10 min; also builds
                                   # the scratch_kv.msg helper table in the DB)
$python -m kvmatching.build_cache  # parquet -> data/*.pkl feature caches
$python -m kvmatching.train --name model
```

Runs are named, not paths: `--name model` writes to
`$KV_WORK_DIR/runs/model`, and the tools below take the same name.

`train.py`'s defaults are the shipped configuration. It logs per-epoch
metrics against the held-out window and writes `who.npy`, `look.npy`,
`wbias.npy`, `lbias.npy`, `model.pt` and `metrics.json` into the run
directory.
`metrics.json` includes the production algorithm evaluated on the same
held-out data for comparison.

## Deploying a trained model

```
$python -m kvmatching.export model         # -> $KV_WORK_DIR/kv_model.npz
```

`export.py` freezes the encoder weights and the feature vocabulary they were
trained against into one artifact, and checks the serving path's numpy
encoder reproduces training's own vectors before writing it. Copy
that file over `serviceshared/kvmatching/kv_model.npz` and commit it: the
weights ship with the code, so updating the model is a deployment.

`serviceshared/kvmatching` is the serving side of the same model. It rebuilds
a person's features from their database rows and runs the encoders in numpy,
so neither torch nor scipy reaches the backend. Nothing calls it yet.

Its feature construction has to agree with training's exactly -- the encoders
were fitted to that layout, so a column out of place produces plausible
nonsense rather than an error. Run `python -m kvmatching.verify_serving`
against a database copy after changing either side: it rebuilds a sample of
people through the serving path and asserts the blocks match training's
column for column.

## Privacy

Everything derived from the database — extracted parquet, feature caches,
trained per-user vectors — is written under `KV_WORK_DIR`, outside the
repository, so none of it can be committed by accident. Never copy it back
in. The code and SQL in this directory contain no user data.
