"""Audit account C using selection-time pool metrics in Meridian ABC artifact ZIPs."""
import argparse
import json
from collections import defaultdict
from zipfile import ZipFile


def audit(path):
    with ZipFile(path) as archive:
        status = json.loads(archive.read("status.json"))
        events = map(json.loads, archive.read("events.jsonl").splitlines())
        account = status["accounts"]["C"]
        selections, positions, closed = {}, {}, []
        for event in events:
            key = event["session"], event.get("mint")
            if event["event"] == "cohortSelection":
                selections[key] = event
            for fill in event.get("fills", []):
                if fill["account"] != "C":
                    continue
                pid = fill["positionId"]
                if fill["side"] == "buy":
                    if pid in positions:
                        raise ValueError("duplicate buy")
                    positions[pid] = (fill, selections.get(key), event["at"])
                elif fill["side"] == "sell":
                    buy, source, entry_time = positions.pop(pid)
                    if buy["qty"] != fill["qty"]:
                        raise ValueError("partial close unsupported")
                    # Account C charges 0.05 USDC per side.
                    net = fill["usdcRaw"] - buy["usdcRaw"] - 100000
                    groups = ["all"]
                    if source and source["at"] <= entry_time:
                        buys, sells = source.get("buys"), source.get("sells")
                        if buys is not None and sells is not None and buys + sells > 0:
                            groups.append("buyShare>=2/3" if buys >= 2*sells else "buyShare<2/3")
                        liq = source.get("entryLiquidityUsd")
                        if liq is not None:
                            groups.append("liquidity<20k" if liq < 20000 else "liquidity>=20k")
                    closed.append((pid, net, groups))
                else:
                    raise ValueError("unsupported side")
    if (len(closed) != account["closedTrades"] or
            set(positions) != {p["positionId"] for p in account["openPositions"]} or
            sum(net for _, net, _ in closed) != round(account["realizedUsdc"] * 1_000_000)):
        raise ValueError("fill totals differ from published account")
    buckets = defaultdict(list)
    for _, net, groups in closed:
        for group in groups:
            buckets[group].append(net)
    return {"end": status["updatedAt"], "open": len(positions), "groups": {
        name: {"closed": len(values), "wins": sum(x > 0 for x in values),
               "net": sum(values)/1e6, "withoutBestTrade": (sum(values)-max(values))/1e6,
               "worstTwo": sum(sorted(values)[:2])/1e6}
        for name, values in sorted(buckets.items())}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archives", nargs="+")
    for path in parser.parse_args().archives:
        print(json.dumps(audit(path), sort_keys=True))
