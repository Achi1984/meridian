"""Observe paired flat-start short decisions on the EEA demo contract."""
import json
import os
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
    earlier = latest - 60 * MINUTE
    if now - latest > 10 * MINUTE or earlier not in history:
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
    oi = get("/api/v5/rubik/stat/contracts/open-interest-history", keys,
             instId=INSTRUMENT, period="5m", limit="24")
    decision = time.time_ns() // 1_000_000
    if decision // DAY_MS != now // DAY_MS or len(funding) != 1:
        raise ValueError("ambiguous decision snapshot")
    result = decide(signal["flatStartSignal"], funding[0], oi, decision, INSTRUMENT)
    print(json.dumps(dict(instrument=INSTRUMENT, decisionTs=decision, **signal, **result)))


if __name__ == "__main__":
    main()
