"""Same-host, one-shot journal for bounded synthetic research batches."""

import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
from datetime import datetime, timezone


PATHS = tuple(
    [{"id": "development-01", "variant": "synthetic-development"}]
    + [{"id": f"frozen-control-{index:02d}", "variant": "synthetic-frozen-control"}
       for index in range(1, 44)]
)
MANIFEST_JSON = json.dumps(PATHS, sort_keys=True, separators=(",", ":"))
MANIFEST_SHA256 = hashlib.sha256(MANIFEST_JSON.encode()).hexdigest()
PROTOCOL_SHA256 = hashlib.sha256(
    ("meridian-m11-synthetic-sequential-protocol-v1\n" + MANIFEST_SHA256).encode()
).hexdigest()
MAX_PATHS = 44
MAX_JOBS = 1000
MAX_RESULT_BYTES = 1_048_576
MAX_PROGRESS_BYTES = 65_536
MAX_DATA_BYTES = 1_073_741_824
MAX_BATCH_SECONDS = 1800
MAX_PATH_SECONDS = 60
MAX_POLICY_BATCHES_PER_DAY = 1
MAX_INT = 9_007_199_254_740_991
DEFAULT_POLICY = {
    "enabled": False,
    "protocol_sha256": PROTOCOL_SHA256,
    "source_sha256": "0" * 64,
    "data_sha256": "0" * 64,
    "daily_batch_limit": 0,
    "daily_compute_seconds": 0,
    "daily_data_bytes": 0,
    "daily_model_calls": 0,
}


class JournalError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _need(ok, code):
    if not ok:
        raise JournalError(code)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def _digest(value):
    return type(value) is str and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def _database_path(database):
    try:
        raw = os.fspath(database)
    except TypeError:
        raise JournalError("DATABASE_INVALID")
    _need(type(raw) is str and raw and raw != ":memory:" and "\0" not in raw and len(raw.encode()) <= 4096,
          "DATABASE_INVALID")
    return Path(raw).absolute()


def _timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def initialize(database):
    """Create a new private database only; never reset or migrate an existing file."""
    path = _database_path(database)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
    except FileExistsError:
        raise JournalError("DATABASE_EXISTS")
    except OSError:
        raise JournalError("DATABASE_CREATE_FAILED")
    connection = None
    try:
        connection = sqlite3.connect(path, isolation_level=None)
        connection.execute("PRAGMA page_size=4096")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA max_page_count=16384")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), fence INTEGER NOT NULL, active TEXT)")
        connection.execute("INSERT INTO meta VALUES (1,0,NULL)")
        connection.execute("""CREATE TABLE jobs (
            trial_id TEXT PRIMARY KEY,
            trial_key TEXT NOT NULL UNIQUE,
            identity_json TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('QUEUED','CLAIMED','RUNNING','COMPLETED','REJECTED','FAILED','TIMED_OUT','PARTIAL','UNKNOWN')),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
            owner TEXT,
            fence INTEGER NOT NULL DEFAULT 0,
            data_bytes INTEGER NOT NULL,
            policy_json TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            progress_json TEXT NOT NULL DEFAULT '[]',
            result_json TEXT,
            result_sha256 TEXT,
            reason TEXT
        )""")
        connection.execute("""CREATE TABLE daily_budget (
            utc_day TEXT PRIMARY KEY,
            batches INTEGER NOT NULL,
            compute_seconds INTEGER NOT NULL,
            data_bytes INTEGER NOT NULL,
            model_calls INTEGER NOT NULL
        )""")
        connection.execute("PRAGMA user_version=1")
        connection.commit()
    except sqlite3.Error:
        raise JournalError("DATABASE_CREATE_FAILED")
    finally:
        if connection is not None:
            connection.close()
    return {"initialized": True, "active": False, "executionAuthorized": False}


def _connect(database):
    path = _database_path(database)
    try:
        connection = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=5, isolation_level=None)
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA max_page_count=16384")
        connection.execute("BEGIN IMMEDIATE")
        _need(connection.execute("PRAGMA user_version").fetchone() == (1,), "DATABASE_SCHEMA")
        _need(connection.execute("PRAGMA page_size").fetchone() == (4096,), "DATABASE_SCHEMA")
        _need(connection.execute("SELECT COUNT(*) FROM meta").fetchone() == (1,), "DATABASE_SCHEMA")
        return connection
    except (sqlite3.Error, JournalError) as error:
        if "connection" in locals():
            connection.close()
        if isinstance(error, JournalError):
            raise
        raise JournalError("DATABASE_UNAVAILABLE")


