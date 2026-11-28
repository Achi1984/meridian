"""Run one signal-driven BTC X-Perp round trip in the EEA demo account."""
import base64
import json
import os
import time
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from pathlib import Path
import sys
from subprocess import run as run_process

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "spot-paper-advisor"))
from okx_swing_observation import DAY_MS, SPOT, observe
from okx_demo_preflight import INSTRUMENT, NAMES, PreflightError, VenueError, check, get, request
from okx_demo_round_trip import ORDER, SIZE, position, verify_position

ENTRY = "MerSwing20261128In"
EXIT = "MerSwing20261128Out"
LAST_ENTRY = date(2026, 12, 1)
LAST_HOLD = date(2026, 12, 4)


def order(keys, client_id):
    try:
        row, = get(ORDER, keys, instId=INSTRUMENT, clOrdId=client_id)
    except VenueError as exc:
        if exc.code != "51603":
            raise
        history = get("/api/v5/trade/orders-history", keys, instType="FUTURES", instId=INSTRUMENT)
        matches = [item for item in history if item["clOrdId"] == client_id]
        if not matches:
            return None
        row, = matches
    if (row["instId"] != INSTRUMENT or row["clOrdId"] != client_id
            or row["side"] not in ("buy", "sell") or Decimal(row["sz"]) != SIZE
            or str(row["reduceOnly"]).lower() != str(client_id == EXIT).lower()
            or row["state"] not in ("canceled", "filled")):
        raise PreflightError("unexpected or unresolved campaign order")
    return row


def place(keys, client_id, **fields):
    body = dict(instId=INSTRUMENT, tdMode="cross", sz=str(SIZE), clOrdId=client_id, **fields)
    ack, = request("POST", ORDER, keys, json.dumps(body, separators=(",", ":")),
                   int(time.time() * 1000) + 5000)
    if ack.get("sCode") != "0" or ack.get("clOrdId") != client_id:
        raise PreflightError("unconfirmed acknowledgement")
    time.sleep(2)
    row = order(keys, client_id)
    if row is None:
        raise PreflightError("accepted order unavailable for reconciliation")
    return row


def entry_price(book, tick, side, now_ms):
    bid, ask = (Decimal(book[key][0][0]) for key in ("bids", "asks"))
    if not 0 <= now_ms - int(book["ts"]) <= 5000 or not 0 < bid <= ask <= bid * Decimal("1.002"):
        raise PreflightError("stale or wide demo book")
    if ask * Decimal("1.001") * SIZE > 10:
        raise PreflightError("minimum contract exceeds pilot budget")
    price = ask * Decimal("1.001") if side == "buy" else bid * Decimal("0.999")
    rounding = ROUND_CEILING if side == "buy" else ROUND_FLOOR
    limit = (price / tick).to_integral_value(rounding=rounding) * tick
    if max(limit, ask) * SIZE > 10:
        raise PreflightError("rounded contract exceeds pilot budget")
    return format(limit, "f")


def reserve_entry(signal):
    # A create-only receipt survives venue history expiry and ambiguous acknowledgements.
    path = "repos/Achi1984/meridian/contents/okx-swing-demo-20261128-intent.json"
    content = base64.b64encode(json.dumps(signal).encode()).decode()
    run_process(["gh", "api", "--silent", "--method", "PUT", path, "-f", "branch=paper-dashboard-data",
                 "-f", "message=Reserve the single BTC swing demo entry", "-f", "content=" + content],
                check=True)


def run(keys, now, candles):
    today = now.date()
    entry = order(keys, ENTRY)
    exit_order = order(keys, EXIT)
    if exit_order:
        if (not entry or exit_order["side"] == entry["side"] or
                any(Decimal(row["accFillSz"]) != SIZE or row["feeCcy"] != "USDC"
                    for row in (entry, exit_order))):
            raise PreflightError("incomplete campaign reconciliation")
        fees = Decimal(entry["fee"]) + Decimal(exit_order["fee"])
        return dict(action="closed", feesUSDC=str(fees),
                    realizedAfterTradingFeesUSDC=str(Decimal(exit_order["pnl"]) + fees))
    if not entry and today > LAST_ENTRY:
        verify_position(keys, Decimal(0))
        return dict(action="entry window ended")
    signal = {}
    if today <= LAST_HOLD:
        signal = observe(candles, int(now.timestamp()) // 86400 * DAY_MS)
    if not entry:
        check_contract = check(keys)
        direction = signal["flatStartSignal"]
        if direction == "FLAT":
            return dict(**signal, action="wait")
        side = "buy" if direction == "LONG" else "sell"
        book, = get("/api/v5/market/books", keys, instId=INSTRUMENT, sz="1")
        price = entry_price(book, Decimal(check_contract["tickSz"]), side, time.time() * 1000)
        reserve_entry(signal)
        entry = place(keys, ENTRY, side=side, ordType="ioc", px=price)
    if Decimal(entry["accFillSz"]) == 0:
        verify_position(keys, Decimal(0))
        return dict(**signal, action="entry unfilled")
    if Decimal(entry["accFillSz"]) != SIZE:
        raise PreflightError("unexpected entry size")
    sign = 1 if entry["side"] == "buy" else -1
    verify_position(keys, sign * SIZE)
    query = dict(instType="FUTURES", instId=INSTRUMENT, limit="1")
    fills = get("/api/v5/trade/fills", keys, **query)
    if not fills:
        fills = get("/api/v5/trade/fills-history", keys, **query)
    if not fills or fills[0]["ordId"] != entry["ordId"] or get(
            "/api/v5/trade/orders-pending", keys, instId=INSTRUMENT):
        raise PreflightError("campaign no longer has exclusive ownership of position")
    if today <= LAST_HOLD and signal["trend"] == sign:
        return dict(**signal, action="hold", positionBTC=str(sign * SIZE))
    place(keys, EXIT, side="sell" if sign == 1 else "buy", ordType="market", reduceOnly=True)
    verify_position(keys, Decimal(0))
    return run(keys, now, candles)


if __name__ == "__main__":
    now = datetime.now(timezone.utc)
    keys = tuple(os.environ[name] for name in NAMES)
    candles = get("/api/v5/market/candles", keys, instId=SPOT, bar="1Dutc", limit="100") if now.date() <= LAST_HOLD else []
    print(json.dumps(run(keys, now, candles)))
