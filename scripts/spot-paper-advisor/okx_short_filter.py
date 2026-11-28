"""Observe paired flat-start short decisions on the EEA demo contract."""
import json
import os
from pathlib import Path
import time
from decimal import Decimal

MINUTE = 60_000


def decide(signal, rate, interest, now, instrument):
    if rate["instId"] != instrument or not 0 <= now - int(rate["ts"]) <= 5 * MINUTE:
        raise ValueError("wrong instrument or stale funding")
    funding = Decimal(rate["fundingRate"])
    if not funding.is_finite():
        raise ValueError("invalid funding")
    history = {}
    for row in interest:
        ts = int(row[0])
        if ts > now:
            continue
        contracts = Decimal(row[1])
        if ts in history or not contracts.is_finite() or contracts <= 0:
            raise ValueError("invalid open interest")
        history[ts] = contracts
    latest = max(history, default=0)
    target = latest - 60 * MINUTE
    earlier = min(history, key=lambda ts: abs(ts - target), default=0)
    if now - latest > 10 * MINUTE or abs(earlier - target) > 5 * MINUTE:
        raise ValueError("missing hourly open interest pair")
    veto = funding < 0 and history[latest] > history[earlier]
    return dict(baselineShort=signal == "SHORT", filteredShort=signal == "SHORT" and not veto,
                fundingRate=str(funding), fundingTs=int(rate["ts"]), oiTs=latest,
                oiContracts=str(history[latest]), priorOiTs=earlier, priorOiContracts=str(history[earlier]),
                vetoCondition=veto)


def main():
    from okx_swing_observation import DAY_MS, NAMES, SPOT, get, observe
    from okx_demo_preflight import INSTRUMENT

    keys = tuple(os.environ[name] for name in NAMES)
    rows = get("/api/v5/market/candles", keys, instId=SPOT, bar="1Dutc", limit="100")
    now = time.time_ns() // 1_000_000
    signal = observe(rows, now // DAY_MS * DAY_MS)
    funding = get("/api/v5/public/funding-rate", keys, instId=INSTRUMENT)
    rows = get("/api/v5/public/open-interest", keys, instType="FUTURES", instId=INSTRUMENT)
    item, = rows
    decision = time.time_ns() // 1_000_000
    ts = int(item["ts"])
    count = Decimal(item["oi"])
    if (item["instId"] != INSTRUMENT or not 0 <= decision - ts <= 5 * MINUTE
            or not count.is_finite() or count <= 0):
        raise ValueError("invalid current open interest")
    path = Path("btc-demo-oi-history.json")
    history = json.loads(path.read_text()) if path.exists() else {}
    history = {t: v for t, v in history.items() if ts - 3_600_000 * 3 <= int(t) < ts}
    history[str(ts)] = str(count)
    path.write_text(json.dumps(history))
    result = dict(baselineShort=signal["flatStartSignal"] == "SHORT",
                  filteredShort=None, status="WAITING_FOR_HOURLY_PAIR", oiTs=ts, oiContracts=str(count))
    if any(abs(ts - int(t) - 60 * MINUTE) <= 5 * MINUTE for t in history):
        result = dict(decide(signal["flatStartSignal"], funding[0], history.items(), decision, INSTRUMENT),
                      status="EVALUATED")
    print(json.dumps(dict(signal, instrument=INSTRUMENT, decisionTs=decision, **result)))


if __name__ == "__main__":
    main()
