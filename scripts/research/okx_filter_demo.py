"""Paired BTC flat-start experiment. Only the filtered arm sends OKX demo orders."""
import base64
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from decimal import Decimal as D

import okx_swing_demo as pilot
from okx_demo_preflight import INSTRUMENT, NAMES, PreflightError, check, get, request
from okx_demo_round_trip import ORDER, SIZE, verify_position
from okx_short_filter import observation

BRANCH = "paper-dashboard-data"
FILE = "okx-filter-demo.json"
API = "repos/Achi1984/meridian/contents"
FEE = D("0.0005")  # explicit per-side assumption for the modeled arms
LAST_DAY = "2026-12-07"


class Journal:
    def __init__(self):
        listing = subprocess.check_output(["gh", "api", API + "?ref=" + BRANCH,
                                           "--jq", '.[] | select(.name=="' + FILE + '") | .sha'], text=True)
        self.sha = listing.strip()
        self.data = {"instrument": INSTRUMENT, "sessions": {}, "observation": None}
        if self.sha:
            blob = json.loads(subprocess.check_output(["gh", "api", API + "/" + FILE + "?ref=" + BRANCH]))
            if blob["sha"] != self.sha:
                raise ValueError("journal changed while reading")
            self.data = json.loads(base64.b64decode(blob["content"]))
            if self.data["instrument"] != INSTRUMENT:
                raise ValueError("unexpected journal instrument")

    def save(self):
        self.data["asOf"] = datetime.now(timezone.utc).isoformat()
        content = base64.b64encode(json.dumps(self.data, allow_nan=False).encode()).decode()
        args = ["gh", "api", "--method", "PUT", API + "/" + FILE, "-f", "branch=" + BRANCH,
                "-f", "content=" + content, "-f", "message=Update BTC filter demo journal", "--jq", ".content.sha"]
        if self.sha:
            args += ["-f", "sha=" + self.sha]
        self.sha = subprocess.check_output(args, text=True).strip()


def quote(keys):
    book, = get("/api/v5/market/books", keys, instId=INSTRUMENT, sz="1")
    bid, ask = (D(book[k][0][0]) for k in ("bids", "asks"))
    if (not 0 <= time.time()*1000-int(book["ts"]) <= 5000 or not 0 < bid <= ask
            or min(D(book[k][0][1]) for k in ("bids", "asks")) < SIZE):
        raise PreflightError("invalid executable book")
    return book, bid, ask


def read_order(keys, cid, side, closing):
    try:
        row, = get(ORDER, keys, instId=INSTRUMENT, clOrdId=cid)
    except pilot.VenueError as exc:
        if exc.code == "51603":
            return None
        raise
    if (row["instId"] != INSTRUMENT or row["clOrdId"] != cid or row["side"] != side
            or D(row["sz"]) != SIZE or str(row["reduceOnly"]).lower() != str(closing).lower()):
        raise PreflightError("wrong demo order identity")
    if row["state"] not in ("filled", "canceled"):
        raise PreflightError("demo order awaiting reconciliation")
    if D(row["accFillSz"]) not in (0, SIZE):
        raise PreflightError("unexpected partial fill")
    return row


def send(keys, cid, side, closing, price=None):
    body = dict(instId=INSTRUMENT, tdMode="cross", sz=str(SIZE), clOrdId=cid, side=side,
                ordType="market" if closing else "ioc", reduceOnly=closing)
    if price is not None:
        body["px"] = price
    ack, = request("POST", ORDER, keys, json.dumps(body), int(time.time()*1000)+5000)
    if ack.get("sCode") != "0" or ack.get("clOrdId") != cid:
        raise PreflightError("unconfirmed demo order")
    time.sleep(2)


def modeled(entry, exit_price, sign):
    return SIZE * (sign*(exit_price-entry) - FEE*(entry+exit_price))


def exit_reason(net, stake, held):
    if net >= 2*stake:
        return "target"
    if net <= -D(".30")*stake:
        return "stop"
    if held >= 600:
        return "time"


