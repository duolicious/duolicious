import sys
from io import BytesIO
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pillow_jxl
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict

from serviceshared.antiabuse.clipnsfw import embed

model_dir = Path(__file__).parent.parent / 'serviceshared/antiabuse/clipnsfw'
positive_dir, negative_dir = map(Path, sys.argv[1:])

positive = sorted(positive_dir.iterdir())
negative = sorted(negative_dir.iterdir())
paths = positive + negative
labels = np.array([1] * len(positive) + [0] * len(negative))

session = ort.InferenceSession(str(model_dir / 'model.onnx'))
embeddings = np.stack([embed(session, BytesIO(p.read_bytes())) for p in paths])

probe = LogisticRegression(C=10, max_iter=5000)
scores = cross_val_predict(
    probe, embeddings, labels,
    cv=StratifiedKFold(10, shuffle=True, random_state=0),
    method='predict_proba')[:, 1]

print(f'{len(positive)} NSFW and {len(negative)} SFW images')
print(f'10-fold cross-validation at a threshold of 0.5: '
      f'{((scores >= 0.5) == labels).mean():.2%} accurate')
for i in np.flatnonzero((scores >= 0.5) != labels):
    print(f'  {"missed NSFW" if labels[i] else "false alarm"}: {scores[i]:.3f} {paths[i]}')

probe.fit(embeddings, labels)
np.savez(
    model_dir / 'probe.npz',
    weights=probe.coef_[0].astype(np.float32),
    bias=np.float32(probe.intercept_[0]))
