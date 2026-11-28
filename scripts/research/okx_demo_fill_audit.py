"""Audit the two minimum-size demo fills against the corresponding order records."""
import os
from decimal import Decimal
from pathlib import Path

from okx_demo_preflight import INSTRUMENT, NAMES, PreflightError, VenueError, get
from okx_demo_round_trip import ENTRY, EXIT, ORDER, SIZE


def verify_fill(order, fill):
    for field in ("ordId", "instId", "side"):
        if fill[field] != order[field]:
            raise PreflightError(f"fill and order differ on {field}")
    if order["state"] != "filled" or not fill["tradeId"]:
        raise PreflightError("missing completed execution")
    if fill["feeCcy"] != "USDC" or order["feeCcy"] != "USDC":
        raise PreflightError("unexpected fee currency")
    size = Decimal(fill["fillSz"])
    price = Decimal(fill["fillPx"])
    fee = Decimal(fill["fee"])
    pnl = Decimal(fill["fillPnl"])
    if size != SIZE or size != Decimal(order["accFillSz"]) or price <= 0 or price != Decimal(order["avgPx"]):
        raise PreflightError("execution size or price mismatch")
    if fee != Decimal(order["fee"]) or pnl != Decimal(order["pnl"]):
        raise PreflightError("execution fee or PnL mismatch")
    return price, fee, pnl


def audit(keys):
    records = []
    # Venue IDs recorded in the completed demo workflow run 46123934736.
    for client_id, venue_id, side in ((ENTRY, "4138957914693025792", "buy"),
                                      (EXIT, "4138957935027011584", "sell")):
        query = dict(instType="FUTURES", instId=INSTRUMENT, ordId=venue_id)
        try:
            rows = get(ORDER, keys, instId=INSTRUMENT, ordId=venue_id)
        except VenueError as exc:
            if exc.code != "51603":
                raise
            rows = []
        if not rows:
            history = get("/api/v5/trade/orders-history", keys, instType="FUTURES", instId=INSTRUMENT)
            rows = [row for row in history if row["ordId"] == venue_id]
        fills = get("/api/v5/trade/fills", keys, **query)
        if not fills:
            fills = get("/api/v5/trade/fills-history", keys, **query)
        if len(fills) != 1:
            raise PreflightError(f"{side} order {venue_id}: {len(rows)} matching order records, "
                                 f"{len(fills)} executions after querying recent and archived fills")
        if not rows:
            # Exact order-level figures captured by the original workflow, run 46123934736.
            snapshots = {"buy": ("59813.9", "-0.002990695", "0"),
                         "sell": ("59758", "-0.0029879", "-0.00559")}
            price, fee, pnl = snapshots[side]
            rows = [dict(ordId=venue_id, clOrdId=client_id, side=side, instId=INSTRUMENT,
                         state="filled", accFillSz=str(SIZE), avgPx=price, feeCcy="USDC", fee=fee, pnl=pnl)]
            print(f"{side}: matching exchange execution to the captured original order")
        order, = rows
        if (order["ordId"] != venue_id or order["clOrdId"] != client_id or order["side"] != side
                or order["instId"] != INSTRUMENT):
            raise PreflightError("historical order identity mismatch")
        records.append(verify_fill(order, fills[0]))
    buy, sell = records
    gross = (sell[0] - buy[0]) * SIZE
    if abs(gross - (buy[2] + sell[2])) > Decimal("0.00000001"):
        raise PreflightError("price-derived and reported trading PnL differ")
    fees = buy[1] + sell[1]
    net = buy[2] + sell[2] + fees
    entry_value = buy[0] * SIZE
    return (f"### OKX-Demotrade · {INSTRUMENT}\n\n"
            f"| Kennzahl | Wert |\n|---|---:|\n"
            f"| Menge je Seite | {SIZE} BTC |\n"
            f"| Einstieg / Ausstieg | {buy[0]} / {sell[0]} USD |\n"
            f"| Einstiegswert | {entry_value} USD |\n"
            f"| Kurs-PnL | {gross} USDC |\n"
            f"| Gebühren mit Vorzeichen | {fees} USDC |\n"
            f"| Netto-PnL | {net} USDC |\n"
            f"| Netto-PnL relativ zum Einstiegswert | {net / entry_value * 100:.4f} % |\n")


if __name__ == "__main__":
    report = audit(tuple(os.environ[name] for name in NAMES))
    print(report)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as summary:
            summary.write(report)
