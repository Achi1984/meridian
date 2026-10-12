"""Bounded local receipt projection. Does not authenticate reported CI evidence."""
import datetime
import json
import os
import re
from pathlib import Path


def require(value):
    if not value:
        raise ValueError("SUMMARY_REJECTED")


def check_expiry(value, now=None):
    require(type(value) is str and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value) is not None)
    expires = datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    require(now < expires <= now + datetime.timedelta(minutes=90))


def summarize(receipt, expected_head, expected_run):
    require(type(receipt) is dict)
    require(type(expected_head) is str and re.fullmatch(r"[0-9a-f]{40}", expected_head) is not None)
    require(type(expected_run) is int and expected_run > 0)
    require(type(receipt.get("schema")) is int and receipt["schema"] == 1)
    for key, value in {"kind": "MERIDIAN_READ_ONLY_EVENT_RECEIPT", "repository": "Achi1984/meridian",
                       "controlSha": expected_head, "mainSha": expected_head,
                       "event": "workflow_run", "authority": "NONE"}.items():
        require(receipt.get(key) == value)
    flags = ("dispatchAllowed", "mergeAllowed", "durableDeduplication", "leaseAcquired")
    require(all(receipt.get(key) is False for key in flags))
    source = receipt.get("source")
    require(type(source) is dict)
    for key, value in {"runId": expected_run, "attempt": 2, "workflowId": 347821227}.items():
        require(type(source.get(key)) is int and source[key] == value)
    require(source.get("headSha") == expected_head and source.get("conclusion") == "success"
            and source.get("sourceEvent") == "push")
    evidence = source.get("ciEvidence")
    require(type(evidence) is dict)
    for key, value in {"runId": expected_run, "runAttempt": 2, "workflowId": 347821227}.items():
        require(type(evidence.get(key)) is int and evidence[key] == value)
    require(evidence.get("headSha") == expected_head and evidence.get("evidenceClass") == "JOB_LOG_REPORTED_COUNTERS")
    evidence_flags = ("authenticated", "provenanceVerified", "testOutputForgeryExcluded", "dispatchAllowed", "mergeAllowed")
    require(all(evidence.get(key) is False for key in evidence_flags))
    # Extra fields (including logs/comments) are neither copied nor printed.
    summary = {"repository": "Achi1984/meridian", "controlSha": expected_head,
               "mainSha": expected_head, "event": "workflow_run", "sourceEvent": "push",
               "runId": expected_run, "attempt": 2, "workflowId": 347821227,
               "headSha": expected_head, "conclusion": "success", "authority": "NONE"}
    summary.update({key: False for key in flags + evidence_flags})
    output = json.dumps(summary, sort_keys=True, separators=(",", ":"))
    require(len(output.encode()) <= 1024)
    return output


def cli():
    try:
        check_expiry(os.environ["PILOT_EXPIRES_AT"])
        with Path(os.environ["RECEIPT_PATH"]).open("rb") as stream:
            raw = stream.read(4097)
        require(len(raw) <= 4096)
        def unique(pairs):
            result = {}
            for key, value in pairs:
                require(key not in result)
                result[key] = value
            return result
        receipt = json.loads(raw, object_pairs_hook=unique,
                            parse_constant=lambda value: require(False))
        run = os.environ["SOURCE_RUN_ID"]
        require(re.fullmatch(r"[1-9][0-9]{0,19}", run) is not None)
        print(summarize(receipt, os.environ["GITHUB_SHA"], int(run)))
    except Exception:
        raise SystemExit("Read-only receipt summary rejected") from None


if __name__ == "__main__":
    cli()
