# Key-value matching model

This directory trains the matching model that learns from *behaviour* — who
messaged whom, and who skipped whom — rather than from profile similarity,
which is what the personality vectors and club embeddings already score. It
is a training pipeline, not a running service: a developer runs it by hand
against a copy of the production database.

Every person gets a "who I am" vector (`who`, 64 dims), a "looking for"
vector (`look`, 64 dims) and two scalars: `wbias` (how much people tend to
message this person) and `lbias` (how readily this person messages rather
than skips), so that

    score(A -> B) = look_A . who_B + lbias_A + wbias_B

and the mutual score is `score(A -> B) + score(B -> A)`. Hence "key-value":
each person is both a key (what they want) and a value (what they are), and
appending the scalars as extra dimensions (`[look, lbias, 1]` /
`[who, 1, wbias]`) makes the pair score a single inner product, served from
pgvector like the existing `personality` column.

The two encoders are denoising VAEs (`model.py`) — `LookDVAE` reads the
search preferences as well — trained jointly on profile reconstruction (the
regulariser) plus a directional pair loss over real behaviour. Their inputs
are built by `serviceshared/kvmatching/features.py`, the serving side's own
code, so there is one definition of them rather than one per side.

## Requirements

A copy of the production database (never point this at real production),
Python 3.12+, and a CUDA GPU with 8 GB for training (about 25 minutes;
extraction and feature building work on any machine). From `backend/`:

```
python3 -m venv kvmatching/venv
kvmatching/venv/bin/pip install -r kvmatching/requirements.txt
```

Match the torch wheel to your GPU driver: on a CUDA 12.4 driver, install
`torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124`. This
directory keeps its own virtualenv and `requirements.txt`, and is excluded
from the `api`/`cron` images (`backend/.dockerignore`), because torch has no
place in a production container.

## Retraining

Three environment variables control everything:

* `DUO_DB_DSN` — where the database copy lives
  (default `host=localhost port=5432 dbname=duo_api user=postgres password=password`).
* `KV_WORK_DIR` — where extracted data, feature caches and trained runs are
  written (default `/tmp/duolicious-kvmatching`); allow a few GB, and point
  it somewhere that survives a reboot to keep a run around.
* `KV_SPLIT` — the temporal train/test split date. Training only sees
  behaviour before it; all metrics are measured on what people did after it,
  so pick a date with at least a month or two of behaviour following it.
  **Use the same value for every command**, extraction included: the
  extraction bakes pre-split message counts into `dir_msgs.parquet`, which
  keeps the training targets leak-free.

```
export KV_SPLIT=2026-05-01
python=kvmatching/venv/bin/python
$python -m kvmatching.extract      # DB -> data/*.parquet (~10 min; also builds
                                   # the scratch_kv.msg helper table in the DB)
$python -m kvmatching.train --name model
```

Runs are named, not paths: `--name model` writes to `$KV_WORK_DIR/runs/model`,
and the tools below take the same name. `train.py`'s module constants are the
shipped configuration; it logs per-epoch metrics against the held-out window
and writes `who.npy`, `look.npy`, `wbias.npy`, `lbias.npy`, `model.pt` and
`metrics.json` into the run directory. `metrics.json` includes the production
algorithm evaluated on the same held-out data for comparison, and
`python -m kvmatching.bench model` reproduces the observational benchmark the
PR descriptions quote.

## Deploying a trained model

```
$python -m kvmatching.export model         # -> $KV_WORK_DIR/kv_model.npz
```

`export.py` freezes the encoder weights and the feature vocabulary they were
trained against into one artifact, and checks the serving path's numpy
encoder reproduces training's own vectors before writing it. Copy that file
over `serviceshared/kvmatching/kv_model.npz` and commit it: the weights ship
with the code, so updating the model is a deployment.

`serviceshared/kvmatching` is the serving side of the same model. It rebuilds
a person's features from their live database rows and runs the encoders in
numpy, so neither torch nor scipy reaches the backend. Run
`python -m kvmatching.verify_serving` against a database copy after changing
either side: it rebuilds a sample of people from the live tables and from the
extracted parquet and asserts the two agree column for column.

## Privacy

Everything derived from the database — extracted parquet, feature caches,
trained per-user vectors — is written under `KV_WORK_DIR`, outside the
repository, so none of it can be committed by accident. Never copy it back in.
The code and SQL in this directory contain no user data.
