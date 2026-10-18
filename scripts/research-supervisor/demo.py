"""Explicit local-only demonstration; no import-time work or external services."""

import argparse
import hashlib
import json

import journal
import supervisor


def run(database):
    source = hashlib.sha256(b"m11-synthetic-adapter-demo-source-v1").hexdigest()
    data = hashlib.sha256(b"m11-synthetic-empty-data-label-v1").hexdigest()
    journal.initialize(database)
    journal.enqueue(database, "trial-synthetic-demo", source, data, data_bytes=0)
    policy = {
        "enabled": True,
        "protocol_sha256": journal.PROTOCOL_SHA256,
        "source_sha256": source,
        "data_sha256": data,
        "daily_batch_limit": 1,
        "daily_compute_seconds": journal.MAX_BATCH_SECONDS,
        "daily_data_bytes": 0,
        "daily_model_calls": 0,
    }
    tick = journal.scheduler_tick(database, policy, owner="synthetic-demo")
    if not tick["claimed"]:
        raise RuntimeError(tick["reason"] if "reason" in tick else tick["state"])
    result = supervisor.run_batch(database, tick["claim"])
    return {
        "state": result["state"],
        "trialId": result["trialId"],
        "pathCount": len(result["paths"]),
        "resultSha256": result["resultSha256"],
        "executionAuthorized": result["executionAuthorized"],
        "promotionAuthorized": result["promotionAuthorized"],
        "limitation": "synthetic fixture only; no approved engine, market data, or promotion",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", help="new local SQLite path; existing paths are refused")
    args = parser.parse_args()
    print(json.dumps(run(args.database), sort_keys=True))


if __name__ == "__main__":
    main()
