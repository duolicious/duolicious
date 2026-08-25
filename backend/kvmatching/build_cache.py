import time

from kvmatching.cache import load_evaldata, load_features


def main() -> None:
    t = time.time()
    f = load_features()
    print("features", time.time() - t, f.n, f.who_input_dim(), f.look_extra_dim(),
          flush=True)
    t = time.time()
    ed = load_evaldata(f)
    print("evaldata", time.time() - t, len(ed.dir_a), len(ed.rep_a), len(ed.q_a),
          len(ed.searchers), len(ed.exposure_pool), flush=True)


if __name__ == "__main__":
    main()
