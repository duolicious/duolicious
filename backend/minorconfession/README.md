# Minor-confession classifier

Trains the two models behind `serviceshared/antiabuse/minorconfession`, which
decide whether a chat message reveals that its sender is under 18. This is a
training pipeline, not a service: a developer runs it by hand.

## How the pieces fit

Detection runs in two stages, each time a message is stored:

1. **Stage 1** is `may_confess_minor` in the `firstpass` package, a small
   transformer (4 layers, 256 wide) that reads the message alone. It's tuned
   for recall, not precision, and passes about 2.5% of messages to stage 2.
2. **Stage 2** is `is_minor_confession` in the `classifier` package. It reads
   the sender's claimed age and profile summary, the four messages before the
   target, and the target itself. If its score passes the threshold, the
   sender is reported from the bot account, the way the profile reporter does.
   The report includes those messages, so a moderator can see what triggered
   it.

Both stages run in the chat server, in a batcher that picks up each message
after it's stored, so they never delay delivery. Stage 1 needs only the
message, so the database is read only for the messages it passes. Stage 2's
input ends each message with a separator token that members can't type, so
text inside one message can't pose as a separate message.

## Labels

`rubric.md` is the labelling rubric. Each item is a target message, its
context, the sender's claimed age and their profile summary. It gets one of
these labels:

- `yes`: the sender clearly says they're under 18.
- `maybe`: a weak or ambiguous signal.
- `no`: anything else.
- `skip`: the item shouldn't have been shown. These are left out.

The labelled items aren't in this repository. Senders are split into train
(70%), validation (10%) and test (20%) by a hash of their id, so no sender's
items appear in more than one split.

The first rounds chose items with patterns:

- phrases that confess an age under 18;
- a broader age-related pattern;
- answers to "how old are you"-style questions;
- weak signals such as school, parents or birthdays.

Later rounds added:

- more items from senders labelled `yes`, to find the other ways they gave
  their age away;
- 1,800 items that an earlier stage 1, made of regular expressions, passed
  and an earlier model scored highest, which is where its mistakes cost most;
- 2,091 items that the same stage 1 passed, drawn at random. These make up the
  **live** benchmark below and are never trained on.

Because those items were found with patterns, they favour stage 1 models that
use the same patterns. The **fresh** benchmark fixes that. It's a random
sample the size of about four days of messages, in which 6,025 items were
labelled:

- every item that one candidate stage 1 passed and another didn't, with both
  passing the same share of items;
- every other item the shipped stage 1 passes.

It holds 15 `yes` items from 14 senders, and 62 `maybe` items.

Items with explicit sexual words were left out. A blind second labelling of
520 validation items agreed with the first on 95% of `yes` labels (F1 0.95),
which bounds how well any model can score here.

## Training

`DATA` holds `items/*.jsonl` and `labels/*.jsonl`. Run the scripts from
`backend` with `backend` on `PYTHONPATH`, so that they encode conversations
with the same function the classifier uses. Both fine-tune a base model with
soft targets (`yes` 1.0, `maybe` 0.6, `no` 0).

### Stage 1

`NEGATIVES` is a CSV of typical messages, one per row, without explicit sexual
words. The script holds out every fifth message to choose a
checkpoint, and drops copies of labelled confessions from the rest. It trains
on 300,000 of them and on the train `yes` and `maybe` items, repeated ten
times. It keeps the checkpoint that catches the most validation items at a
2.4% pass rate, with `maybe` items counting a quarter as much as `yes` items.
`--serve` writes the int8 model and its tokenizer into
`firstpass`:

```
python minorconfession/train_firstpass.py DATA NEGATIVES FIRSTPASS --serve
```

Then set `_THRESHOLD` in `firstpass` to the logit at which the int8 model on a
CPU passes 2.5% of typical messages without explicit sexual words.

### Stage 2

`train.py` keeps the epoch with the best validation AP. The shipped model was
made in three steps.

First, train teachers. DeBERTa-v3-base needs bf16 and a smaller batch to fit
in 8 GB. Its validation AP varies a lot between seeds, so train four and keep
the best two:

```
python minorconfession/train.py DATA TEACHER1 --base microsoft/deberta-v3-base \
    --seed 1 --bf16 --batch 8 --accum 2
```

Then train a roberta-base student. Its target for each training item is the
mean of the label's target and the teachers' average probability. `--serve`
writes it into the classifier as an int8 ONNX model, with its weights split
into two files under GitHub's 100 MB limit:

```
python minorconfession/train.py DATA STUDENT --seed 2 \
    --teachers TEACHER1 TEACHER4 --serve
```

Last, score the fresh benchmark's stage 1 passes with the int8 model on a
CPU, and set `_THRESHOLD` in the classifier to the logit that flags about 10
messages a day.

DeBERTa itself isn't shipped. Int8 quantization wrecks its scores (a logit of
−3.5 comes out as −0.4), and at full precision it's 540 to 740 MB.