def _load_progress(raw):
    _need(type(raw) is str and len(raw.encode()) <= MAX_PROGRESS_BYTES, "STORED_PROGRESS")
    try:
        value = json.loads(raw)
    except (ValueError, RecursionError):
        raise JournalError("STORED_PROGRESS")
    _need(type(value) is list and len(value) <= MAX_PATHS and _canonical(value) == raw, "STORED_PROGRESS")
    return value


def _job_projection(row):
    (trial_id, trial_key, identity_raw, state, attempts, owner, fence, data_bytes,
     policy_raw, created_at, started_at, finished_at, progress_raw, result_json,
     result_sha256, reason) = row
    try:
        identity = json.loads(identity_raw)
        progress = _load_progress(progress_raw)
    except (ValueError, TypeError):
        raise JournalError("STORED_JOB_CORRUPT")
    _need(type(trial_key) is str and type(identity) is dict and _canonical(identity) == identity_raw
          and identity.get("trial_id") == trial_id
          and hashlib.sha256(trial_key.encode()).hexdigest() == trial_id
          and identity.get("trial_key") == trial_key and identity.get("data_bytes") == data_bytes,
          "STORED_JOB_CORRUPT")
    _need(identity.get("protocol_sha256") == PROTOCOL_SHA256
          and identity.get("manifest_sha256") == MANIFEST_SHA256
          and identity.get("paths") == list(PATHS)
          and identity.get("variants") == list(dict.fromkeys(path["variant"] for path in PATHS))
          and _digest(identity.get("source_sha256")) and _digest(identity.get("data_sha256")),
          "STORED_JOB_CORRUPT")
    _need(len(progress) <= MAX_PATHS and type(data_bytes) is int and 0 <= data_bytes <= MAX_DATA_BYTES,
          "STORED_JOB_CORRUPT")
    _need(len(progress) <= len(PATHS), "STORED_PROGRESS")
    predecessor = hashlib.sha256((trial_id + "\n" + PROTOCOL_SHA256).encode()).hexdigest()
    for index, path in enumerate(progress):
        expected = PATHS[index]
        required = {"pathId", "variantId", "state", "predecessorSha256", "startedAt"}
        if type(path) is dict and path.get("state") == "completed":
            required |= {"outputSha256", "completedAt"}
        _need(type(path) is dict and path.get("pathId") == expected["id"]
              and path.get("variantId") == expected["variant"]
              and path.get("state") in ("started", "completed")
              and set(path) == required
              and path.get("predecessorSha256") == predecessor
              and type(path.get("startedAt")) is str, "STORED_PROGRESS")
        if index < len(progress) - 1:
            _need(path["state"] == "completed", "STORED_PROGRESS")
        if path["state"] == "completed":
            _need(_digest(path.get("outputSha256")) and type(path.get("completedAt")) is str,
                  "STORED_PROGRESS")
            predecessor = path["outputSha256"]
    if result_json is not None:
        _need(type(result_json) is str and len(result_json.encode()) <= MAX_RESULT_BYTES
              and _digest(result_sha256) and hashlib.sha256(result_json.encode()).hexdigest() == result_sha256,
              "STORED_RESULT_CORRUPT")
        def unique_pairs(items):
            parsed = {}
            for key, value in items:
                _need(key not in parsed, "STORED_RESULT_CORRUPT")
                parsed[key] = value
            return parsed
        try:
            result = json.loads(result_json, object_pairs_hook=unique_pairs)
        except (ValueError, RecursionError):
            raise JournalError("STORED_RESULT_CORRUPT")
        result_keys = {"trialId", "state", "reason", "pathResults", "timestamps",
                       "executionAuthorized", "promotionAuthorized"}
        if state == "UNKNOWN":
            result_keys.add("reconciledBy")
        _need(type(result) is dict and _canonical(result) == result_json
              and set(result) == result_keys and result["trialId"] == trial_id
              and result["state"] == state.lower() and result["reason"] == reason
              and result["pathResults"] == progress
              and result["timestamps"] == {"startedAt": started_at, "finishedAt": finished_at}
              and result["executionAuthorized"] is False and result["promotionAuthorized"] is False,
              "STORED_RESULT_CORRUPT")
        if state == "UNKNOWN":
            _need(result["reconciledBy"] == "explicit-local-operator", "STORED_RESULT_CORRUPT")
    else:
        _need(result_sha256 is None and state in ("QUEUED", "CLAIMED", "RUNNING", "REJECTED"),
              "STORED_RESULT_CORRUPT")
    _need(state in ("QUEUED", "CLAIMED", "RUNNING", "COMPLETED", "REJECTED",
                    "FAILED", "TIMED_OUT", "PARTIAL", "UNKNOWN"), "STORED_JOB_STATE")
    _need(type(created_at) is str and (started_at is None or type(started_at) is str)
          and (finished_at is None or type(finished_at) is str), "STORED_JOB_STATE")
    if state == "QUEUED":
        _need(attempts == 0 and owner is None and fence == 0 and started_at is None
              and finished_at is None and reason is None and not progress and policy_raw is None,
              "STORED_JOB_STATE")
    elif state == "REJECTED":
        _need(attempts == 0 and owner is None and fence == 0 and started_at is None
              and type(finished_at) is str and type(reason) is str and policy_raw is None
              and not progress and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", reason),
              "STORED_JOB_STATE")
    else:
        _need(attempts == 1 and type(owner) is str and 0 < fence <= MAX_INT
              and type(policy_raw) is str, "STORED_JOB_STATE")
        try:
            policy = json.loads(policy_raw)
            _need(_validate_policy(policy) == policy_raw
                  and policy["protocol_sha256"] == identity["protocol_sha256"]
                  and policy["source_sha256"] == identity["source_sha256"]
                  and policy["data_sha256"] == identity["data_sha256"], "STORED_JOB_STATE")
        except (ValueError, TypeError, KeyError):
            raise JournalError("STORED_JOB_STATE")
        if state == "CLAIMED":
            _need(started_at is None and finished_at is None and result_json is None
                  and reason is None and not progress, "STORED_JOB_STATE")
        elif state == "RUNNING":
            _need(type(started_at) is str and finished_at is None and result_json is None
                  and reason is None, "STORED_JOB_STATE")
        else:
            _need(type(finished_at) is str and type(reason) is str
                  and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", reason), "STORED_JOB_STATE")
            if state == "UNKNOWN":
                _need(type(started_at) is str or started_at is None, "STORED_JOB_STATE")
            else:
                _need(type(started_at) is str, "STORED_JOB_STATE")
    public_state = "unknown" if state in ("CLAIMED", "RUNNING") else state.lower()
    return {
        "trialId": trial_id,
        "trialKey": trial_key,
        "state": public_state,
        "attempts": attempts,
        "owner": owner,
        "fence": fence,
        "protocolSha256": identity["protocol_sha256"],
        "sourceSha256": identity["source_sha256"],
        "dataSha256": identity["data_sha256"],
        "manifestSha256": identity["manifest_sha256"],
        "variantIds": list(dict.fromkeys(path["variant"] for path in PATHS)),
        "pathIds": [path["id"] for path in PATHS],
        "budget": {"dataBytes": data_bytes, "batchesReserved": attempts,
                   "computeSecondsReserved": MAX_BATCH_SECONDS if attempts else 0,
                   "dataBytesReserved": data_bytes if attempts else 0, "modelCallsReserved": 0,
                   "maxBatchSeconds": MAX_BATCH_SECONDS, "maxPathSeconds": MAX_PATH_SECONDS},
        "timestamps": {"createdAt": created_at, "startedAt": started_at, "finishedAt": finished_at},
        "paths": progress,
        "result": result_json,
        "resultSha256": result_sha256,
        "reason": reason,
        "unresolved": state in ("CLAIMED", "RUNNING"),
        "executionAuthorized": False,
        "promotionAuthorized": False,
        "profitabilityInferred": False,
    }


def _read_job(connection, trial_id):
    row = connection.execute("SELECT * FROM jobs WHERE trial_id=?", (trial_id,)).fetchone()
    _need(row is not None, "TRIAL_NOT_FOUND")
    return _job_projection(row)


def _check_store(connection):
    meta = connection.execute("SELECT fence,active FROM meta WHERE id=1").fetchone()
    _need(meta is not None and type(meta[0]) is int and 0 <= meta[0] <= MAX_INT, "STORED_META")
    active = connection.execute("SELECT * FROM jobs WHERE state IN ('CLAIMED','RUNNING')").fetchall()
    _need(len(active) <= 1, "STORED_ACTIVE")
    if active:
        projection = _job_projection(active[0])
        _need(meta == (projection["fence"], projection["trialId"]), "STORED_ACTIVE")
    else:
        _need(meta[1] is None, "STORED_ACTIVE")
    fences = []
    for row in connection.execute("SELECT * FROM jobs"):
        projection = _job_projection(row)
        if row[3] not in ("QUEUED", "REJECTED"):
            _need(row[4] == 1 and row[5] and row[6] > 0, "STORED_JOB_STATE")
            fences.append(row[6])
        else:
            _need(row[4] == 0 and row[5] is None and row[6] == 0, "STORED_JOB_STATE")
    _need(len(set(fences)) == len(fences) and meta[0] == max(fences, default=0), "STORED_FENCE")
    total = connection.execute("""SELECT COALESCE(SUM(length(CAST(progress_json AS BLOB)) +
        COALESCE(length(CAST(result_json AS BLOB)),0)),0) FROM jobs""").fetchone()[0]
    _need(total <= MAX_RESULT_BYTES, "RESULT_CAPACITY")
    _need(connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] <= MAX_JOBS, "JOURNAL_CAPACITY")
    for day, batches, seconds, data_bytes, model_calls in connection.execute("SELECT * FROM daily_budget"):
        _need(type(day) is str and re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) is not None
              and type(batches) is int and 0 <= batches <= MAX_POLICY_BATCHES_PER_DAY
              and type(seconds) is int and 0 <= seconds <= MAX_BATCH_SECONDS
              and type(data_bytes) is int and 0 <= data_bytes <= MAX_DATA_BYTES
              and model_calls == 0, "STORED_BUDGET")


