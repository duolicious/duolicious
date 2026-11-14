# High-risk sign-up classifier

Trains the neural network behind `serviceshared/antiabuse/highrisk`, which
scores how likely a new account is to be a scammer. This is a training step,
not a service: a developer runs it by hand.

## How it works

The cron service's `check_high_risk_forever` scores each new man and woman
at sign-up and again 1, 3 and 6 hours later, then stops. Each score goes in
`high_risk_score`. A score at or above the verification threshold sets the
person's `required_verification_level_id` to 3, so they can't message anyone
or appear to anyone until they've verified their photos. A score at or above
the shadow-ban threshold shadow-bans them instead, unless they have Gold,
in which case they must verify their photos. Each time the decision gets
stricter, the moderators get a report email, as they do for member reports.

People who have already verified their photos or been shadow-banned aren't
scored. Scoring waits until the NSFW runner has scored each of the person's
photos, because that runner also stores each photo's CLIP embedding in
`photo.clip_embedding`.

The network sees what's known about the person at the time of each score:

* their profile: age, gender, name, bio, email domain, location and photos;
* the IP address they signed up from, looked up in DB-IP's free city and
  ASN databases;
* the messages they've sent and received;
* how many people they've skipped, reported and visited, how many people
  have done the same to them, and how many of their messages were classified
  as rude;
* how many other accounts have signed in from their network (the same /24
  for IPv4 or /64 for IPv6), and how many of those were shadow-banned.

Only shadow bans count towards that last number. A verification requirement
from this job doesn't, so a wrong requirement can't make the job stricter on
the person's neighbours. A shadow ban from this job does count.

Nothing is matched against hand-written lists of phrases or words. The
network learns from the text itself, in two forms. The first is hashed
character n-grams of:

* the bio and name;
* the sent messages;
* the email domain, the profile's country, and the country and network owner
  of the sign-up IP address.

The second is a sentence embedding of the bio, and the mean of the sentence
embeddings of the sent messages. `encoder.py` computes them on the CPU with
`encoder.onnx`, an 8-bit copy of all-MiniLM-L6-v2.

Its other inputs are the CLIP embeddings of the person's first photo and the
mean of all their photos, and the numbers computed in `features.py`, such as
the distance between the IP address and the profile's location, and counts
of messages. The number of hours since sign-up is also an input, so one
network scores all four times. The network itself runs in numpy, from the
weights in `model.npz`.

## Settings

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `DUO_CRON_HIGH_RISK_DRY_RUN` | `true` | Email what would have happened, without acting on it. |
| `DUO_CRON_HIGH_RISK_VERIFY_THRESHOLD` | `0.95` | Score at which a person must verify their photos. |
| `DUO_CRON_HIGH_RISK_SHADOW_BAN_THRESHOLD` | `0.999` | Score at which a person is shadow-banned. |
| `DUO_CRON_HIGH_RISK_POLL_SECONDS` | `60` | Time between checks for people who are due a score. |

The figures below come from 400 hand-labelled sign-ups, 200 women and 200 men
chosen at random and weighted to match how many of each sign up. Each was
scored by networks that hadn't trained on them, in 5-fold cross-validation
over all the hand labels, repeated with 12 random seeds. A person counts as
flagged if any of their four scores reaches the threshold. The same
thresholds apply to everyone, which is stricter on women than on men:

| | Everyone | Women | Men |
| --- | --- | --- | --- |
| People who shouldn't need to verify but must | 0.6% | 1.0% | 0.5% |
| People who should need to verify and must | 64% | 83% | 31% |
| People who shouldn't need to verify but are shadow-banned | 0% | 0% | 0% |
| People who should need to verify and are shadow-banned | 28% | 43% | 1% |

A lower verification threshold catches more people and makes more mistakes:

| Verification threshold | People who shouldn't need to verify but must | People who should need to verify and must |
| --- | --- | --- |
| `0.85` | 1.7% (women 3.5%, men 1.3%) | 73% (women 88%, men 48%) |
| `0.90` | 1.3% (women 2.4%, men 1.0%) | 69% (women 86%, men 38%) |
| `0.95` | 0.6% (women 1.0%, men 0.5%) | 64% (women 83%, men 31%) |

Only 13 of the 200 men should need to verify, so the men's figures are
rough. Labels that the network disagreed with were checked a second time,
which flatters every figure a little.

## Training

Training needs a file of hand labels, which isn't in this repository. It's
JSON lines, each with a person's `id` and a `label` of either
`should be required to verify` or `should not be required to verify`; a
person's last line wins. Training on everyone's shadow bans first, as weaker
labels, didn't help. People who signed up from a network
that `asnblock` now blocks are left out, since they can't sign up any more.
From `backend/`:

```sh
pip install -r highrisk/requirements.txt
serviceshared/antiabuse/highrisk/download-dbip.sh
PYTHONPATH=. python highrisk/train.py LABELS --evaluate
PYTHONPATH=. python highrisk/train.py LABELS
```

`--evaluate` prints the 5-fold cross-validated results at each of the four
times. Without it, the script overwrites `model.npz` with a network trained on
everyone. Photo embeddings come from `photo.clip_embedding`, so only photos
scored since that column was added are used.

The script imports the backend's settings, so it needs the environment
variables that `docker-compose.test.yml` gives the cron service. Only
`OMP_NUM_THREADS` affects it.

`encoder.onnx` and `tokenizer.json` are in the repository. To rebuild them
from the published model:

```sh
python highrisk/export_encoder.py
```

## Attribution

The IP lookups use <a href='https://db-ip.com'>IP Geolocation by DB-IP</a>,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The sentence embeddings use
[all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2),
licensed under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
