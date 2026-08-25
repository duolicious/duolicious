import argparse, os
import numpy as np, pandas as pd, torch
from cache import load_features, load_evaldata
from evaluate import Scorer, dynamic_exposure, prod_scorer
from train import scorer_from
from paths import run_dir

p = argparse.ArgumentParser(); p.add_argument("run"); p.add_argument("--lams", default="0,0.1,0.25,0.5,1,2")
a = p.parse_args()
if a.run != "prod":
    a.run = run_dir(a.run)
device = torch.device("cuda"); f = load_features(); ed = load_evaldata(f)
if a.run == "prod":
    sc = prod_scorer(f, device)
else:
    ld = lambda n: np.load(os.path.join(a.run, n)) if os.path.exists(os.path.join(a.run, n)) else np.zeros(f.n, np.float32)
    sc = scorer_from(np.load(os.path.join(a.run, "who.npy")), np.load(os.path.join(a.run, "look.npy")), ld("wbias.npy"), ld("lbias.npy"), device)
rng = np.random.default_rng(0)
ra = rng.choice(ed.exposure_pool, 20000); rb = rng.choice(ed.exposure_pool, 20000)
sd = float(np.std(sc.reciprocal(ra, rb)))
rows = []
for lam in [float(x) for x in a.lams.split(",")]:
    r = {"lam": lam}; r.update(dynamic_exposure(sc, ed, lam, sd)); rows.append(r)
pd.set_option("display.width", 200)
print(a.run); print(pd.DataFrame(rows).round(3).to_string(index=False))
