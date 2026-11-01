# CLIP NSFW photo classifier

Trains the linear probe behind `serviceshared/antiabuse/clipnsfw`, which
scores how likely a profile photo is to be sexually explicit. This is a
training step, not a service: a developer runs it by hand.

## How it works

The cron service's `predict_nsfw_v2_photos_forever` writes each photo's
score to `photo.nsfw_score_v2`. It reads photos whose score is NULL, so it
both backfills existing photos and scores new uploads. The score is between 0
and 1, or -1 when the photo isn't in the object store or can't be read. The
feed hides photos scored above 0.5, and the `garbagerecords` cron deletes
photos scored above 0.95.

Scoring has two parts:

1. OpenAI's CLIP ViT-L/14 image encoder turns the photo into a 768-number
   embedding. `download-model.sh` fetches OpenAI's weights from their
   Hugging Face account, pinned by revision and checksum. At 1.7 GB they're
   too big for this repository. They're in the safetensors format, which
   holds only numbers, so loading them can't run code. `build_onnx.py` writes
   the encoder as an ONNX graph around those weights, and onnxruntime runs it.
   The cron image does this when it's built.
2. A logistic regression on that embedding, the "probe", turns it into a
   probability. Its 768 weights and bias are in `probe.npz`.

The encoder sees `450-{uuid}.jpg`, the square that members chose and that
Bumble's model also scores, resized to 224 by 224 pixels. Training
centre-crops the labelled images to a square instead, as CLIP was trained.
Scoring takes about 2 seconds per photo with two threads.

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