def _run(database, operation):
    connection = _connect(database)
    try:
        _check_store(connection)
        value = operation(connection)
        _check_store(connection)
        connection.commit()
        return value
    except sqlite3.Error:
        raise JournalError("JOURNAL_STORAGE_ERROR")
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def _read(database, operation):
    path = _database_path(database)
    try:
        connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5, isolation_level=None)
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        _need(connection.execute("PRAGMA user_version").fetchone() == (1,), "DATABASE_SCHEMA")
        _need(connection.execute("PRAGMA page_size").fetchone() == (4096,), "DATABASE_SCHEMA")
        _check_store(connection)
        value = operation(connection)
        _check_store(connection)
        connection.commit()
        return value
    except sqlite3.Error:
        raise JournalError("DATABASE_UNAVAILABLE")
    finally:
        if "connection" in locals():
            if connection.in_transaction:
                connection.rollback()
            connection.close()


def enqueue(database, trial_key, source_sha256, data_sha256, data_bytes=0):
    """Pin a trial identity to the fixed fixture protocol and content hashes."""
    _need(type(trial_key) is str and re.fullmatch(r"trial-[a-z0-9][a-z0-9-]{0,47}", trial_key) is not None,
          "TRIAL_KEY_INVALID")
    _need(_digest(source_sha256) and _digest(data_sha256), "HASH_INVALID")
    _need(type(data_bytes) is int and 0 <= data_bytes <= MAX_DATA_BYTES, "DATA_SIZE_INVALID")
    trial_id = hashlib.sha256(trial_key.encode()).hexdigest()
    identity = {
        "trial_id": trial_id,
        "trial_key": trial_key,
        "protocol_sha256": PROTOCOL_SHA256,
        "source_sha256": source_sha256,
        "data_sha256": data_sha256,
        "manifest_sha256": MANIFEST_SHA256,
        "data_bytes": data_bytes,
        "variants": list(dict.fromkeys(path["variant"] for path in PATHS)),
        "paths": list(PATHS),
    }
    identity_raw = _canonical(identity)

    def operation(connection):
        existing = connection.execute("SELECT * FROM jobs WHERE trial_id=?", (trial_id,)).fetchone()
        if existing:
            _need(existing[2] == identity_raw, "TRIAL_ID_CONFLICT")
            return _job_projection(existing)
        _need(connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] < MAX_JOBS, "JOURNAL_CAPACITY")
        connection.execute("""INSERT INTO jobs
            (trial_id,trial_key,identity_json,state,data_bytes,created_at)
            VALUES (?,?,?,'QUEUED',?,?)""",
            (trial_id, trial_key, identity_raw, data_bytes, _timestamp()))
        return _read_job(connection, trial_id)
    return _run(database, operation)


