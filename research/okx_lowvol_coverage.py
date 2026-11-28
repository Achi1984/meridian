"""Compare the frozen Low-Volatility V2 universe with OKX demo-account listings."""
import json
import os
import sys
from pathlib import Path

from low_volatility_rank_weighted_v2_targets import QUOTE_CURRENCY
from low_volatility_rank_weighted_v2 import ASSETS

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
from okx_demo_preflight import NAMES, get


def coverage(instruments):
    exact = {}
    alternatives = {}
    for row in instruments:
        if row["state"] != "live" or row["ctType"] != "linear":
            continue
        symbol = row["instId"]
        asset = symbol.split("-", 1)[0]
        if asset not in ASSETS:
            continue
        if (row["instType"] == "SWAP" and row["settleCcy"] == QUOTE_CURRENCY
                and symbol == f"{asset}-{QUOTE_CURRENCY}-SWAP"):
            exact[asset] = symbol
        elif row["settleCcy"] == "USDC":
            alternatives.setdefault(asset, set()).add(symbol)
    missing = [asset for asset in ASSETS if asset not in exact]
    return dict(required=list(ASSETS), exact=exact, missing=missing,
                usdcAlternatives={k: sorted(v) for k,v in alternatives.items()},
                universeComplete=not missing)


if __name__ == "__main__":
    keys = tuple(os.environ[name] for name in NAMES)
    instruments = []
    for kind in ("SWAP", "FUTURES"):
        instruments.extend(get("/api/v5/account/instruments", keys, instType=kind))
    print(json.dumps(coverage(instruments), sort_keys=True))
