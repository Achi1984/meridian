"""Read-only OKX market-data rehearsal for one synthetic round trip."""
import argparse
import json
import time
from decimal import Decimal, ROUND_DOWN
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def positive(value):
    number = Decimal(str(value))
    if not number.is_finite() or number <= 0:
        raise ValueError("expected positive finite input")
    return number


def public_row(path, **params):
    url = "https://www.okx.com/api/v5/" + path + "?" + urlencode(params)
    with urlopen(Request(url, headers={"User-Agent": "Meridian-Paper/1"}), timeout=10) as response:
        result = json.load(response)
    if result.get("code") != "0" or len(result["data"]) != 1:
        raise ValueError("missing public " + path)
    return result["data"][0]


def simulate(spec, book, now_ms, budget):
    symbol = spec["instId"]
    if (spec["state"], spec["ctType"], spec["settleCcy"]) != ("live", "linear", "USDT"):
        raise ValueError("ineligible instrument")
    if spec["ctValCcy"] != symbol.split("-")[0]:
        raise ValueError("contract currency mismatch")
    age = now_ms - int(book["ts"])
    if not 0 <= age <= 5000:
        raise ValueError("stale or future book")
    bid, bid_size = map(positive, book["bids"][0][:2])
    ask, ask_size = map(positive, book["asks"][0][:2])
    if bid > ask:
        raise ValueError("crossed book")
    unit = positive(spec["ctVal"]) * positive(spec["ctMult"] or 1)
    lot = positive(spec["lotSz"])
    size = (positive(budget) / (unit * ask * lot)).to_integral_value(rounding=ROUND_DOWN) * lot
    if size < positive(spec["minSz"]) or size > min(ask_size, bid_size):
        raise ValueError("order size outside minimum or displayed depth")
    quantity = size * unit
    # Match the research pilot's assumed 5 bps taker fee per side.
    modeled_fees = quantity * (ask + bid) * Decimal("0.0005")
    return dict(instrument=symbol, bookTimeMs=int(book["ts"]), ageMs=age,
                contracts=str(size), quoteNotionalUSDT=str(quantity * ask),
                spreadCostUSDT=str(quantity * (ask - bid)), modeledFeesUSDT=str(modeled_fees),
                execution="same_snapshot_simulation", ordersSent=0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", default="BTC-USDT-SWAP")
    parser.add_argument("--paper-notional", default="100")
    args = parser.parse_args()
    try:
        spec = public_row("public/instruments", instType="SWAP", instId=args.instrument)
        if spec["instId"] != args.instrument:
            raise ValueError("unexpected instrument")
        book = public_row("market/books", instId=args.instrument, sz=1)
        report = simulate(spec, book, time.time_ns() // 1000000, args.paper_notional)
        print(json.dumps(report))
    except (ArithmeticError, ValueError, KeyError, IndexError, OSError) as error:
        parser.exit(1, "Rehearsal stopped: " + str(error) + "\n")