def _validate_policy(policy):
    fields = {"enabled", "protocol_sha256", "source_sha256", "data_sha256", "daily_batch_limit",
              "daily_compute_seconds", "daily_data_bytes", "daily_model_calls"}
    _need(type(policy) is dict and set(policy) == fields, "POLICY_SCHEMA")
    _need(type(policy["enabled"]) is bool and _digest(policy["protocol_sha256"])
          and _digest(policy["source_sha256"]) and _digest(policy["data_sha256"]), "POLICY_INVALID")
    for name, maximum in (("daily_batch_limit", MAX_POLICY_BATCHES_PER_DAY),
                          ("daily_compute_seconds", MAX_BATCH_SECONDS),
                          ("daily_data_bytes", MAX_DATA_BYTES), ("daily_model_calls", 0)):
        value = policy[name]
        _need(type(value) is int and 0 <= value <= maximum, "POLICY_BUDGET")
    _need(not policy["enabled"] or policy["daily_batch_limit"] > 0, "POLICY_BUDGET")
    _need(not policy["enabled"] or policy["daily_compute_seconds"] > 0, "POLICY_BUDGET")
    return _canonical(policy)


def scheduler_tick(database, policy=None, owner="local-worker"):
    """Explicit, single-job tick; it never starts a worker or runs at import time."""
    if policy is None:
        policy = DEFAULT_POLICY
    policy_raw = _validate_policy(policy)
    if not policy["enabled"]:
        return {"state": "off", "claimed": False, "executionAuthorized": False}
    _need(type(owner) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,79}", owner) is not None,
          "OWNER_INVALID")
    day = datetime.now(timezone.utc).date().isoformat()

    def operation(connection):
        fence, active = connection.execute("SELECT fence,active FROM meta WHERE id=1").fetchone()
        if active is not None:
            return {"state": "active", "claimed": False, "trialId": active, "executionAuthorized": False}
        row = connection.execute("SELECT * FROM jobs WHERE state='QUEUED' ORDER BY created_at,trial_id LIMIT 1").fetchone()
        if row is None:
            return {"state": "idle", "claimed": False, "executionAuthorized": False}
        job = _job_projection(row)
        identity = json.loads(row[2])
        pinned = all(policy[key] == identity[field] for key, field in (
            ("protocol_sha256", "protocol_sha256"), ("source_sha256", "source_sha256"),
            ("data_sha256", "data_sha256")))
        if not pinned:
            connection.execute("UPDATE jobs SET state='REJECTED',reason=?,finished_at=? WHERE trial_id=?",
                               ("PINNED_POLICY_MISMATCH", _timestamp(), job["trialId"]))
            return {"state": "rejected", "claimed": False, "trialId": job["trialId"],
                    "reason": "PINNED_POLICY_MISMATCH", "executionAuthorized": False}
        budget = connection.execute("SELECT batches,compute_seconds,data_bytes,model_calls FROM daily_budget WHERE utc_day=?",
                                    (day,)).fetchone() or (0, 0, 0, 0)
        requested = (budget[0] + 1, budget[1] + MAX_BATCH_SECONDS,
                     budget[2] + job["budget"]["dataBytes"], budget[3])
        limits = (policy["daily_batch_limit"], policy["daily_compute_seconds"],
                  policy["daily_data_bytes"], policy["daily_model_calls"])
        if any(used > allowed for used, allowed in zip(requested, limits)):
            connection.execute("UPDATE jobs SET state='REJECTED',reason=?,finished_at=? WHERE trial_id=?",
                               ("DAILY_BUDGET_EXHAUSTED", _timestamp(), job["trialId"]))
            return {"state": "rejected", "claimed": False, "trialId": job["trialId"],
                    "reason": "DAILY_BUDGET_EXHAUSTED", "executionAuthorized": False}
        _need(fence < MAX_INT, "FENCE_EXHAUSTED")
        fence += 1
        connection.execute("""INSERT INTO daily_budget VALUES (?,?,?,?,?)
            ON CONFLICT(utc_day) DO UPDATE SET batches=excluded.batches,
            compute_seconds=excluded.compute_seconds,data_bytes=excluded.data_bytes,
            model_calls=excluded.model_calls""", (day, *requested))
        connection.execute("""UPDATE jobs SET state='CLAIMED',attempts=1,owner=?,fence=?,
            policy_json=? WHERE trial_id=?""", (owner, fence, policy_raw, job["trialId"]))
        connection.execute("UPDATE meta SET fence=?,active=? WHERE id=1", (fence, job["trialId"]))
        claim = _read_job(connection, job["trialId"])
        return {"state": "claimed", "claimed": True, "claim": claim, "executionAuthorized": False}
    return _run(database, operation)


