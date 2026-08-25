import time
from cache import load_features, load_evaldata
t = time.time()
f = load_features()
print("features", time.time() - t, f.n, f.who_input_dim(), f.look_extra_dim(), flush=True)
t = time.time()
ed = load_evaldata(f)
print("evaldata", time.time() - t, len(ed.dir_a), len(ed.rep_a), len(ed.q_a), len(ed.searchers), len(ed.exposure_pool), flush=True)
