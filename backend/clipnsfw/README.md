# CLIP NSFW photo classifier

Trains the linear probe behind `serviceshared/antiabuse/clipnsfw`, which
scores how likely a profile photo is to be sexually explicit. This is a
training step, not a service: a developer runs it by hand.

## How it works

The cron service's `predict_clip_nsfw_photos_forever` writes each photo's
score to `photo.clip_nsfw_score`. It reads photos whose score is NULL, so it
both backfills existing photos and scores new uploads. It runs only when the
host's load is below `DUO_CRON_OFFPEAK_MAX_LOAD_PCT`. The score is between 0
and 1, or -1 when the photo isn't in the object store. Nothing reads it yet:
Bumble's model in `serviceshared/antiabuse/antiporn` still decides which
photos are hidden and deleted.

Scoring has two parts:

1. OpenAI's CLIP ViT-L/14 image encoder turns the photo into a 768-number
   embedding. `download-model.sh` fetches an ONNX export of it from Hugging
   Face, pinned by revision and checksum. At 1.2 GB it's too big for this
   repository.
2. A logistic regression on that embedding, the "probe", turns it into a
   probability. Its 768 weights and bias are in `probe.npz`.

The encoder sees the centre square of the photo, resized to 224 by 224
pixels, as CLIP was trained. Scoring takes about 2 seconds of CPU time per
photo with two threads.

## Training

The probe is trained on a folder of explicit images and a folder of images
that aren't. Neither is in this repository. From `backend/`:

```sh
pip install -r clipnsfw/requirements.txt
serviceshared/antiabuse/clipnsfw/download-model.sh
PYTHONPATH=. python clipnsfw/train.py POSITIVE_DIR NEGATIVE_DIR
```

It prints the 10-fold cross-validated accuracy and every image the probe gets
wrong, then overwrites `probe.npz` with a probe fitted to all the images.
Training embeds images with the same code that scores them in production.
