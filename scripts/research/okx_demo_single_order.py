"""One minimum-size OKX demo order. Subsequent runs only reconcile the same intent."""
import json
import os
import time
from decimal import Decimal, ROUND_DOWN

from okx_demo_preflight import INSTRUMENT, NAMES, PreflightError, VenueError, check, get, request

CLIENT_ID = "MeridianBTCdemo20261128A"
SIZE = "0.0001"
ORDER = "/api/v5/trade/order"
IDENTITY = {"instId": INSTRUMENT, "clOrdId": CLIENT_ID}


def post(path, data, credentials, expires=None):
    rows = request("POST", path, credentials, json.dumps(data, separators=(",", ":")), expires)
    if len(rows) != 1 or rows[0]["sCode"] != "0" or rows[0]["clOrdId"] != CLIENT_ID:
        raise PreflightError("order acknowledgement missing or unmatched")
    return rows[0]["ordId"]


def cancel_and_check(credentials):
    for attempt in range(8):
        try:
            row, = get(ORDER, credentials, **IDENTITY)
            if (row["clOrdId"] != CLIENT_ID or row["instId"] != INSTRUMENT or
                    row["side"] != "buy" or Decimal(row["sz"]) != Decimal(SIZE)):
                raise PreflightError("order identity mismatch")
            print(f"Demo order {row['ordId']}: state={row['state']}, limit={row['px']}, "
                  f"filled={row['accFillSz']}", flush=True)
            if row["state"] in ("canceled", "filled"):
                return row
            if row["state"] in ("live", "partially_filled"):
                post("/api/v5/trade/cancel-order", IDENTITY, credentials)
        except (PreflightError, OSError, ValueError) as exc:
            print(f"Reconciliation attempt {attempt + 1}: {exc}", flush=True)
        time.sleep(1)
    raise PreflightError("terminal order state unconfirmed; reconcile the same client ID")


def run(credentials, submit):
    if submit:
        try:
            existing = get(ORDER, credentials, **IDENTITY)
        except VenueError as error:
            if error.code != "51603":
                raise
        else:
            if not existing:
                raise PreflightError("ambiguous lookup before placement")
            return run(credentials, False)
        contract = check(credentials)
        book, = get("/api/v5/market/books", credentials, instId=INSTRUMENT, sz="1")
        bid = Decimal(book["bids"][0][0])
        ask = Decimal(book["asks"][0][0])
        tick = Decimal(contract["tickSz"])
        if not 0 <= time.time() * 1000 - int(book["ts"]) <= 5000 or not 0 < tick < bid < ask:
            raise PreflightError("order book stale or invalid")
        price = (bid * Decimal("0.995") / tick).to_integral_value(rounding=ROUND_DOWN) * tick
        if not 0 < price < bid:
            raise PreflightError("invalid passive price")
        payload = dict(IDENTITY, tdMode="cross", side="buy", ordType="post_only",
                       sz=SIZE, px=format(price, "f"))
        print(f"Single demo intent {CLIENT_ID}, size={SIZE}, limit={price}", flush=True)
        try:
            order_id = post(ORDER, payload, credentials, int(time.time() * 1000) + 5000)
            print(f"Demo placement acknowledged: {order_id}", flush=True)
        except Exception as error:
            print(f"Demo placement failed: {error}", flush=True)
            try:
                cancel_and_check(credentials)
            finally:
                check(credentials)
            raise
        final = cancel_and_check(credentials)
    else:
        final = cancel_and_check(credentials)
    positions = get("/api/v5/account/positions", credentials, instId=INSTRUMENT)
    pending = get("/api/v5/trade/orders-pending", credentials, instId=INSTRUMENT)
    balances, = get("/api/v5/account/balance", credentials, ccy="USDC")
    print("Final demo available USDC:", [row["availBal"] for row in balances["details"] if row["ccy"] == "USDC"])
    exposure = [row["pos"] for row in positions if Decimal(row["pos"]) != 0]
    print(f"Final demo positions={exposure}, pending standard orders={len(pending)}")
    if final["state"] != "canceled" or Decimal(final["accFillSz"]) or exposure or pending:
        raise PreflightError("demo rehearsal did not end unfilled, canceled and flat")


if __name__ == "__main__":
    credentials = tuple(os.environ[name] for name in NAMES)
    if not all(credentials):
        raise SystemExit("demo credentials missing")
    # Run 4 was rejected. Authorize one retest after the owner updated asset permissions.
    submit = (os.environ.get("GITHUB_RUN_NUMBER"), os.environ.get("GITHUB_RUN_ATTEMPT")) == ("5", "1")
    run(credentials, submit)
