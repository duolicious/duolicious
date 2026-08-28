# Key-value matching model

Trains the matching model that ranks by *behaviour* — who messaged whom, and
who skipped whom — rather than by the profile similarity the personality
vectors and club embeddings already score. This is a training pipeline, not a
service: a developer runs it by hand against a copy of the production
database. `serviceshared/kvmatching` is the same model at serving time, and
builds the features both sides read.

Every person gets a "who I am" vector (`who`, 64 dims), a "looking for"
vector (`look`, 64 dims) and two scalars: `wbias` (how much people tend to
message this person) and `lbias` (how readily this person messages rather
than skips), so that

    score(A -> B) = look_A . who_B + lbias_A + wbias_B

and the mutual score sums both directions. Hence "key-value": each person is
both a key (what they want) and a value (what they are). Folding the scalars
in as extra dimensions (`[look, lbias, 1]` / `[who, 1, wbias]`) makes that a
single inner product, served from pgvector like the existing `personality`
column. Both encoders are denoising VAEs (`model.py`), trained jointly on
profile reconstruction and a directional pair loss over real behaviour.

## Running it

You need a copy of the production database (never point this at real
production), Python 3.12+, and a CUDA GPU with 8 GB — training takes about 25
minutes, extraction and feature building run anywhere. From `backend/`, with
the torch wheel matched to your driver (on CUDA 12.4, `torch==2.6.0
--index-url https://download.pytorch.org/whl/cu124`):

    python3 -m venv kvmatching/venv
    kvmatching/venv/bin/pip install -r kvmatching/requirements.txt

The virtualenv and `requirements.txt` live here, and the directory is
excluded from the api/cron images (`backend/.dockerignore`): torch has no
place in a production container.

Three environment variables control everything. `DUO_DB_DSN` is where the
database copy lives (default
`host=localhost port=5432 dbname=duo_api user=postgres password=password`).
`KV_WORK_DIR` (default `/tmp/duolicious-kvmatching`, allow a few GB) holds
everything derived from the database — parquet, feature caches, trained
vectors — outside the repository, so none of it can be committed by accident;
never copy it back in. `KV_SPLIT` is the train/test split date: training only
sees behaviour before it and every metric is measured after it, so pick a
date with a month or two of behaviour following. **Use the same `KV_SPLIT`
for every command**, extraction included — the extraction bakes pre-split
message counts into `dir_msgs.parquet`, which is what keeps the training
targets leak-free.

    export KV_SPLIT=2026-05-01
    python=kvmatching/venv/bin/python
    $python -m kvmatching.extract             # DB -> parquet, ~10 min
    $python -m kvmatching.train --name model  # -> $KV_WORK_DIR/runs/model
    $python -m kvmatching.bench model         # the benchmark the PRs quote
    $python -m kvmatching.export model        # -> $KV_WORK_DIR/kv_model.npz

Runs are named, not paths, and `train.py`'s module constants are the shipped
configuration. Training writes the vectors, `model.pt` and a `metrics.json`
that scores the production algorithm on the same held-out data for
comparison.

`export.py` freezes the encoder weights and the feature vocabulary they were
trained against into one artifact, after checking the serving path's numpy
encoder reproduces training's own vectors. Copy it over
`serviceshared/kvmatching/kv_model.npz` and commit: the weights ship with the
code, so updating the model is a deployment. After changing either side, run
`python -m kvmatching.verify_serving` against a database copy — it rebuilds a
sample of people from the live tables and from the extracted parquet and
asserts the two agree column for column.
