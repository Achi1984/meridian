"""Reconcile closed direct/retest pilot fills in a saved top100_paper state."""
import argparse
from collections import Counter
from decimal import Decimal as D
import json
from pathlib import Path

FEE_RATE = D("0.0005")  # Per-side rate in the November 25 pilot.
COMPONENTS = ("marketMove", "spread", "slippage", "fees", "funding", "net")


def amount(value):
    number = D(str(value))
    if not number.is_finite():
        raise ValueError("nonfinite amount")
    return number


def prices(fill, buy):
    bid, ask, price = (amount(fill[k]) for k in ("bid", "ask", "price"))
    touch = ask if buy else bid
    if not 0 < bid <= ask or price <= 0 or (price - touch) * (1 if buy else -1) < 0:
        raise ValueError("invalid book or execution price")
    return (bid + ask) / 2, touch, price


def decompose(trade):
    side = trade["side"]
    entry, exit_fill = trade["entry"], trade["exit"]
    qty = amount(entry["qty"])
    if side not in (-1, 1) or qty <= 0 or qty != amount(exit_fill["qty"]):
        raise ValueError("invalid direction or quantity")
    if int(exit_fill["ts"]) <= int(entry["ts"]):
        raise ValueError("invalid fill order")
    start, entry_touch, entry_px = prices(entry, side == 1)
    end, exit_touch, exit_px = prices(exit_fill, side == -1)
    signed = qty * side
    move = signed * (end - start)
    touch_move = signed * (exit_touch - entry_touch)
    fill_move = signed * (exit_px - entry_px)
    fees = -FEE_RATE * qty * (entry_px + exit_px)
    if abs(fill_move + fees - amount(trade["beforeFunding"])) > D("1e-12"):
        raise ValueError("beforeFunding reconciliation failed")
    row = dict(marketMove=move, spread=touch_move-move, slippage=fill_move-touch_move,
               fees=fees, funding=None, net=None)
    if trade["net"] is not None:
        funding = amount(trade["funding"])
        net = fill_move + fees + funding
        if abs(net - amount(trade["net"])) > D("1e-12"):
            raise ValueError("net reconciliation failed")
        row.update(funding=funding, net=net)
    return row


def report(state):
    output = {}
    for name, account in state["accounts"].items():
        trades = []
        totals = {}
        pending = 0
        for trade in account["closed"]:
            values = decompose(trade)
            direction = "long" if trade["side"] == 1 else "short"
            trades.append(dict(instrument=trade["instrument"], side=direction,
                               entryMs=trade["entry"]["ts"], exitMs=trade["exit"]["ts"], **values))
            if values["net"] is None:
                pending += 1
                continue
            bucket = totals.setdefault(direction, dict(settled=0, **dict.fromkeys(COMPONENTS, D(0))))
            bucket["settled"] += 1
            for key in COMPONENTS:
                bucket[key] += values[key]
        output[name] = dict(open=len(account["open"]), pendingFunding=pending,
                            settledBySide=totals, trades=trades)
    rows = state["observations"]
    skips = Counter((account, stage, reason) for row in rows
                    for account, _, stage, reason in row.get("skips", []))
    return dict(currency="USDT", accounts=output, recordedSlots=len(rows),
                failedSlots=sum("error" in row for row in rows),
                skips=[dict(account=a, stage=s, reason=r, count=n)
                       for (a, s, r), n in sorted(skips.items())])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("state", type=Path)
    args = parser.parse_args()
    print(json.dumps(report(json.loads(args.state.read_text())), indent=2, default=str))
