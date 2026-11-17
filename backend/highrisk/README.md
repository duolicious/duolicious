# High-risk sign-up classifier

Trains the neural network behind `serviceshared/antiabuse/highrisk`, which
scores how likely a new account is to be a scammer. A developer runs it by
hand.

## How it works

The cron job `check_high_risk_forever` scores each new man and woman six
minutes after they sign up and again 1, 3 and 6 hours after, once the NSFW
runner has stored their photos' CLIP embeddings. A score at or above the
verification threshold requires photo verification. A score at or above the
shadow-ban threshold shadow-bans them, or requires verification if they have
Gold. Each time the decision gets stricter, the moderators get a report email.

The network's inputs, as known at the time of each score, are:

* sentence embeddings of the bio and of the sent messages, from `encoder.onnx`
  (an 8-bit copy of all-MiniLM-L6-v2), and how alike the messages are to each
  other and to the bio;
* the CLIP embeddings of the first photo and the mean of all photos;
* the profile's country and the sign-up IP address's country, from one learned
  table of countries, and the company that owns the sign-up network, as hashed
  character n-grams;
* the numbers in `features.py`, such as age, the genders sought, the distance
  between the IP address and the profile's location, counts of messages,
  skips, reports and visits, and who the person messages and visits;
* running counts, kept in `network_activity`, of recent sign-ups and recent
  shadow bans after members' reports on the person's networks (the /24 for
  IPv4, the /64 for IPv6). They fade to 37% after 30 days. The job's own
  decisions don't add to them.

It runs in numpy, from the weights in `model.npz`.

## Settings

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `DUO_CRON_HIGH_RISK_DRY_RUN` | `true` | Email what would have happened, without acting on it. |
| `DUO_CRON_HIGH_RISK_VERIFY_THRESHOLD` | `0.95` | Score at which a person must verify their photos. |
| `DUO_CRON_HIGH_RISK_SHADOW_BAN_THRESHOLD` | `0.999` | Score at which a person is shadow-banned. |
| `DUO_CRON_HIGH_RISK_POLL_SECONDS` | `60` | Time between checks for people who are due a score. |

## How well it works

These figures come from 343 hand-labelled sign-ups, 157 women and 186 men,
chosen at random and weighted to match how many of each gender sign up. Each
was scored by networks that hadn't trained on them (5-fold cross-validation,
72 seeds). A person counts as flagged if any of their four scores reaches the
threshold.

| | Everyone | Women | Men |
| --- | --- | --- | --- |
| People who shouldn't need to verify but must | 0.7% | 0.2% | 0.8% |
| People who should need to verify and must | 67% | 85% | 41% |
| People who shouldn't need to verify but are shadow-banned | 0% | 0% | 0% |
| People who should need to verify and are shadow-banned | 30% | 50% | 2% |

| Verification threshold | People who shouldn't need to verify but must | People who should need to verify and must |
| --- | --- | --- |
| `0.85` | 2.0% (women 1.1%, men 2.2%) | 81% (women 88%, men 69%) |
| `0.90` | 1.4% (women 0.5%, men 1.6%) | 77% (women 87%, men 61%) |
| `0.95` | 0.7% (women 0.2%, men 0.8%) | 67% (women 85%, men 41%) |

Only 13 of the men should need to verify, so the men's figures are rough.
Labels the network disagreed with were checked twice, which flatters every
figure a little. `train.py --evaluate` doesn't print these tables, because it
doesn't know the sampling weights.

## Training

Training needs a CUDA GPU and a file of hand labels, which isn't in this
repository: JSON lines with a person's `id` and a `label` of
`should be required to verify` or `should not be required to verify`, where a
person's last line wins. From `backend/`, with the environment variables
`docker-compose.test.yml` gives the cron service:

```sh
pip install -r highrisk/requirements.txt
serviceshared/antiabuse/highrisk/download-dbip.sh
PYTHONPATH=. python highrisk/train.py LABELS --evaluate
PYTHONPATH=. python highrisk/train.py LABELS
```

`--evaluate` prints cross-validated results. Without it, the script overwrites
`model.npz`.

Training leaves out people whose sign-up network is now blocked, and people
whose sign-up session no longer exists. A sign-up session is the latest one
that signed in between four days before sign-up and three minutes after.

Training rebuilds the past from today's tables, so it differs from what the
job sees:

* the network counts are replayed from sign-up and shadow-ban times, without
  deleted accounts and sessions;
* bios, photos, the genders sought, and the locations of the people messaged
  are read as they are now.

The DB-IP databases aren't pinned, because DB-IP only keeps the last two
months, so the cron image's can be newer than those used in training.

To rebuild `encoder.onnx`, run `python highrisk/export_encoder.py`. It uses
the rude-chat classifier's tokenizer, `antirude/chat/tokenizer.json`.

## Attribution

The IP lookups use <a href='https://db-ip.com'>IP Geolocation by DB-IP</a>,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The sentence embeddings use
[all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2),
licensed under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0).