def _bound(connection, receipt):
    _need(type(receipt) is dict and _digest(receipt.get("trialId"))
          and type(receipt.get("owner")) is str and type(receipt.get("fence")) is int, "CLAIM_INVALID")
    row = connection.execute("SELECT * FROM jobs WHERE trial_id=?", (receipt["trialId"],)).fetchone()
    _need(row is not None, "TRIAL_NOT_FOUND")
    projection = _job_projection(row)
    expected_budget = {"dataBytes": row[7], "batchesReserved": row[4],
                       "computeSecondsReserved": MAX_BATCH_SECONDS if row[4] else 0,
                       "dataBytesReserved": row[7] if row[4] else 0, "modelCallsReserved": 0,
                       "maxBatchSeconds": MAX_BATCH_SECONDS, "maxPathSeconds": MAX_PATH_SECONDS}
    _need(row[5] == receipt["owner"] and row[6] == receipt["fence"]
          and projection["trialKey"] == receipt.get("trialKey")
          and projection["protocolSha256"] == receipt.get("protocolSha256")
          and projection["sourceSha256"] == receipt.get("sourceSha256")
          and projection["dataSha256"] == receipt.get("dataSha256")
          and projection["manifestSha256"] == receipt.get("manifestSha256")
          and projection["pathIds"] == receipt.get("pathIds")
          and projection["variantIds"] == receipt.get("variantIds")
          and projection["budget"] == receipt.get("budget") == expected_budget, "STALE_CLAIM")
    _need(connection.execute("SELECT fence,active FROM meta WHERE id=1").fetchone()
          == (receipt["fence"], receipt["trialId"]), "STALE_FENCE")
    return row