## Benchmarks

The terms used below:

- **Pass rate**: the share of messages stage 1 passes to stage 2.
- **Recall**: the share of labelled confessions a stage catches.
- **Precision**: the share of flagged messages labelled `yes` or `maybe`.
- **AP**: average precision of `yes`, a threshold-free summary.
- **Reports a day**: flags scaled to about 44,000 sent messages a day.

### Stage 1

| Measure | Value |
| --- | --- |
| Pass rate, typical messages | 2.4% |
| Pass rate, messages with explicit sexual words | 3.3% |
| Time per message, one CPU thread | 2.6 ms |
| Size, int8 | 11 MB |
| Test `yes` caught | 255 of 264 (96.6%) |
| Test `maybe` caught | 213 of 227 (93.8%) |
| Fresh `yes` caught | all 15 |
| Fresh `maybe` caught | 57 of 62 |

The fresh figures count only confessions that some candidate stage 1 passed,
so they're an upper bound.

The model replaced an earlier stage 1 made of regular expressions. On the test
split, the regular expressions did slightly better: passing 1.0% of messages,
they caught 254 of the 264 `yes` items, against 245 for the model. But the
test split was found with similar patterns. The fresh benchmark compared them
fairly, at the same pass rate:

| Messages only one side passes | Labelled | `yes` | `maybe` |
| --- | --- | --- | --- |
| The model, passing 1.0% | 903 | 7 | 25 |
| The regular expressions, passing 1.0% | 872 | 0 | 1 |
| The model, passing 2.5% | 2,072 | 5 | 26 |
| The regular expressions plus a word list, passing 2.5% | 2,013 | 0 | 5 |

Running the regular expressions alongside the model added 4 of the 264 test
`yes` items and nothing on the fresh benchmark, so they were dropped.
Retraining the model with the fresh labels made no measurable difference.
Larger models of the same kind, up to 8 layers and 512 wide, did no better.

### Stage 2

The model is a roberta-base student distilled from two DeBERTa-v3-base teachers,
quantized to int8 (125 MB). The shipped model's scores come from the int8
model on a CPU, as it runs in production. The other models were scored at full
precision on a GPU.

The test and validation sets exclude the live and fresh benchmarks. The live
benchmark has 2,044 items after removing unusable ones; 18 are `yes` and 27
`maybe`.

| Model | Validation AP | Test AP | Live AP |
| --- | --- | --- | --- |
| roberta-base student (shipped) | 0.812 | 0.803 | 0.912 |
| The same student at full precision | 0.818 | 0.808 | 0.902 |
| roberta-base trained on the labels alone, mean of two seeds | 0.792 | 0.789 | 0.885 |
| DeBERTa-v3-base teachers, averaged (not shippable) | 0.788 | 0.785 | 0.847 |

Retraining the same model with a different random seed moves AP by about
±0.05, and one seed in five can be much worse. Candidates were therefore chosen
by validation precision at 90% validation recall, not by AP alone.

Compared at the same test recall, the student beats roberta-base trained on
the labels alone. At 90% recall of test `yes` items, its precision is 57%,
against 49% and 46% for two seeds trained on the labels alone. At 95% recall
it's 44%, against 35% and 40%. Any one of these gaps could be chance, but the
student is ahead in each.

The threshold sets how many reports moderators get. On the fresh benchmark's
stage 1 passes:

| Threshold (logit) | Reports a day | Fresh `yes` caught | Fresh `maybe` caught |
| --- | --- | --- | --- |
| 0.30 | 5 | 5 of 15 | 5 of 57 |
| −0.27 (shipped) | 10 | 5 of 15 | 9 of 57 |
| −0.73 | 15 | 6 of 15 | 12 of 57 |
| −1.01 | 20 | 7 of 15 | 15 of 57 |
| −1.79 | 36 | 7 of 15 | 23 of 57 |

At the shipped threshold, precision on the fresh benchmark is 41%. About 100
reports a day (logit −3.6) would catch 11 of the 15. The fresh benchmark's 15
`yes` items suggest about 4 confessions a day. With so few, these figures are
rough.

End to end at the shipped thresholds, the two stages catch 197 of 264 test
`yes` items (75%) and 73 of 227 test `maybe` items. On the live benchmark they
catch 16 of 18 `yes` items.

Retraining stage 2 with the fresh labels made no measurable difference.
Stage 2 takes 0.48 s per message on one CPU thread and 0.26 s on two, so the
roughly 1,100 messages a day that pass stage 1 take about 9 CPU minutes.

An earlier model also read the four messages after the target, so it had to
wait for them. Four pairs of models were trained with and without those
messages. Without them, test AP was 0.014 lower on average, and at the same
number of flags they caught 2 to 8 fewer of the 264 test `yes` items. On the
live benchmark they did slightly better, with AP 0.03 to 0.05 higher. Writing
the conversation as JSON instead of with separator tokens did no better: test
AP was 0.017 lower for both seeds tried.
