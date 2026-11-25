"""Build the compact v11 dashboard report from the November 25 pilot state."""
import argparse
from decimal import Decimal
import json
from pathlib import Path


def summarize(state, stage):
    rows = {}
    for key in ("direct", "retest"):
        account = state["accounts"][key]
        if account["initialUsdt"] != 1000:
            raise ValueError("unexpected initial balance")
        closed = account["closed"]
        amounts = [Decimal(t["net"]) for t in closed if t["net"] is not None]
        if not all(v.is_finite() for v in amounts):
            raise ValueError("invalid settlement")
        rows[key] = dict(open=len(account["open"]), closed=len(closed),
                         pending=len(closed)-len(amounts), realized=float(sum(amounts)))
    if state["cashBenchmarkUsdt"] != 1000:
        raise ValueError("unexpected benchmark")
    return dict(runId=45678525838, stage=stage, asOf=state["lastSlot"], accounts=rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("state", type=Path)
    parser.add_argument("stage", choices=["first", "final"])
    args = parser.parse_args()
    print(json.dumps(summarize(json.loads(args.state.read_text()), args.stage), allow_nan=False))
