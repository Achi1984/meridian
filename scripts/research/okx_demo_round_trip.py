"""Reconcile a one-shot, minimum-size BTC X-Perp demo round trip."""
import json
import os
import time
from decimal import Decimal, ROUND_UP

from okx_demo_preflight import INSTRUMENT, NAMES, PreflightError, VenueError, check, get, request

SIZE = Decimal("0.0001")
ENTRY = "MeridianDemoRT20261128Buy"
EXIT = "MeridianDemoRT20261128Sell"
ORDER = "/api/v5/trade/order"


def lookup(keys, client_id):
    try:
        row, = get(ORDER, keys, instId=INSTRUMENT, clOrdId=client_id)
    except VenueError as exc:
        if exc.code == "51603":
            return None
        raise
    side = "buy" if client_id == ENTRY else "sell"
    if (row["instId"] != INSTRUMENT or row["clOrdId"] != client_id or row["side"] != side
            or Decimal(row["sz"]) != SIZE or (side == "sell" and str(row["reduceOnly"]).lower() != "true")):
        raise PreflightError("order identity mismatch")
    return row


def await_terminal(keys, client_id):
    for _ in range(10):
        row = lookup(keys, client_id)
        if row and row["state"] in ("filled", "canceled"):
            return row
        time.sleep(1)
    raise PreflightError(f"unresolved order {client_id}; use reconciliation")


def submit(keys, client_id, **fields):
    data = dict(instId=INSTRUMENT, clOrdId=client_id, sz=str(SIZE), tdMode="cross", **fields)
    try:
        ack, = request("POST", ORDER, keys, json.dumps(data, separators=(",", ":")),
                       int(time.time() * 1000) + 5000)
        if ack.get("sCode") != "0" or ack.get("clOrdId") != client_id:
            raise PreflightError("unmatched acknowledgement")
    except (OSError, PreflightError, ValueError) as exc:
        print(f"Placement response for {client_id}: {exc}", flush=True)
    return await_terminal(keys, client_id)


def position(keys):
    rows = get("/api/v5/account/positions", keys, instId=INSTRUMENT)
    nonzero = [row for row in rows if Decimal(row["pos"]) != 0]
    if not nonzero:
        return Decimal(0)
    row, = nonzero
    if row["instId"] != INSTRUMENT or row["posSide"] != "net" or row["mgnMode"] != "cross":
        raise PreflightError("unexpected demo position")
    return Decimal(row["pos"])


def verify_position(keys, expected):
    for _ in range(8):
        actual = position(keys)
        if actual == expected:
            print(f"Verified demo position: {actual} BTC", flush=True)
            return
        time.sleep(1)
    raise PreflightError(f"position mismatch, expected {expected}, observed {actual}")


def run(keys, allow_entry):
    entry = lookup(keys, ENTRY)
    close = lookup(keys, EXIT)
    if entry is None:
        if not allow_entry or close is not None:
            raise PreflightError("no recoverable entry")
        contract = check(keys)
        book, = get("/api/v5/market/books", keys, instId=INSTRUMENT, sz="1")
        bid, ask = Decimal(book["bids"][0][0]), Decimal(book["asks"][0][0])
        if not 0 <= time.time() * 1000 - int(book["ts"]) <= 5000 or not 0 < bid <= ask <= bid * Decimal("1.002"):
            raise PreflightError("stale or wide demo market")
        tick = Decimal(contract["tickSz"])
        limit = (ask * Decimal("1.001") / tick).to_integral_value(rounding=ROUND_UP) * tick
        if limit * SIZE > 10:
            raise PreflightError("entry exceeds 10 USD demo notional cap")
        entry = submit(keys, ENTRY, side="buy", ordType="ioc", px=format(limit, "f"))
    elif entry["state"] not in ("filled", "canceled"):
        entry = await_terminal(keys, ENTRY)
    if Decimal(entry["accFillSz"]) != SIZE:
        verify_position(keys, Decimal(entry["accFillSz"]))
        raise PreflightError("minimum-size demo entry did not fully fill")
    if close is None:
        verify_position(keys, SIZE)
        if get("/api/v5/trade/orders-pending", keys, instId=INSTRUMENT):
            raise PreflightError("unexpected open order")
        close = submit(keys, EXIT, side="sell", ordType="market", reduceOnly=True)
    elif close["state"] not in ("filled", "canceled"):
        close = await_terminal(keys, EXIT)
    if Decimal(close["accFillSz"]) != SIZE:
        raise PreflightError("demo exit did not fully fill")
    verify_position(keys, Decimal(0))
    check(keys)
    if any(row["feeCcy"] != "USDC" for row in (entry, close)):
        raise PreflightError("unexpected fee currency")
    fees = sum(Decimal(row["fee"]) for row in (entry, close))
    gross = Decimal(close["pnl"])
    modeled = SIZE * (Decimal(close["avgPx"]) - Decimal(entry["avgPx"]))
    print(f"Entry {entry['ordId']}: {entry['avgPx']} USD, fee {entry['fee']} USDC")
    print(f"Exit {close['ordId']}: {close['avgPx']} USD, fee {close['fee']} USDC")
    print(f"OKX gross {gross}; calculated gross {modeled}; net after fees {gross + fees} USDC")
    if abs(modeled - gross) > Decimal("0.00000001"):
        raise PreflightError("realized trading PnL mismatch")


if __name__ == "__main__":
    keys = tuple(os.environ[name] for name in NAMES)
    allow_entry = (os.environ.get("GITHUB_RUN_NUMBER"), os.environ.get("GITHUB_RUN_ATTEMPT")) == ("1", "1")
    run(keys, allow_entry)
