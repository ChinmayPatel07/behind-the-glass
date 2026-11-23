"""Checks the Monte Carlo asset against the app's test fixture. Run: python -m pytest bruin/tests"""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("exit_simulation", ROOT / "bruin/assets/exit_simulation.py")
sim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sim)
FIXTURE = str(ROOT / "app/tests/fixtures/session-signed.json")


def test_first_offer_costs_more_than_clean_final_terms():
    df = sim.simulate([FIXTURE]).set_index("version")
    # final terms are clean 1x non-participating, so they cost nothing versus clean terms
    assert abs(df.loc["final", "mean_cost_of_terms"]) < 1
    # the 2x participating first offer costs the founders money and wipes them out more often
    assert df.loc["first_offer", "mean_cost_of_terms"] > 1e6
    assert df.loc["first_offer", "wipeout_pct"] > df.loc["final", "wipeout_pct"]


def test_reproducible():
    a = sim.simulate([FIXTURE])
    b = sim.simulate([FIXTURE])
    assert a.equals(b)
