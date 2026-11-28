"""Publish aggregate OKX demo observations for a fixed two-trade pilot."""
import json
import os
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from okx_demo_round_trip import INSTRUMENT, NAMES, get, run


def main():
    keys = tuple(os.environ[name] for name in NAMES)
    allow_entry = (os.environ["GITHUB_EVENT_NAME"], os.environ["GITHUB_RUN_NUMBER"],
                   os.environ["GITHUB_RUN_ATTEMPT"]) == ("push", "1", "1")
    gross = fees = Decimal(0)
    for number in (1, 2):
        prefix = f"MeridianDash2811P{number}"
        gain, fee = run(keys, allow_entry, prefix + "Buy", prefix + "Sell")
        gross += gain
        fees += fee
    balance, = get("/api/v5/account/balance", keys, ccy="USDC")
    account, = [row for row in balance["details"] if row["ccy"] == "USDC"]
    available = Decimal(account["availBal"])
    if not available.is_finite():
        raise ValueError("invalid available demo balance")
    report = dict(instrument=INSTRUMENT, available=float(available), closed=2,
                  net=float(gross + fees), fees=float(fees), position=0,
                  asOf=datetime.now(timezone.utc).isoformat())
    Path("okx-demo-pilot.json").write_text(json.dumps(report, allow_nan=False))


if __name__ == "__main__":
    main()
