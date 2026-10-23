"""Read-only, bounded inspection of one existing historical-profile journal trial."""

import argparse
import json
import re
import sqlite3
import sys

import journal

MAX_REPORT_BYTES = 16384
SCHEMA = "MERIDIAN_HISTORICAL_INSPECTION_REPORT_V1"
HASH = re.compile(r"[a-f0-9]{64}")
STATES = {"queued", "unknown", "completed", "rejected", "failed", "timed_out", "partial"}


class ReportError(Exception):
    pass


def _need(condition):
    if not condition:
        raise ReportError("INVALID_INSPECTION_PROJECTION")


def build_report(database, trial_id):
    _need(type(trial_id) is str and HASH.fullmatch(trial_id) is not None)
    value = journal.inspect_b1(database, trial_id)
    _need(value.get("profile") == journal.HISTORICAL_PROFILE_NAME)
    _need(value.get("trialId") == trial_id)
    state = value.get("state")
    _need(state in STATES)
    unresolved = value.get("unresolved")
    _need(type(unresolved) is bool and (not unresolved or state == "unknown"))
    for name in ("executionAuthorized", "promotionAuthorized", "profitabilityInferred"):
        _need(value.get(name) is False)
    attempts, fence = value.get("attempts"), value.get("fence")
    _need(type(attempts) is int and attempts in (0, 1))
    _need(type(fence) is int and 0 <= fence <= journal.MAX_INT)
    _need((state in {"queued", "rejected"} and attempts == 0 and fence == 0)
          or (state not in {"queued", "rejected"} and attempts == 1 and fence > 0))

    identities = {}
    for name in ("protocolSha256", "sourceSha256", "dataSha256", "manifestSha256",
                 "resultSha256", "summarySha256"):
        digest = value.get(name)
        _need((digest is None and name in {"resultSha256", "summarySha256"})
              or (type(digest) is str and HASH.fullmatch(digest) is not None))
        identities[name] = digest
    _need((identities["resultSha256"] is None) == (identities["summarySha256"] is None))

    timestamps = value.get("timestamps")
    _need(type(timestamps) is dict and set(timestamps) == {
        "createdAt", "startedAt", "finishedAt",
    })
    for stamp in timestamps.values():
        _need(stamp is None or (type(stamp) is str and len(stamp) <= 64
                                and re.fullmatch(r"[0-9TZ:+.\-]+", stamp) is not None))
    paths = value.get("paths")
    _need(type(paths) is list and len(paths) <= 44)
    _need(all(type(item) is dict and item.get("state") in {"started", "completed"}
              for item in paths))
    reason = value.get("reason")
    reason_code = (reason if type(reason) is str
                   and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", reason) else None)

    return {
        "schema": SCHEMA,
        "status": "OBSERVED",
        "observationScope": "ONE_JOURNAL_TRIAL",
        "profile": journal.HISTORICAL_PROFILE_NAME,
        "trialId": trial_id,
        "state": state,
        "unresolved": unresolved,
        "requiresExplicitReconciliation": unresolved,
        "attempts": attempts,
        "fence": fence,
        "timestamps": dict(timestamps),
        "identities": identities,
        "pathsStarted": len(paths),
        "pathsCompleted": sum(item["state"] == "completed" for item in paths),
        "reasonCode": reason_code,
        "integrity": "STORED_JOURNAL_VALIDATED_NOT_SOURCE_AUTHENTICITY",
        "historicalCompleteness": "NOT_ESTABLISHED",
        "sourceAuthenticity": "NOT_ESTABLISHED",
        "executionAuthorized": False,
        "promotionAuthorized": False,
        "profitabilityInferred": False,
        "recoveryPerformed": False,
    }


def encode_report(report):
    encoded = (json.dumps(report, sort_keys=True, separators=(",", ":"),
                          ensure_ascii=True, allow_nan=False) + "\n").encode("utf-8")
    if len(encoded) > MAX_REPORT_BYTES:
        raise ReportError("REPORT_TOO_LARGE")
    return encoded


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", help="path to an existing historical-profile SQLite journal")
    parser.add_argument("trial_id", help="exact trial SHA-256 identifier")
    args = parser.parse_args(argv)
    try:
        encoded = encode_report(build_report(args.database, args.trial_id))
    except (journal.JournalError, ReportError, sqlite3.Error, OSError, ValueError,
            TypeError, KeyError, RecursionError):
        sys.stderr.write(
            '{"schema":"' + SCHEMA + '","status":"NOT_OBSERVED",'
            '"error":"INSPECTION_FAILED"}\n'
        )
        return 1
    sys.stdout.buffer.write(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