def start(database, receipt):
    def operation(connection):
        row = _bound(connection, receipt)
        _need(row[3] == "CLAIMED", "ATTEMPT_CONSUMED")
        connection.execute("UPDATE jobs SET state='RUNNING',started_at=? WHERE trial_id=?",
                           (_timestamp(), row[0]))
        return _read_job(connection, row[0])
    return _run(database, operation)


def record_path_started(database, receipt, index, path_id, predecessor_sha256):
    def operation(connection):
        row = _bound(connection, receipt)
        _need(row[3] == "RUNNING" and type(index) is int and 0 <= index < MAX_PATHS, "PATH_ORDER")
        progress = _load_progress(row[12])
        _need(index == len(progress) and path_id == PATHS[index]["id"] and _digest(predecessor_sha256),
              "PATH_EVENT_INVALID")
        progress.append({"pathId": path_id, "variantId": PATHS[index]["variant"],
                         "state": "started", "predecessorSha256": predecessor_sha256,
                         "startedAt": _timestamp()})
        raw = _canonical(progress)
        _need(len(raw.encode()) <= MAX_PROGRESS_BYTES, "PROGRESS_BOUND")
        connection.execute("UPDATE jobs SET progress_json=? WHERE trial_id=?", (raw, row[0]))
        return _read_job(connection, row[0])
    return _run(database, operation)


def record_path_completed(database, receipt, index, path_id, predecessor_sha256, output_sha256):
    _need(_digest(output_sha256), "PATH_RESULT_INVALID")
    def operation(connection):
        row = _bound(connection, receipt)
        _need(row[3] == "RUNNING" and type(index) is int and 0 <= index < MAX_PATHS, "PATH_ORDER")
        progress = _load_progress(row[12])
        _need(index == len(progress) - 1 and progress[-1]["state"] == "started"
              and progress[-1]["pathId"] == path_id and PATHS[index]["id"] == path_id
              and progress[-1]["predecessorSha256"] == predecessor_sha256, "PATH_EVENT_INVALID")
        progress[-1].update({"state": "completed", "outputSha256": output_sha256,
                             "completedAt": _timestamp()})
        raw = _canonical(progress)
        _need(len(raw.encode()) <= MAX_PROGRESS_BYTES, "PROGRESS_BOUND")
        connection.execute("UPDATE jobs SET progress_json=? WHERE trial_id=?", (raw, row[0]))
        return _read_job(connection, row[0])
    return _run(database, operation)