def finish(keys, journal, trade):
    direction = trade["signal"]
    sign = 1 if direction == "LONG" else -1
    opening, closing = ("buy", "sell") if sign == 1 else ("sell", "buy")
    prefix = "MerF" + trade["day"].replace("-", "")
    if trade["accepted"] and trade["state"] == "reserved":
        row = read_order(keys, prefix+"I", opening, False)
        if row is None:
            raise PreflightError("entry receipt exists; venue order unconfirmed")
        trade["demoFilled"] = D(row["accFillSz"]) == SIZE
        if trade["demoFilled"]:
            if row["feeCcy"] != "USDC":
                raise PreflightError("unexpected fee currency")
            trade.update(entryOrder=row["ordId"], demoEntry=row["avgPx"], entryFee=row["fee"])
        verify_position(keys, sign*SIZE if trade["demoFilled"] else D(0))
        trade["state"] = "tracking"
        journal.save()
    if trade["state"] == "tracking":
        entry = D(trade["modelEntry"])
        while True:
            _, bid, ask = quote(keys)
            price = bid if sign == 1 else ask
            net = modeled(entry, price, sign)
            reason = exit_reason(net, entry*SIZE, time.time()-trade["openedMs"]/1000)
            if reason:
                trade.update(modelExit=str(price), modelBase=str(net),
                             modelFiltered=str(net if trade["accepted"] else D(0)),
                             exitReason=reason, modelExitMs=int(time.time()*1000), state="exit_due")
                journal.save()
                break
            time.sleep(15)
    if trade.get("demoFilled"):
        exit_id = prefix+"O"
        row = read_order(keys, exit_id, closing, True)
        if row is None:
            verify_position(keys, sign*SIZE)
            fills = get("/api/v5/trade/fills", keys, instType="FUTURES", instId=INSTRUMENT, limit="1")
            if (not fills or fills[0]["ordId"] != trade["entryOrder"]
                    or get("/api/v5/trade/orders-pending", keys, instId=INSTRUMENT)):
                raise PreflightError("unexpected activity on demo position")
            send(keys, exit_id, closing, True)
            row = read_order(keys, exit_id, closing, True)
        if not row or D(row["accFillSz"]) != SIZE or row["feeCcy"] != "USDC":
            raise PreflightError("exit awaiting confirmed fill")
        verify_position(keys, D(0))
        trade.update(exitOrder=row["ordId"], demoExit=row["avgPx"],
                     demoAfterFees=str(D(row["pnl"])+D(row["fee"])+D(trade["entryFee"])))
    trade["state"] = "closed"
    journal.save()


def run(keys, journal):
    sessions = journal.data["sessions"]
    for trade in sessions.values():
        if trade["state"] != "closed":
            finish(keys, journal, trade)
    obs = observation(keys)
    journal.data["observation"] = obs
    journal.save()
    day = obs["lastSessionUtc"]
    signal = obs["flatStartSignal"]
    if (day in sessions or signal == "FLAT" or obs["status"] != "EVALUATED"
            or datetime.now(timezone.utc).date().isoformat() > LAST_DAY):
        return
    accepted = obs["filteredLong" if signal == "LONG" else "filteredShort"]
    contract = check(keys)
    book, bid, ask = quote(keys)
    side = "buy" if signal == "LONG" else "sell"
    price = pilot.entry_price(book, D(contract["tickSz"]), side, time.time()*1000)
    trade = dict(day=day, signal=signal, accepted=accepted, decision=obs, openedMs=int(book["ts"]),
                 modelEntry=str(ask if side == "buy" else bid), demoFilled=False,
                 state="reserved" if accepted else "tracking")
    sessions[day] = trade
    journal.save()
    if accepted:
        # After persisting intent, refresh the price ceiling and verify the quote before submission.
        book, _, _ = quote(keys)
        price = pilot.entry_price(book, D(contract["tickSz"]), side, time.time()*1000)
        send(keys, "MerF"+day.replace("-", "")+"I", side, False, price)
    finish(keys, journal, trade)


def funding_between_orders(keys, trade):
    # Both order bills must be visible in the same uninterrupted account-ledger interval.
    params = dict(instType="FUTURES", ccy="USDC", begin=str(trade["openedMs"]-60_000), limit="100")
    close_seen = False
    total = D(0)
    last = None
    for _ in range(10):
        rows = get("/api/v5/account/bills-archive", keys, **params)
        if not rows:
            return None
        for row in rows:
            bill = int(row["billId"])
            if last is not None and bill >= last:
                return None
            last = bill
            if row["instId"] != INSTRUMENT or row["ccy"] != "USDC":
                continue
            if row["type"] == "2":
                if row["ordId"] == trade["exitOrder"] and not close_seen:
                    close_seen = True
                elif row["ordId"] == trade["entryOrder"]:
                    return total if close_seen else None
                elif close_seen:
                    return None
            elif close_seen and row["type"] == "8":
                change = D(row["balChg"])
                if not change.is_finite():
                    raise ValueError("invalid funding bill")
                total += change
        params["after"] = str(last)
    return None


def reconcile_funding(keys, journal):
    for trade in journal.data["sessions"].values():
        if trade["state"] != "closed" or not trade["demoFilled"] or "demoNetUSDC" in trade:
            continue
        funding = funding_between_orders(keys, trade)
        if funding is not None:
            trade.update(fundingUSDC=str(funding), demoNetUSDC=str(D(trade["demoAfterFees"])+funding))
            journal.save()


if __name__ == "__main__":
    keys = tuple(os.environ[n] for n in NAMES)
    journal = Journal()
    run(keys, journal)
    reconcile_funding(keys, journal)
