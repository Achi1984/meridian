"""Attribute account C outcomes to holder evidence recorded at entry in a final campaign ZIP."""
import argparse
import json
from decimal import Decimal
from zipfile import ZipFile

from meme_paper_account import FEE, UNIT


def audit(archive):
    positions = {}
    with ZipFile(archive) as source:
        status = json.loads(source.read("status.json"))
        if status["lastEvent"] != "finished" or status.get("ledgerVerified") is not True:
            raise ValueError("Expected a finished, reconciled campaign")
        threshold = status["holderComparison"]["thresholdBps"]
        with source.open("events.jsonl") as journal:
            for line in journal:
                row = json.loads(line)
                for fill in row["fills"]:
                    if fill["account"] != "C":
                        continue
                    key = fill["positionId"]
                    if fill["side"] == "buy":
                        if key in positions:
                            raise ValueError(f"Duplicate reference entry {key}")
                        evidence = row["holderEvidence"]
                        state = evidence["state"]
                        if state not in ("unknown", "high", "belowThreshold"):
                            raise ValueError(f"Unexpected holder state for {key}")
                        share = None if state == "unknown" else evidence["largestOwnerBps"]
                        if share is not None and (share >= threshold) != (state == "high"):
                            raise ValueError(f"Holder state disagrees with threshold for {key}")
                        positions[key] = dict(positionId=key, state=state, largestOwnerBps=share,
                                              unknownReason=evidence.get("reason"), netRaw=None,
                                              costRaw=fill["usdcRaw"] + FEE, qty=fill["qty"])
                    elif fill["side"] == "sell":
                        pos = positions[key]
                        if pos["netRaw"] is not None or pos["qty"] != fill["qty"]:
                            raise ValueError(f"Unexpected reference exit {key}")
                        pos["netRaw"] = fill["usdcRaw"] - FEE - pos["costRaw"]
                    else:
                        raise ValueError(f"Unexpected fill side for {key}")

    closed = [p for p in positions.values() if p["netRaw"] is not None]
    account = status["accounts"]["C"]
    if (len(closed) != account["closedTrades"]
            or len(positions) - len(closed) != len(account["openPositions"])
            or sum(p["netRaw"] for p in closed) != Decimal(str(account["realizedUsdc"])) * UNIT):
        raise ValueError("Reference fills disagree with final account C")
    return dict(thresholdBps=threshold, referencePositions=list(positions.values()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    print(json.dumps(audit(parser.parse_args().archive), indent=2))