def settle(database, receipt, outcome, reason):
    allowed = {"COMPLETED", "FAILED", "TIMED_OUT", "PARTIAL"}
    _need(outcome in allowed and type(reason) is str and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", reason),
          "SETTLEMENT_INVALID")
    def operation(connection):
        row = _bound(connection, receipt)
        _need(row[3] == "RUNNING", "ATTEMPT_CONSUMED")
        progress = _load_progress(row[12])
        _need(outcome != "COMPLETED" or len(progress) == MAX_PATHS
              and all(path["state"] == "completed" for path in progress), "INCOMPLETE_BATCH")
        result = {"trialId": row[0], "state": outcome.lower(), "reason": reason,
                  "pathResults": progress, "timestamps": {"startedAt": row[10], "finishedAt": _timestamp()},
                  "executionAuthorized": False, "promotionAuthorized": False}
        result_raw = _canonical(result)
        _need(len(result_raw.encode()) <= MAX_RESULT_BYTES, "RESULT_BOUND")
        _need(connection.execute("""SELECT COALESCE(SUM(length(CAST(progress_json AS BLOB)) +
            COALESCE(length(CAST(result_json AS BLOB)),0)),0) FROM jobs""").fetchone()[0]
            + len(result_raw.encode()) <= MAX_RESULT_BYTES, "RESULT_CAPACITY")
        result_sha = hashlib.sha256(result_raw.encode()).hexdigest()
        connection.execute("""UPDATE jobs SET state=?,result_json=?,result_sha256=?,reason=?,finished_at=?
            WHERE trial_id=?""", (outcome, result_raw, result_sha, reason, result["timestamps"]["finishedAt"], row[0]))
        connection.execute("UPDATE meta SET active=NULL WHERE id=1")
        return _read_job(connection, row[0])
    return _run(database, operation)


def reconcile(database, trial_id, note):
    """Explicitly resolve an interrupted running job; this never retries or recreates it."""
    _need(_digest(trial_id) and type(note) is str
          and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", note) is not None, "RECONCILIATION_INVALID")
    def operation(connection):
        row = connection.execute("SELECT * FROM jobs WHERE trial_id=?", (trial_id,)).fetchone()
        _need(row is not None, "TRIAL_NOT_FOUND")
        _need(row[3] in ("CLAIMED", "RUNNING")
              and connection.execute("SELECT active FROM meta WHERE id=1").fetchone()[0] == trial_id,
              "NOT_UNRESOLVED")
        progress = _load_progress(row[12])
        result = {"trialId": trial_id, "state": "unknown", "reason": note,
                  "pathResults": progress, "timestamps": {"startedAt": row[10], "finishedAt": _timestamp()},
                  "executionAuthorized": False, "promotionAuthorized": False,
                  "reconciledBy": "explicit-local-operator"}
        result_raw = _canonical(result)
        _need(len(result_raw.encode()) <= MAX_RESULT_BYTES, "RESULT_BOUND")
        digest = hashlib.sha256(result_raw.encode()).hexdigest()
        connection.execute("""UPDATE jobs SET state='UNKNOWN',result_json=?,result_sha256=?,reason=?,finished_at=?
            WHERE trial_id=?""", (result_raw, digest, note, result["timestamps"]["finishedAt"], trial_id))
        connection.execute("UPDATE meta SET active=NULL WHERE id=1")
        return _read_job(connection, trial_id)
    return _run(database, operation)


def inspect(database, trial_id):
    _need(_digest(trial_id), "TRIAL_ID_INVALID")
    return _read(database, lambda connection: _read_job(connection, trial_id))


def budget_status(database):
    def operation(connection):
        return [{"utcDay": day, "batchesReserved": batches, "computeSecondsReserved": seconds,
                 "dataBytesReserved": data_bytes, "modelCallsReserved": model_calls}
                for day, batches, seconds, data_bytes, model_calls
                in connection.execute("SELECT * FROM daily_budget ORDER BY utc_day")]
    return _read(database, operation)
