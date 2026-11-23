"""@bruin
name: pm.exit_simulation
type: python
connection: duckdb-default
description: |
  Monte Carlo view of what each term sheet pays the founders across many possible exits, not just one.
  Samples 5,000 exit values per session from a log-normal distribution (an illustrative modelling
  assumption, not market data: median exit $60M, wide spread, plus a 30% chance of a sub-$10M outcome)
  and prices the founders' take under the actual terms and under clean 1x non-participating terms at
  the same price. Reads the session JSON the app writes; seeded, so results are reproducible.
materialization:
  type: table
depends:
  - pm.sessions
columns:
  - name: session_id
    type: varchar
    checks:
      - name: not_null
@bruin"""

import glob
import json
import os
import zlib

import numpy as np
import pandas as pd

N = 5000
SESSIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "sessions", "*.json")


def sample_exits(rng: np.random.Generator) -> np.ndarray:
    # Illustrative venture outcome curve: most exits small, a long right tail.
    small = rng.uniform(0, 10e6, N)
    big = rng.lognormal(mean=np.log(60e6), sigma=1.4, size=N)
    return np.where(rng.random(N) < 0.3, small, big)


def founder_take(exits: np.ndarray, t: dict, clean: bool) -> np.ndarray:
    raise_amt, pre = t["raise_amount"], t["pre_money"]
    inv_pct = raise_amt / (pre + raise_amt)
    founder_pct = 1 - inv_pct - t["option_pool_pct"]
    common_share = founder_pct / (founder_pct + t["option_pool_pct"])
    if clean:
        investor = np.maximum(np.minimum(exits, raise_amt), inv_pct * exits)
    else:
        pref = t["liq_pref_multiple"] * raise_amt
        if t["participating"]:
            investor = np.minimum(exits, pref) + inv_pct * np.maximum(exits - pref, 0)
        else:
            investor = np.maximum(np.minimum(exits, pref), inv_pct * exits)
    return (exits - investor) * common_share


def simulate(paths: list[str]) -> pd.DataFrame:
    rows = []
    for path in sorted(paths):
        with open(path) as f:
            s = json.load(f)
        for version, t in (("first_offer", s.get("initial_terms")), ("final", s.get("final_terms"))):
            if not t:
                continue
            rng = np.random.default_rng(zlib.crc32(f"{s['session_id']}:{version}".encode()))
            exits = sample_exits(rng)
            yours = founder_take(exits, t, clean=False)
            clean = founder_take(exits, t, clean=True)
            rows.append(
                {
                    "session_id": s["session_id"],
                    "version": version,
                    "p10_take": float(np.percentile(yours, 10)),
                    "p50_take": float(np.percentile(yours, 50)),
                    "p90_take": float(np.percentile(yours, 90)),
                    "mean_cost_of_terms": float(np.mean(clean - yours)),
                    "wipeout_pct": float(np.mean(yours < 1) * 100),
                    "simulations": N,
                }
            )
    return pd.DataFrame(
        rows,
        columns=["session_id", "version", "p10_take", "p50_take", "p90_take", "mean_cost_of_terms", "wipeout_pct", "simulations"],
    )


def materialize(**kwargs):
    return simulate(glob.glob(SESSIONS))
