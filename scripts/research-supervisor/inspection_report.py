"""Manually inspect one existing B1 generated-fixture journal; never execute work."""

import argparse
import json
import re
import sqlite3
import sys

import journal

MAX_REPORT_BYTES = 16384
SCHEMA = "MERIDIAN_B1_INSPECTION_REPORT_V1"


class ReportError(Exception):
    pass


def _need(condition):
    if not condition:
        raise ReportError("INVALID_INSPECTION_PROJECTION")


def build_report(database, trial_id):
    # Reuse the full read-only journal integrity check. No alternate SQL path.
    value = journal.inspect_b1(database, trial_id)
    _need(value.get("profile") == journal.B1_PROFILE_NAME)
    state = value.get("state")
    _need(state in {"queued", "unknown", "completed", "rejected", "failed", "timed_out", "partial"})
    _need(type(value.get("unresolved")) is bool)
    _need(not value["unresolved"] or state == "unknown")
    for name in ("executionAuthorized", "promotionAuthorized", "profitabilityInferred"):
        _need(value.get(name) is False)
    _need(type(value.get("attempts")) is int and value["attempts"] in (0, 1))
    _need(type(value.get("fence")) is int and 0 <= value["fence"] <= journal.MAX_INT)
    _need(value.get("trialId") == trial_id and re.fullmatch(r"[a-f0-9]{64}", trial_id))
    identities = {}
    for name in ("protocolSha256", "sourceSha256", "dataSha256", "manifestSha256", "resultSha256", "summarySha256"):
        digest = value.get(name)
        _need((digest is None and name in {"resultSha256", "summarySha256"}) or
              (type(digest) is str and re.fullmatch(r"[a-f0-9]{64}", digest)))
        identities[name] = digest
    timestamps = value.get("timestamps")
    _need(type(timestamps) is dict and set(timestamps) == {"createdAt", "startedAt", "finishedAt"})
    for stamp in timestamps.values():
        _need(stamp is None or (type(stamp) is str and len(stamp) <= 64 and
              re.fullmatch(r"[0-9TZ:+.\-]+", stamp)))
    paths = value.get("paths")
    _need(type(paths) is list and len(paths) <= 44)
    _need(all(type(item) is dict and item.get("state") in {"started", "completed"} for item in paths))
    reason = value.get("reason")
    # Never echo arbitrary operator-controlled text or raw result/controls.
    reason_code = reason if type(reason) is str and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", reason) else None
    return {
        "schema": SCHEMA, "profile": journal.B1_PROFILE_NAME,
        "evidenceClass": "SYNTHETIC_ONLY", "trialId": trial_id,
        "state": state, "unresolved": value["unresolved"],
        "requiresExplicitReconciliation": value["unresolved"],
        "attempts": value["attempts"], "fence": value["fence"],
        "fenceInterpretation": "UNRESOLVED_FENCE_RETAINED" if value["unresolved"] else "NO_UNRESOLVED_FENCE_FOR_THIS_TRIAL",
        "integrity": "STORED_JOURNAL_VALIDATED_NOT_SOURCE_AUTHENTICITY",
        "timestamps": dict(timestamps), "identities": identities,
        "pathsStarted": len(paths),
        "pathsCompleted": sum(item["state"] == "completed" for item in paths),
        "reasonCode": reason_code,
        "executionAuthorized": False, "promotionAuthorized": False,
        "profitabilityInferred": False, "recoveryPerformed": False,
    }


def encode_report(report):
    encoded = (json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                          allow_nan=False) + "\n").encode("utf-8")
    if len(encoded) > MAX_REPORT_BYTES:
        raise ReportError("REPORT_TOO_LARGE")
    return encoded


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", help="existing local B1 generated-fixture SQLite journal")
    parser.add_argument("trial_id", help="exact trial SHA-256 identifier")
    args = parser.parse_args(argv)
    try:
        encoded = encode_report(build_report(args.database, args.trial_id))
    except (journal.JournalError, ReportError, sqlite3.Error, OSError, ValueError, TypeError, KeyError, RecursionError):
        # No path, SQL, stored payload, or exception text is emitted.
        sys.stderr.write('{"schema":"' + SCHEMA + '","error":"INSPECTION_FAILED"}\n')
        return 1
    sys.stdout.buffer.write(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
