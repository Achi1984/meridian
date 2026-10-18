"""Same-host, one-shot journal for bounded synthetic research batches."""

import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time
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
B1_PROFILE_NAME = "MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1"
B1_CONTROL_BYTES = 8192
B1_MANIFEST_PATH = Path(__file__).resolve().with_name("b1_bridge_manifest.json")
B1_SOURCE_FILES = {
    "engine": "scripts/research/b1-7/engine.mjs",
    "validator": "scripts/research/b1-7/validate.mjs",
    "loader": "scripts/research/b1-7/captured-input.mjs",
    "protocol": "research/protocols/b1-7-20261018/protocol.json",
    "fixture": "test/fixtures/b1-7/synthetic-series.mjs",
    "adapter": "scripts/research-supervisor/b1_adapter.mjs",
    "supervisor": "scripts/research-supervisor/supervisor.py",
    "journal": "scripts/research-supervisor/journal.py",
}
B1_VARIANTS = (
    "primary-n30-f25", "neighbour-n20-f25", "neighbour-n45-f25",
    "neighbour-n30-f20", "neighbour-n30-f35",
)
B1_SCENARIOS = ("base-15bp", "stress-30bp", "stress-30bp-delay-1d")
B1_CONTROL_IDS = ("frozen-mean-exposure", "frozen-risk-exposure")
B1_COMPUTATION_LIMITS = {"path_seconds": MAX_PATH_SECONDS, "batch_seconds": MAX_BATCH_SECONDS}
B1_ASSETS = ("XBTUSD", "ETHUSD", "SOLUSD", "XRPUSD", "LINKUSD", "AVAXUSD", "SUIUSD")
B1_PATH_RESULT_KEYS = {
    "attempts", "cancelledInstructionCount", "cancelledInstructions", "computed",
    "dailyHeldTarget", "dailyReturnCount", "dailyReturnSd", "dailyReturns",
    "diagnosticRescaling", "endEquity", "fillCostCount", "fillCosts", "kind",
    "maxAbsoluteTargetMismatch", "maxConcentration", "maxDrawdownDuration",
    "meanAbsoluteTargetMismatch", "meanHeldTarget", "meanRealizedExposure",
    "meanTargetRealizedMismatch", "netReturn", "observationClass", "pathId",
    "quarterlyReturns", "rows", "sampledDrawdown", "scenarioId", "segmentId",
    "startEquity", "status", "totalCosts", "tradeCRV",
    "turnoverNotional", "turnoverOnInitialEquity", "variantId",
}
B1_SUMMARY_KEYS = {
    "attemptedPaths", "authority", "budget", "completedPaths", "computedPaths",
    "controlRealization", "evidence", "executionId", "failure", "identity",
    "implementationId", "implementationSha256", "plannedPaths", "protocolId",
    "protocolReview", "protocolSha256", "schema", "screen", "status",
}
B1_SCREEN_CHECKS = {
    "primaryDiagnosticNetPositive", "primaryDiagnosticDrawdownAtMost25Percent",
    "primaryReturnAtLeastBothFrozenControls", "primaryDrawdownAtMostBothFrozenControls",
    "relativeDrawdownReductionAtLeast20Percent", "primaryNetPositiveAt30bpNonDelayed",
    "primaryNetPositiveAt30bpPlusDelay", "atLeastThreeOfFourNeighboursPositiveAt15bp",
    "atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed",
}
B1_SCREEN_KEYS = {
    "status", "interpretation", "comparisonSegment", "neighbourStressScenario", "checks",
    "relativeDrawdownReduction", "neighbourPositiveCounts", "stopPolicy", "tradeCRV",
}
B1_EVIDENCE_KEYS = {
    "syntheticFixture", "priceSource", "costModel", "executionEvidence", "sourceAuthenticity",
    "survivorship", "historyLabel", "candidateInterpretation", "diagnosticRescaling",
    "holdoutClaim", "trialLedger", "stoppedPolicy", "crv",
}


def _b1_profile():
    try:
        raw = B1_MANIFEST_PATH.read_bytes()
        profile = json.loads(raw, object_pairs_hook=_unique_object,
                             parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (OSError, ValueError, RecursionError):
        raise JournalError("B1_PROFILE_INVALID")
    expected = {
        "profile", "schemaVersion", "protocolId", "protocolSha256", "implementationId",
        "implementationSha256", "inputSha256", "manifestSha256", "computationOrderSha256",
        "sourceFiles", "sourceSha256", "pathDescriptors", "pathIds", "computationOrder",
    }
    _need(type(profile) is dict and set(profile) == expected
          and profile["profile"] == B1_PROFILE_NAME and profile["schemaVersion"] == 2
          and profile["protocolId"] == "MERIDIAN-B1-7-PROTOCOL-R3-20261018"
          and profile["protocolSha256"] == "a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185"
          and profile["sourceFiles"] == B1_SOURCE_FILES
          and type(profile["pathDescriptors"]) is list and len(profile["pathDescriptors"]) == 44
          and all(type(item) is list and len(item) == 4
                  and all(type(value) is str for value in item) for item in profile["pathDescriptors"])
          and type(profile["pathIds"]) is list and len(profile["pathIds"]) == 44
          and all(_digest(item) for item in profile["pathIds"])
          and len(set(profile["pathIds"])) == 44
          and profile["computationOrder"] == [
              0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 42,
              1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 36,
              37, 38, 39, 40, 41, 43,
          ], "B1_PROFILE_INVALID")
    _need(_digest(profile["implementationSha256"]) and _digest(profile["inputSha256"])
          and _digest(profile["manifestSha256"]) and _digest(profile["computationOrderSha256"])
          and type(profile["sourceSha256"]) is dict
          and set(profile["sourceSha256"]) == set(B1_SOURCE_FILES)
          and all(_digest(value) for value in profile["sourceSha256"].values()),
          "B1_PROFILE_INVALID")
    implementation_identity = {
        "capturedInputSha256": profile["sourceSha256"]["loader"],
        "engineSha256": profile["sourceSha256"]["engine"],
        "validatorSha256": profile["sourceSha256"]["validator"],
    }
    _need(hashlib.sha256(_canonical(implementation_identity).encode()).hexdigest()
          == profile["implementationSha256"]
          and profile["sourceSha256"]["protocol"] == profile["protocolSha256"],
          "B1_SOURCE_IDENTITY_INVALID")
    root = Path(__file__).resolve().parents[2]
    for name, relative in B1_SOURCE_FILES.items():
        try:
            source_path = (root / relative).resolve(strict=True)
            _need(source_path.is_relative_to(root), "B1_PROFILE_INVALID")
            observed = hashlib.sha256(source_path.read_bytes()).hexdigest()
        except (OSError, JournalError):
            raise JournalError("B1_SOURCE_UNAVAILABLE")
        _need(observed == profile["sourceSha256"][name], "B1_SOURCE_PIN_MISMATCH")
    descriptors = []
    for variant in B1_VARIANTS:
        for scenario in B1_SCENARIOS:
            for segment in ("development", "diagnostic"):
                descriptors.append({"kind": "CANDIDATE", "variantId": variant,
                                    "scenarioId": scenario, "segmentId": segment})
    for scenario in B1_SCENARIOS:
        for segment in ("development", "diagnostic"):
            descriptors.append({"kind": "FULL_BASKET", "variantId": "full-basket-weekly",
                                "scenarioId": scenario, "segmentId": segment})
    for control in B1_CONTROL_IDS:
        for scenario in B1_SCENARIOS:
            descriptors.append({"kind": "FIXED_CONTROL", "variantId": control,
                                "scenarioId": scenario, "segmentId": "diagnostic"})
    for segment in ("development", "diagnostic"):
        descriptors.append({"kind": "CASH", "variantId": "cash-zero",
                            "scenarioId": "scenario-independent", "segmentId": segment})
    descriptor_rows = [[item["kind"], item["variantId"], item["scenarioId"], item["segmentId"]]
                       for item in descriptors]
    _need(profile["pathDescriptors"] == descriptor_rows, "B1_MANIFEST_PIN_MISMATCH")
    paths = tuple({**item, "pathId": path_id} for item, path_id in zip(descriptors, profile["pathIds"]))
    manifest_digest = hashlib.sha256(_canonical(list(paths)).encode()).hexdigest()
    computation = [
        {"ordinal": ordinal, **paths[index]}
        for ordinal, index in enumerate(profile["computationOrder"], 1)
    ]
    computation_digest = hashlib.sha256(_canonical(computation).encode()).hexdigest()
    _need(manifest_digest == profile["manifestSha256"]
          and computation_digest == profile["computationOrderSha256"], "B1_MANIFEST_PIN_MISMATCH")
    profile["paths"] = paths
    profile["computation"] = tuple(computation)
    profile["sourceIdentitySha256"] = hashlib.sha256(
        _canonical(profile["sourceSha256"]).encode()).hexdigest()
    return profile


def _unique_object(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


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


def initialize(database, profile="synthetic"):
    """Create a new private database only; never reset or migrate an existing file."""
    _need(profile in ("synthetic", B1_PROFILE_NAME), "PROFILE_INVALID")
    if profile == B1_PROFILE_NAME:
        return initialize_b1(database)
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


def _remaining(deadline):
    if deadline is None:
        return None
    _need(type(deadline) in (int, float) and deadline > 0, "DEADLINE_INVALID")
    remaining = deadline - time.monotonic()
    _need(remaining > 0, "OPERATION_DEADLINE")
    return remaining


def _connect(database, busy_timeout=5, deadline=None):
    path = _database_path(database)
    try:
        remaining = _remaining(deadline)
        timeout = min(busy_timeout, remaining) if remaining is not None else busy_timeout
        connection = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True,
                                     timeout=timeout, isolation_level=None)
        connection.execute(f"PRAGMA busy_timeout={int(timeout * 1000)}")
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
        if isinstance(error, sqlite3.OperationalError) and (
                "locked" in str(error).lower() or "busy" in str(error).lower()):
            raise JournalError("DATABASE_BUSY")
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


def _run(database, operation, busy_timeout=5, deadline=None):
    _need(type(busy_timeout) in (int, float) and 0 <= busy_timeout <= 30, "BUSY_TIMEOUT_INVALID")
    connection = _connect(database, busy_timeout, deadline)
    try:
        _remaining(deadline)
        _check_store(connection)
        _remaining(deadline)
        value = operation(connection)
        _remaining(deadline)
        _check_store(connection)
        _remaining(deadline)
        connection.commit()
        return value
    except sqlite3.Error as error:
        if isinstance(error, sqlite3.OperationalError) and (
                "locked" in str(error).lower() or "busy" in str(error).lower()):
            raise JournalError("DATABASE_BUSY")
        raise JournalError("JOURNAL_STORAGE_ERROR")
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def _read(database, operation, busy_timeout=0):
    path = _database_path(database)
    try:
        _need(type(busy_timeout) in (int, float) and 0 <= busy_timeout <= 30, "BUSY_TIMEOUT_INVALID")
        connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True,
                                     timeout=busy_timeout, isolation_level=None)
        connection.execute(f"PRAGMA busy_timeout={int(busy_timeout * 1000)}")
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        _need(connection.execute("PRAGMA user_version").fetchone() == (1,), "DATABASE_SCHEMA")
        _need(connection.execute("PRAGMA page_size").fetchone() == (4096,), "DATABASE_SCHEMA")
        _check_store(connection)
        value = operation(connection)
        _check_store(connection)
        connection.commit()
        return value
    except sqlite3.Error as error:
        if isinstance(error, sqlite3.OperationalError) and (
                "locked" in str(error).lower() or "busy" in str(error).lower()):
            raise JournalError("DATABASE_BUSY")
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


def start(database, receipt, *, busy_timeout=5, deadline=None):
    def operation(connection):
        row = _bound(connection, receipt)
        _need(row[3] == "CLAIMED", "ATTEMPT_CONSUMED")
        connection.execute("UPDATE jobs SET state='RUNNING',started_at=? WHERE trial_id=?",
                           (_timestamp(), row[0]))
        return _read_job(connection, row[0])
    return _run(database, operation, busy_timeout, deadline)


def record_path_started(database, receipt, index, path_id, predecessor_sha256, *,
                        busy_timeout=5, deadline=None):
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
    return _run(database, operation, busy_timeout, deadline)


def record_path_completed(database, receipt, index, path_id, predecessor_sha256, output_sha256,
                          *, busy_timeout=5, deadline=None):
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
    return _run(database, operation, busy_timeout, deadline)


def settle(database, receipt, outcome, reason, *, busy_timeout=5, deadline=None):
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
    return _run(database, operation, busy_timeout, deadline)


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


def initialize_b1(database):
    """Create the explicitly versioned B1 generated-fixture journal profile."""
    _b1_profile()
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
        connection.execute("""CREATE TABLE b1_meta (
            id INTEGER PRIMARY KEY CHECK(id=1), profile TEXT NOT NULL, fence INTEGER NOT NULL,
            active TEXT
        )""")
        connection.execute("INSERT INTO b1_meta VALUES (1,?,0,NULL)", (B1_PROFILE_NAME,))
        connection.execute("""CREATE TABLE b1_jobs (
            trial_id TEXT PRIMARY KEY, trial_key TEXT NOT NULL UNIQUE, identity_json TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('QUEUED','CLAIMED','RUNNING','COMPLETED','REJECTED',
                'FAILED','TIMED_OUT','PARTIAL','UNKNOWN')),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
            owner TEXT, fence INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
            started_at TEXT, finished_at TEXT, progress_json TEXT NOT NULL DEFAULT '[]',
            controls_json BLOB, controls_sha256 TEXT, summary_json BLOB, summary_sha256 TEXT,
            reason TEXT, control_primary_sha256 TEXT, control_basket_sha256 TEXT
        )""")
        connection.execute("""CREATE TABLE b1_path_payloads (
            trial_id TEXT NOT NULL, computation_index INTEGER NOT NULL,
            payload BLOB NOT NULL, payload_sha256 TEXT NOT NULL,
            PRIMARY KEY(trial_id, computation_index)
        )""")
        connection.execute("""CREATE TABLE b1_daily_budget (
            utc_day TEXT PRIMARY KEY, batches INTEGER NOT NULL, compute_seconds INTEGER NOT NULL,
            data_bytes INTEGER NOT NULL, model_calls INTEGER NOT NULL
        )""")
        connection.execute("PRAGMA user_version=2")
        connection.commit()
    except sqlite3.Error:
        raise JournalError("DATABASE_CREATE_FAILED")
    finally:
        if connection is not None:
            connection.close()
    return {"initialized": True, "profile": B1_PROFILE_NAME, "active": False,
            "executionAuthorized": False}


def _b1_connect(database, busy_timeout=5, deadline=None, readonly=False):
    path = _database_path(database)
    try:
        remaining = _remaining(deadline)
        timeout = min(busy_timeout, remaining) if remaining is not None else busy_timeout
        mode = "ro" if readonly else "rw"
        connection = sqlite3.connect(path.as_uri() + f"?mode={mode}", uri=True,
                                     timeout=timeout, isolation_level=None)
        connection.execute(f"PRAGMA busy_timeout={int(timeout * 1000)}")
        connection.execute("PRAGMA synchronous=FULL")
        if not readonly:
            connection.execute("PRAGMA max_page_count=16384")
            connection.execute("BEGIN IMMEDIATE")
        else:
            connection.execute("PRAGMA query_only=ON")
            connection.execute("BEGIN")
        _need(connection.execute("PRAGMA user_version").fetchone() == (2,)
              and connection.execute("PRAGMA page_size").fetchone() == (4096,)
              and connection.execute("SELECT profile FROM b1_meta WHERE id=1").fetchone()
              == (B1_PROFILE_NAME,), "DATABASE_SCHEMA")
        return connection
    except (sqlite3.Error, JournalError) as error:
        if "connection" in locals():
            connection.close()
        if isinstance(error, JournalError):
            raise
        if isinstance(error, sqlite3.OperationalError) and (
                "locked" in str(error).lower() or "busy" in str(error).lower()):
            raise JournalError("DATABASE_BUSY")
        raise JournalError("DATABASE_UNAVAILABLE")


def _b1_capacity(connection):
    used = connection.execute("""SELECT
        COALESCE((SELECT SUM(length(CAST(progress_json AS BLOB)) +
          COALESCE(length(controls_json),0) + COALESCE(length(summary_json),0))
          FROM b1_jobs),0) +
        COALESCE((SELECT SUM(length(payload)) FROM b1_path_payloads),0)""").fetchone()[0]
    _need(used <= MAX_RESULT_BYTES, "RESULT_CAPACITY")
    return used


def _b1_check(connection):
    meta = connection.execute("SELECT profile,fence,active FROM b1_meta WHERE id=1").fetchone()
    _need(meta is not None and meta[0] == B1_PROFILE_NAME
          and type(meta[1]) is int and 0 <= meta[1] <= MAX_INT, "STORED_META")
    active = connection.execute(
        "SELECT trial_id,fence FROM b1_jobs WHERE state IN ('CLAIMED','RUNNING')").fetchall()
    _need(len(active) <= 1, "STORED_ACTIVE")
    if active:
        _need(meta[2] == active[0][0] and meta[1] == active[0][1], "STORED_ACTIVE")
    else:
        _need(meta[2] is None, "STORED_ACTIVE")
    fences = [row[0] for row in connection.execute(
        "SELECT fence FROM b1_jobs WHERE attempts=1")]
    _need(len(set(fences)) == len(fences) and meta[1] == max(fences, default=0), "STORED_FENCE")
    _need(connection.execute("SELECT COUNT(*) FROM b1_jobs").fetchone()[0] <= MAX_JOBS,
          "JOURNAL_CAPACITY")
    _b1_capacity(connection)


def _b1_run(database, operation, busy_timeout=5, deadline=None):
    _need(type(busy_timeout) in (int, float) and 0 <= busy_timeout <= 30, "BUSY_TIMEOUT_INVALID")
    connection = _b1_connect(database, busy_timeout, deadline)
    try:
        _remaining(deadline)
        _b1_check(connection)
        value = operation(connection)
        _remaining(deadline)
        _b1_check(connection)
        _remaining(deadline)
        connection.commit()
        return value
    except sqlite3.Error as error:
        if isinstance(error, sqlite3.OperationalError) and (
                "locked" in str(error).lower() or "busy" in str(error).lower()):
            raise JournalError("DATABASE_BUSY")
        raise JournalError("JOURNAL_STORAGE_ERROR")
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def _b1_parse(raw, code):
    try:
        value = json.loads(raw if type(raw) is str else bytes(raw), object_pairs_hook=_unique_object,
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError, RecursionError):
        raise JournalError(code)

    _need(_b1_finite_tree(value), code)
    return value


def _b1_finite_tree(item):
    if type(item) is float:
        return __import__("math").isfinite(item)
    if type(item) is list:
        return all(_b1_finite_tree(child) for child in item)
    if type(item) is dict:
        return all(_b1_finite_tree(child) for child in item.values())
    return item is None or type(item) in (str, int, bool)


def _validate_b1_path_payload(payload, expected):
    rows = 180 if expected["segmentId"] == "development" else 365
    expected_keys = B1_PATH_RESULT_KEYS | ({"targetExposure"} if expected["kind"] != "CANDIDATE" else set())
    _need(type(payload) is dict and set(payload) == expected_keys
          and payload.get("pathId") == expected["pathId"]
          and payload.get("kind") == expected["kind"]
          and payload.get("variantId") == expected["variantId"]
          and payload.get("scenarioId") == expected["scenarioId"]
          and payload.get("segmentId") == expected["segmentId"]
          and payload.get("status") == "COMPLETED"
          and type(payload.get("attempts")) is int and payload["attempts"] == 1
          and payload.get("computed") is True
          and type(payload.get("rows")) is int and payload["rows"] == rows
          and type(payload.get("dailyReturnCount")) is int and payload["dailyReturnCount"] == rows
          and type(payload.get("dailyReturns")) is list and len(payload["dailyReturns"]) == rows
          and type(payload.get("dailyHeldTarget")) is list and len(payload["dailyHeldTarget"]) == rows
          and all(type(value) in (int, float) and __import__("math").isfinite(value)
                  for value in payload["dailyReturns"] + payload["dailyHeldTarget"])
          and type(payload.get("quarterlyReturns")) is list
          and len(payload["quarterlyReturns"]) == (2 if rows == 180 else 4)
          and all(type(item) is dict and set(item) == {"quarter", "netReturn"}
                  and type(item["quarter"]) is str
                  and re.fullmatch(r"\d{4}-Q[1-4]", item["quarter"]) is not None
                  and type(item["netReturn"]) in (int, float)
                  and __import__("math").isfinite(item["netReturn"])
                  for item in payload["quarterlyReturns"])
          and type(payload.get("fillCosts")) is list
          and type(payload.get("fillCostCount")) is int
          and payload["fillCostCount"] == len(payload["fillCosts"])
          and all(type(item) is dict and set(item) == {
                      "date", "kind", "turnover", "cost", "cumulativeCost",
                      "equityAfterFees", "cashAfterFees", "conservationResidual",
                  } and type(item["date"]) is str and
                  re.fullmatch(r"\d{4}-\d{2}-\d{2}T00:00:00Z", item["date"]) is not None
                  and item["kind"] in ("REBALANCE", "TERMINAL_LIQUIDATION")
                  and all(type(item[key]) in (int, float) and __import__("math").isfinite(item[key])
                          for key in ("turnover", "cost", "cumulativeCost", "equityAfterFees",
                                      "cashAfterFees", "conservationResidual"))
                  and item["turnover"] >= 0 and item["cost"] >= 0
                  and item["cumulativeCost"] >= 0 and item["equityAfterFees"] >= 0
                  and item["cashAfterFees"] >= 0 and abs(item["conservationResidual"]) <= 1e-6
                  for item in payload["fillCosts"])
          and type(payload.get("cancelledInstructions")) is list
          and type(payload.get("cancelledInstructionCount")) is int
          and payload["cancelledInstructionCount"] == len(payload["cancelledInstructions"])
          and all(type(item) is dict and set(item) == {
                      "decisionIndex", "fillIndex", "target", "decisionTimestamp", "reason",
                  } and type(item["decisionIndex"]) is int and type(item["fillIndex"]) is int
                  and type(item["target"]) in (int, float) and __import__("math").isfinite(item["target"])
                  and type(item["decisionTimestamp"]) is str
                  and re.fullmatch(r"\d{4}-\d{2}-\d{2}T00:00:00Z", item["decisionTimestamp"]) is not None
                  and item["reason"] == "BEYOND_SEGMENT_HORIZON"
                  for item in payload["cancelledInstructions"])
          and payload.get("diagnosticRescaling") == "NONE"
          and payload.get("observationClass") == "HISTORICAL_DIAGNOSTIC_NOT_HOLDOUT"
          and type(payload.get("tradeCRV")) is dict
          and payload["tradeCRV"].get("status") == "UNDEFINED_NO_FINITE_STOP"
          and payload["tradeCRV"].get("value") is None
          and payload["tradeCRV"].get("promotionEligible") is False
          and (expected["kind"] == "CANDIDATE" or
               (type(payload.get("targetExposure")) in (int, float)
                and __import__("math").isfinite(payload["targetExposure"])
                and 0 <= payload["targetExposure"] <= 1))
          and all(type(payload.get(key)) in (int, float) and
                  __import__("math").isfinite(payload[key]) for key in (
                      "dailyReturnSd", "endEquity", "maxAbsoluteTargetMismatch",
                      "maxConcentration", "maxDrawdownDuration", "meanAbsoluteTargetMismatch",
                      "meanHeldTarget", "meanRealizedExposure", "meanTargetRealizedMismatch",
                      "netReturn", "sampledDrawdown", "startEquity",
                      "totalCosts", "turnoverNotional", "turnoverOnInitialEquity"))
          and (expected["kind"] == "CASH"
               and payload["fillCosts"] == [] and payload["totalCosts"] == 0
               and all(value == 0 for value in payload["dailyReturns"])
               or expected["kind"] != "CASH" and bool(payload["fillCosts"])
               and payload["fillCosts"][-1]["kind"] == "TERMINAL_LIQUIDATION"),
          "PATH_RESULT_INVALID")


def _validate_b1_summary(summary, profile, *, allow_insufficient=False):
    _need(type(summary) is dict, "RESULT_SCHEMA_INVALID")
    identity = summary.get("identity") if type(summary) is dict else None
    authority = summary.get("authority") if type(summary) is dict else None
    status = summary.get("status") if type(summary) is dict else None
    if status == "COMPLETED":
        counts_valid = (type(summary.get("attemptedPaths")) is int and
                        summary.get("attemptedPaths") == 44 and
                        type(summary.get("completedPaths")) is int and
                        summary.get("completedPaths") == 44 and
                        type(summary.get("computedPaths")) is int and
                        summary.get("computedPaths") == 44 and summary.get("failure") is None)
    else:
        counts_valid = (allow_insufficient and status == "INSUFFICIENT_EVIDENCE" and
                        type(summary.get("attemptedPaths")) is int and
                        summary.get("attemptedPaths") == 19 and
                        type(summary.get("completedPaths")) is int and
                        summary.get("completedPaths") == 19 and
                        type(summary.get("computedPaths")) is int and
                        summary.get("computedPaths") == 19 and summary.get("failure") is None)
    screen = summary.get("screen")
    evidence = summary.get("evidence")
    budget = summary.get("budget")
    realization = summary.get("controlRealization")
    screen_valid = (
        type(screen) is dict and set(screen) == {"status"}
        and screen["status"] == "INSUFFICIENT_EVIDENCE"
    ) if status == "INSUFFICIENT_EVIDENCE" else (
        type(screen) is dict and set(screen) == B1_SCREEN_KEYS
        and screen.get("status") == "SYNTHETIC_ONLY_NOT_ASSESSED"
        and screen.get("interpretation") == "SYNTHETIC_FIXTURE_RULE_CHECKS_ONLY"
        and screen.get("comparisonSegment") == "diagnostic"
        and screen.get("neighbourStressScenario") == "stress-30bp-non-delayed"
        and screen.get("stopPolicy") == "NO_FINITE_TRADE_STOP"
        and type(screen.get("checks")) is dict
        and set(screen["checks"]) == B1_SCREEN_CHECKS
        and all(type(value) is bool for value in screen["checks"].values())
        and type(screen.get("neighbourPositiveCounts")) is dict
        and set(screen["neighbourPositiveCounts"]) == {"base15bp", "stress30bp"}
        and all(type(value) is int and 0 <= value <= 4
                for value in screen["neighbourPositiveCounts"].values())
        and type(screen.get("tradeCRV")) is dict
        and set(screen["tradeCRV"]) == {"status", "value"}
        and screen["tradeCRV"] == {"status": "UNDEFINED_NO_FINITE_STOP", "value": None}
        and (screen.get("relativeDrawdownReduction") is None or
             type(screen["relativeDrawdownReduction"]) in (int, float)
             and __import__("math").isfinite(screen["relativeDrawdownReduction"]))
    )
    realization_keys = {
        "pathId", "variantId", "scenarioId", "segmentId", "status",
        "frozenTargetExposure", "meanRealizedExposure", "meanTargetRealizedMismatch",
        "meanAbsoluteTargetMismatch", "maxAbsoluteTargetMismatch", "diagnosticRescaling",
    }
    numeric_or_null = lambda value: value is None or (
        type(value) in (int, float) and __import__("math").isfinite(value))
    realization_valid = (
        type(realization) is list and len(realization) == 6
        and all(type(item.get("pathId")) is str for item in realization if type(item) is dict)
        and len({item.get("pathId") for item in realization if type(item) is dict}) == 6
        and all(type(item) is dict and set(item) == realization_keys
                and (descriptor := next((path for path in profile["paths"]
                                         if path["pathId"] == item.get("pathId")), None)) is not None
                and descriptor["kind"] == "FIXED_CONTROL"
                and item.get("variantId") == descriptor["variantId"]
                and item.get("scenarioId") == descriptor["scenarioId"]
                and item.get("segmentId") == descriptor["segmentId"]
                and item.get("status") == (
                    "COMPLETED" if status == "COMPLETED" else "NOT_RUN_INSUFFICIENT_EVIDENCE")
                and item.get("diagnosticRescaling") == "NONE"
                and all(numeric_or_null(item.get(key)) for key in (
                    "frozenTargetExposure", "meanRealizedExposure", "meanTargetRealizedMismatch",
                    "meanAbsoluteTargetMismatch", "maxAbsoluteTargetMismatch"))
                for item in realization)
    )
    budget_valid = (
        type(budget) is dict and set(budget) == {
            "limits", "attemptsPerStartedPath", "automaticRetry", "status",
        }
        and type(budget["limits"]) is dict and set(budget["limits"]) == {
            "paths", "pathMs", "totalMs", "outputBytes", "attemptsPerPath",
        }
        and budget["limits"] == {
            "paths": 44, "pathMs": 60_000, "totalMs": 1_800_000,
            "outputBytes": MAX_RESULT_BYTES, "attemptsPerPath": 1,
        }
        and type(budget["attemptsPerStartedPath"]) is int
        and budget["attemptsPerStartedPath"] == 1
        and budget["automaticRetry"] is False and budget["status"] == "WITHIN_LIMITS"
    )
    evidence_valid = (
        type(evidence) is dict and set(evidence) == B1_EVIDENCE_KEYS
        and evidence.get("syntheticFixture") is True
        and evidence.get("priceSource") == "SYNTHETIC_FIXTURE"
        and evidence.get("costModel") == "OKX_INSPIRED_ASSUMED_15_30BP_NOT_EXECUTION_EVIDENCE"
        and evidence.get("executionEvidence") == "NOT_OKX_EXECUTION_EVIDENCE"
        and evidence.get("sourceAuthenticity") == "SYNTHETIC_ONLY"
        and evidence.get("holdoutClaim") is False
        and evidence.get("trialLedger") == "UNKNOWN"
        and evidence.get("diagnosticRescaling") == "NONE"
        and evidence.get("crv") == {
            "status": "UNDEFINED_NO_FINITE_STOP", "value": None, "researchOnly": True,
        }
    )
    _need(type(summary) is dict and set(summary) == B1_SUMMARY_KEYS
          and summary.get("schema") == "MERIDIAN_B1_7_ENGINE_RESULT_R3"
          and summary.get("protocolId") == profile["protocolId"]
          and summary.get("protocolSha256") == profile["protocolSha256"]
          and summary.get("implementationId") == profile["implementationId"]
          and summary.get("implementationSha256") == profile["implementationSha256"]
          and counts_valid and type(summary.get("plannedPaths")) is int
          and summary.get("plannedPaths") == 44
          and type(identity) is dict and set(identity) == {
              "datasetKind", "sourceCommit", "sourceProvenance", "canonicalSeriesSha256",
              "inputSha256",
          }
          and identity.get("datasetKind") == "SYNTHETIC_FIXTURE"
          and identity.get("sourceCommit") == "SYNTHETIC_FIXTURE"
          and identity.get("inputSha256") == profile["inputSha256"]
          and type(identity.get("canonicalSeriesSha256")) is dict
          and set(identity["canonicalSeriesSha256"]) == set(B1_ASSETS)
          and all(type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None
                  for value in identity["canonicalSeriesSha256"].values())
          and identity.get("sourceProvenance") ==
              {"syntheticFixtureSeriesSha256": identity["canonicalSeriesSha256"]}
          and type(authority) is dict and set(authority) == {
              "researchOnly", "executionAuthorized", "strategyPnlAuthorized",
              "discoveryAuthorized", "validationAuthorized", "holdoutAuthorized",
              "paperAuthorized", "liveAuthorized",
          }
          and authority["researchOnly"] is True
          and all(value is False for key, value in authority.items() if key != "researchOnly")
          and screen_valid and evidence_valid and budget_valid and realization_valid
          and type(summary.get("protocolReview")) is dict
          and set(summary["protocolReview"]) == {
              "r1RequestId", "r1ResponseComment", "r1Verdict", "r2RequestId",
              "r2ResponseComment", "r2Verdict", "r2Scope", "r3Review",
          },
          "RESULT_SCHEMA_INVALID")
    input_identity = {key: value for key, value in identity.items() if key != "inputSha256"}
    _need(hashlib.sha256(_canonical(input_identity).encode()).hexdigest() == profile["inputSha256"],
          "RESULT_IDENTITY_INVALID")
    execution_id = hashlib.sha256(_canonical({
        "protocolId": profile["protocolId"],
        "protocolSha256": profile["protocolSha256"],
        "implementationId": profile["implementationId"],
        "implementationSha256": profile["implementationSha256"],
        "inputSha256": profile["inputSha256"],
        "pathIds": profile["pathIds"],
    }).encode()).hexdigest()
    _need(summary.get("executionId") == execution_id, "RESULT_IDENTITY_INVALID")


def _b1_job(connection, trial_id):
    row = connection.execute("SELECT * FROM b1_jobs WHERE trial_id=?", (trial_id,)).fetchone()
    _need(row is not None, "TRIAL_NOT_FOUND")
    profile = _b1_profile()
    (trial_id, trial_key, identity_raw, state, attempts, owner, fence, created_at, started_at,
     finished_at, progress_raw, controls_raw, controls_sha, summary_raw, summary_sha, reason,
     primary_control_sha, basket_control_sha) = row
    identity = _b1_parse(identity_raw, "STORED_JOB_CORRUPT")
    progress = _b1_parse(progress_raw, "STORED_PROGRESS")
    controls = None
    summary = None
    _need(type(identity) is dict and _canonical(identity) == identity_raw
          and identity.get("trial_id") == trial_id and identity.get("trial_key") == trial_key
          and hashlib.sha256(trial_key.encode()).hexdigest() == trial_id
          and identity.get("profile") == B1_PROFILE_NAME
          and identity.get("protocol_sha256") == profile["protocolSha256"]
          and identity.get("source_sha256") == profile["sourceIdentitySha256"]
          and identity.get("data_sha256") == profile["inputSha256"]
          and identity.get("manifest_sha256") == profile["manifestSha256"]
          and identity.get("path_ids") == profile["pathIds"]
          and identity.get("computation_order") == profile["computationOrder"]
          and type(progress) is list and len(progress) <= 44
          and _canonical(progress) == progress_raw, "STORED_JOB_CORRUPT")
    paths = profile["paths"]
    computation = profile["computation"]
    for index, item in enumerate(progress):
        expected = computation[index]
        required = {"pathId", "ordinal", "phase", "state", "startedAt"}
        if type(item) is dict and item.get("state") == "completed":
            required |= {"payloadSha256", "completedAt"}
        _need(type(item) is dict and set(item) == required
              and item.get("pathId") == expected["pathId"]
              and item.get("ordinal") == index + 1
              and item.get("phase") == ("DEVELOPMENT" if index < 19 else "DIAGNOSTIC")
              and item.get("state") in ("started", "completed"), "STORED_PROGRESS")
        if index < len(progress) - 1:
            _need(item["state"] == "completed", "STORED_PROGRESS")
        if item["state"] == "completed":
            payload_row = connection.execute(
                "SELECT payload,payload_sha256 FROM b1_path_payloads WHERE trial_id=? AND computation_index=?",
                (trial_id, index)).fetchone()
            _need(payload_row is not None and _digest(payload_row[1])
                  and hashlib.sha256(payload_row[0]).hexdigest() == payload_row[1]
                  and payload_row[1] == item["payloadSha256"], "STORED_PATH_PAYLOAD")
            path_result = _b1_parse(payload_row[0], "STORED_PATH_PAYLOAD")
            _validate_b1_path_payload(path_result, expected)
        else:
            _need(connection.execute(
                "SELECT 1 FROM b1_path_payloads WHERE trial_id=? AND computation_index=?",
                (trial_id, index)).fetchone() is None, "STORED_PATH_PAYLOAD")
    payload_count = connection.execute(
        "SELECT COUNT(*) FROM b1_path_payloads WHERE trial_id=?", (trial_id,)).fetchone()[0]
    _need(payload_count == sum(item["state"] == "completed" for item in progress),
          "STORED_PATH_PAYLOAD")
    if controls_raw is not None:
        _need(_digest(controls_sha) and hashlib.sha256(controls_raw).hexdigest() == controls_sha
              and _digest(primary_control_sha) and _digest(basket_control_sha)
              and len(progress) >= 19 and all(item["state"] == "completed" for item in progress[:18])
              and (progress[18]["state"] == "completed"
                   or _b1_parse(controls_raw, "STORED_CONTROLS").get("status")
                   == "INSUFFICIENT_EVIDENCE"),
              "STORED_CONTROLS")
        controls = _b1_parse(controls_raw, "STORED_CONTROLS")
        _need(type(controls) is dict and controls.get("status") in
              ("FROZEN_DEVELOPMENT_ONLY", "INSUFFICIENT_EVIDENCE"), "STORED_CONTROLS")
        bound_results = []
        for computation_index, expected_sha in ((0, primary_control_sha), (15, basket_control_sha)):
            stored = connection.execute(
                "SELECT payload,payload_sha256 FROM b1_path_payloads "
                "WHERE trial_id=? AND computation_index=?",
                (trial_id, computation_index)).fetchone()
            _need(stored is not None and hashlib.sha256(stored[0]).hexdigest() == stored[1]
                  and stored[1] == expected_sha, "STORED_CONTROLS")
            bound_results.append(_b1_parse(stored[0], "STORED_PATH_PAYLOAD"))
        if controls["status"] == "FROZEN_DEVELOPMENT_ONLY":
            primary, basket = bound_results
            _need(controls.get("meanExposure") == primary.get("meanHeldTarget")
                  and controls.get("primaryDevelopmentSd") == primary.get("dailyReturnSd")
                  and controls.get("fullBasketDevelopmentSd") == basket.get("dailyReturnSd")
                  and controls.get("riskExposure") == min(
                      1, controls["primaryDevelopmentSd"] / controls["fullBasketDevelopmentSd"]),
                  "STORED_CONTROLS")
    else:
        _need(controls_sha is None and primary_control_sha is None and basket_control_sha is None
              and len(progress) < 20, "STORED_CONTROLS")
    result = None
    if summary_raw is not None:
        _need(_digest(summary_sha) and hashlib.sha256(summary_raw).hexdigest() == summary_sha,
              "STORED_RESULT_CORRUPT")
        summary = _b1_parse(summary_raw, "STORED_RESULT_CORRUPT")
        _need(type(summary) is dict and "paths" not in summary and "controlDefinitions" not in summary
              and type(summary.get("identity")) is dict
              and summary["identity"].get("inputSha256") == profile["inputSha256"]
              and summary.get("protocolSha256") == profile["protocolSha256"]
              and summary.get("implementationSha256") == profile["implementationSha256"]
              and isinstance(controls_raw, bytes), "STORED_RESULT_CORRUPT")
        if state == "COMPLETED":
            _validate_b1_summary(summary, profile)
        elif summary.get("status") == "INSUFFICIENT_EVIDENCE":
            _validate_b1_summary(summary, profile, allow_insufficient=True)
            _need(controls is not None and controls.get("status") == "INSUFFICIENT_EVIDENCE"
                  and len(progress) == 19 and payload_count == 19
                  and all(item["state"] == "completed" for item in progress),
                  "STORED_RESULT_CORRUPT")
        else:
            raise JournalError("STORED_RESULT_CORRUPT")
        by_id = {}
        for index in range(payload_count):
            payload = connection.execute(
                "SELECT payload FROM b1_path_payloads WHERE trial_id=? AND computation_index=?",
                (trial_id, index)).fetchone()
            projected = _b1_parse(payload[0], "STORED_PATH_PAYLOAD")
            expected = next((item for item in paths
                             if item["pathId"] == projected.get("pathId")), None)
            _need(expected is not None, "STORED_PATH_PAYLOAD")
            _validate_b1_path_payload(projected, expected)
            by_id[projected["pathId"]] = projected
        _need(len(by_id) == payload_count, "STORED_PATH_PAYLOAD")
        result = dict(summary)
        result["controlDefinitions"] = _b1_parse(controls_raw, "STORED_CONTROLS")
        result["paths"] = []
        for descriptor in paths:
            result_path = by_id.get(descriptor["pathId"])
            if result_path is None and summary.get("status") == "INSUFFICIENT_EVIDENCE":
                result_path = {
                    **descriptor, "status": "NOT_RUN_INSUFFICIENT_EVIDENCE",
                    "attempts": 0, "computed": False, "failure": None,
                }
            if result_path is not None:
                result["paths"].append(result_path)
        projected_path_count = 44 if summary.get("status") == "INSUFFICIENT_EVIDENCE" else payload_count
        _need(len(result["paths"]) == projected_path_count, "STORED_PATH_PAYLOAD")
        if summary.get("status") == "INSUFFICIENT_EVIDENCE":
            _need(len(result["paths"]) == 44, "STORED_RESULT_CORRUPT")
    else:
        _need(summary_sha is None and state != "COMPLETED",
              "STORED_RESULT_CORRUPT")
    _need(state in ("QUEUED", "CLAIMED", "RUNNING", "COMPLETED", "REJECTED",
                    "FAILED", "TIMED_OUT", "PARTIAL", "UNKNOWN"), "STORED_JOB_STATE")
    if state == "COMPLETED":
        _need(type(summary) is dict and summary.get("status") == "COMPLETED"
              and summary.get("completedPaths") == 44 and payload_count == 44
              and summary.get("attemptedPaths") == 44
              and controls.get("status") == "FROZEN_DEVELOPMENT_ONLY"
              and type(summary.get("authority")) is dict
              and set(summary["authority"]) == {
                  "researchOnly", "executionAuthorized", "strategyPnlAuthorized",
                  "discoveryAuthorized", "validationAuthorized", "holdoutAuthorized",
                  "paperAuthorized", "liveAuthorized",
              }
              and summary["authority"]["researchOnly"] is True
              and all(value is False for key, value in summary["authority"].items()
                      if key != "researchOnly"),
              "STORED_JOB_STATE")
    if state in ("CLAIMED", "RUNNING", "COMPLETED", "FAILED", "TIMED_OUT", "PARTIAL", "UNKNOWN"):
        _need(attempts == 1 and type(owner) is str and 0 < fence <= MAX_INT, "STORED_JOB_STATE")
    else:
        _need(attempts == 0 and owner is None and fence == 0, "STORED_JOB_STATE")
    result_raw = (json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                             allow_nan=False) if result is not None else None)
    result_digest = hashlib.sha256(result_raw.encode()).hexdigest() if result_raw is not None else None
    return {
        "trialId": trial_id, "trialKey": trial_key,
        "state": "unknown" if state in ("CLAIMED", "RUNNING") else state.lower(),
        "attempts": attempts, "owner": owner, "fence": fence,
        "profile": B1_PROFILE_NAME, "protocolSha256": profile["protocolSha256"],
        "sourceSha256": profile["sourceIdentitySha256"], "dataSha256": profile["inputSha256"],
        "manifestSha256": profile["manifestSha256"],
        "pathIds": list(profile["pathIds"]),
        "computationPathIds": [item["pathId"] for item in computation],
        "timestamps": {"createdAt": created_at, "startedAt": started_at, "finishedAt": finished_at},
        "paths": progress, "controls": controls_raw.decode("utf-8") if controls_raw else None,
        "controlBindings": ({"primaryDevelopmentSha256": primary_control_sha,
                             "fullBasketDevelopmentSha256": basket_control_sha}
                            if controls_raw else None),
        "result": result_raw, "resultSha256": result_digest,
        "summarySha256": summary_sha, "reason": reason,
        "unresolved": state in ("CLAIMED", "RUNNING"),
        "executionAuthorized": False, "promotionAuthorized": False,
        "profitabilityInferred": False,
    }


def enqueue_b1(database, trial_key):
    profile = _b1_profile()
    _need(type(trial_key) is str
          and re.fullmatch(r"trial-[a-z0-9][a-z0-9-]{0,47}", trial_key) is not None,
          "TRIAL_KEY_INVALID")
    trial_id = hashlib.sha256(trial_key.encode()).hexdigest()
    identity = {
        "trial_id": trial_id, "trial_key": trial_key, "profile": B1_PROFILE_NAME,
        "protocol_sha256": profile["protocolSha256"],
        "implementation_sha256": profile["implementationSha256"],
        "source_sha256": profile["sourceIdentitySha256"], "data_sha256": profile["inputSha256"],
        "manifest_sha256": profile["manifestSha256"], "path_ids": profile["pathIds"],
        "computation_order": profile["computationOrder"],
    }
    identity_raw = _canonical(identity)

    def operation(connection):
        existing = connection.execute("SELECT * FROM b1_jobs WHERE trial_id=?", (trial_id,)).fetchone()
        if existing:
            _need(existing[2] == identity_raw, "TRIAL_ID_CONFLICT")
            return _b1_job(connection, trial_id)
        _need(connection.execute("SELECT COUNT(*) FROM b1_jobs").fetchone()[0] < MAX_JOBS,
              "JOURNAL_CAPACITY")
        connection.execute("INSERT INTO b1_jobs(trial_id,trial_key,identity_json,state,created_at) "
                           "VALUES (?,?,?,'QUEUED',?)",
                           (trial_id, trial_key, identity_raw, _timestamp()))
        return _b1_job(connection, trial_id)
    return _b1_run(database, operation)


def scheduler_tick_b1(database, enabled=False, owner="local-b1-worker"):
    _need(type(enabled) is bool, "POLICY_INVALID")
    if not enabled:
        return {"state": "off", "claimed": False, "executionAuthorized": False}
    _need(type(owner) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,79}", owner),
          "OWNER_INVALID")
    day = datetime.now(timezone.utc).date().isoformat()

    def operation(connection):
        profile = _b1_profile()
        fence, active = connection.execute("SELECT fence,active FROM b1_meta WHERE id=1").fetchone()
        if active is not None:
            return {"state": "active", "claimed": False, "trialId": active,
                    "executionAuthorized": False}
        row = connection.execute("SELECT * FROM b1_jobs WHERE state='QUEUED' "
                                 "ORDER BY created_at,trial_id LIMIT 1").fetchone()
        if row is None:
            return {"state": "idle", "claimed": False, "executionAuthorized": False}
        budget = connection.execute("SELECT batches,compute_seconds FROM b1_daily_budget "
                                    "WHERE utc_day=?", (day,)).fetchone() or (0, 0)
        if budget[0] >= 1 or budget[1] + MAX_BATCH_SECONDS > MAX_BATCH_SECONDS:
            connection.execute("UPDATE b1_jobs SET state='REJECTED',reason=?,finished_at=? "
                               "WHERE trial_id=?", ("DAILY_BUDGET_EXHAUSTED", _timestamp(), row[0]))
            return {"state": "rejected", "claimed": False, "trialId": row[0],
                    "reason": "DAILY_BUDGET_EXHAUSTED", "executionAuthorized": False}
        _need(fence < MAX_INT, "FENCE_EXHAUSTED")
        fence += 1
        connection.execute("""INSERT INTO b1_daily_budget VALUES (?,?,?,0,0)
            ON CONFLICT(utc_day) DO UPDATE SET batches=excluded.batches,
            compute_seconds=excluded.compute_seconds""", (day, budget[0] + 1, budget[1] + MAX_BATCH_SECONDS))
        connection.execute("UPDATE b1_jobs SET state='CLAIMED',attempts=1,owner=?,fence=? WHERE trial_id=?",
                           (owner, fence, row[0]))
        connection.execute("UPDATE b1_meta SET fence=?,active=? WHERE id=1", (fence, row[0]))
        return {"state": "claimed", "claimed": True, "claim": _b1_job(connection, row[0]),
                "executionAuthorized": False}
    return _b1_run(database, operation)


def _b1_bound(connection, receipt):
    _need(type(receipt) is dict and _digest(receipt.get("trialId"))
          and type(receipt.get("owner")) is str and type(receipt.get("fence")) is int,
          "CLAIM_INVALID")
    job = _b1_job(connection, receipt["trialId"])
    _need(job["owner"] == receipt["owner"] and job["fence"] == receipt["fence"]
          and job["trialKey"] == receipt.get("trialKey")
          and job["profile"] == receipt.get("profile")
          and job["sourceSha256"] == receipt.get("sourceSha256")
          and job["dataSha256"] == receipt.get("dataSha256")
          and job["manifestSha256"] == receipt.get("manifestSha256")
          and job["pathIds"] == receipt.get("pathIds")
          and job["computationPathIds"] == receipt.get("computationPathIds"),
          "STALE_CLAIM")
    _need(connection.execute("SELECT fence,active FROM b1_meta WHERE id=1").fetchone()
          == (receipt["fence"], receipt["trialId"]), "STALE_FENCE")
    return connection.execute("SELECT * FROM b1_jobs WHERE trial_id=?", (receipt["trialId"],)).fetchone()


def start_b1(database, receipt, *, busy_timeout=5, deadline=None):
    def operation(connection):
        row = _b1_bound(connection, receipt)
        _need(row[3] == "CLAIMED", "ATTEMPT_CONSUMED")
        connection.execute("UPDATE b1_jobs SET state='RUNNING',started_at=? WHERE trial_id=?",
                           (_timestamp(), row[0]))
        return _b1_job(connection, row[0])
    return _b1_run(database, operation, busy_timeout, deadline)


def record_b1_path_started(database, receipt, index, path_id, *, busy_timeout=5, deadline=None):
    def operation(connection):
        row = _b1_bound(connection, receipt)
        profile = _b1_profile()
        progress = _b1_parse(row[10], "STORED_PROGRESS")
        _need(row[3] == "RUNNING" and type(index) is int and index == len(progress)
              and 0 <= index < 44 and profile["computation"][index]["pathId"] == path_id,
              "PATH_ORDER")
        if index >= 19:
            _need(row[11] is not None
                  and _b1_parse(row[11], "STORED_CONTROLS").get("status") == "FROZEN_DEVELOPMENT_ONLY",
                  "CONTROLS_NOT_FROZEN")
        progress.append({
            "pathId": path_id, "ordinal": index + 1,
            "phase": "DEVELOPMENT" if index < 19 else "DIAGNOSTIC",
            "state": "started", "startedAt": _timestamp(),
        })
        raw = _canonical(progress)
        _need(len(raw.encode()) <= MAX_PROGRESS_BYTES, "PROGRESS_BOUND")
        connection.execute("UPDATE b1_jobs SET progress_json=? WHERE trial_id=?", (raw, row[0]))
        return _b1_job(connection, row[0])
    return _b1_run(database, operation, busy_timeout, deadline)


def record_b1_path_completed(database, receipt, index, payload_bytes, *, busy_timeout=5, deadline=None):
    profile = _b1_profile()
    _need(type(payload_bytes) is bytes and 0 < len(payload_bytes) <= MAX_RESULT_BYTES,
          "PATH_RESULT_INVALID")
    digest = hashlib.sha256(payload_bytes).hexdigest()
    payload = _b1_parse(payload_bytes, "PATH_RESULT_INVALID")
    expected = profile["computation"][index] if type(index) is int and 0 <= index < 44 else None
    _need(expected is not None, "PATH_RESULT_INVALID")
    _validate_b1_path_payload(payload, expected)

    def operation(connection):
        row = _b1_bound(connection, receipt)
        progress = _b1_parse(row[10], "STORED_PROGRESS")
        _need(row[3] == "RUNNING" and type(index) is int and index == len(progress) - 1
              and index >= 0 and progress[index]["state"] == "started"
              and progress[index]["pathId"] == expected["pathId"], "PATH_ORDER")
        if expected["kind"] == "FULL_BASKET":
            _need(payload["targetExposure"] == 1, "PATH_RESULT_INVALID")
        elif expected["kind"] == "CASH":
            _need(payload["targetExposure"] == 0, "PATH_RESULT_INVALID")
        elif expected["kind"] == "FIXED_CONTROL":
            controls = _b1_parse(row[11], "STORED_CONTROLS")
            target = controls["meanExposure"] if expected["variantId"] == "frozen-mean-exposure" \
                else controls["riskExposure"]
            _need(payload["targetExposure"] == target, "PATH_RESULT_INVALID")
        _need(connection.execute("SELECT 1 FROM b1_path_payloads WHERE trial_id=? "
                                 "AND computation_index=?", (row[0], index)).fetchone() is None,
              "PATH_DUPLICATE")
        progress[index].update({"state": "completed", "payloadSha256": digest,
                                "completedAt": _timestamp()})
        raw = _canonical(progress)
        _need(len(raw.encode()) <= MAX_PROGRESS_BYTES, "PROGRESS_BOUND")
        connection.execute("INSERT INTO b1_path_payloads VALUES (?,?,?,?)",
                           (row[0], index, payload_bytes, digest))
        connection.execute("UPDATE b1_jobs SET progress_json=? WHERE trial_id=?", (raw, row[0]))
        return _b1_job(connection, row[0])
    return _b1_run(database, operation, busy_timeout, deadline)


def record_b1_controls(database, receipt, controls_bytes, *, busy_timeout=5, deadline=None):
    _need(type(controls_bytes) is bytes and 0 < len(controls_bytes) <= B1_CONTROL_BYTES,
          "CONTROLS_INVALID")
    controls = _b1_parse(controls_bytes, "CONTROLS_INVALID")
    _need(type(controls) is dict and controls.get("status") in
          ("FROZEN_DEVELOPMENT_ONLY", "INSUFFICIENT_EVIDENCE"), "CONTROLS_INVALID")
    if controls["status"] == "FROZEN_DEVELOPMENT_ONLY":
        _need(set(controls) == {
                  "status", "meanExposure", "riskExposure", "primaryDevelopmentSd",
                  "fullBasketDevelopmentSd", "calibration",
              } and controls["calibration"] == "DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS"
              and all(type(controls[key]) in (int, float) and
                      __import__("math").isfinite(controls[key]) for key in (
                          "meanExposure", "riskExposure", "primaryDevelopmentSd",
                          "fullBasketDevelopmentSd"))
              and 0 <= controls["meanExposure"] <= 1 and 0 <= controls["riskExposure"] <= 1,
              "CONTROLS_INVALID")
    else:
        _need(set(controls) == {"ok", "status", "reason", "primarySd", "benchmarkSd"}
              and controls["ok"] is False
              and controls["reason"] == "INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR",
              "CONTROLS_INVALID")

    def operation(connection):
        row = _b1_bound(connection, receipt)
        profile = _b1_profile()
        progress = _b1_parse(row[10], "STORED_PROGRESS")
        _need(row[3] == "RUNNING" and len(progress) == 19
              and all(item["state"] == "completed" for item in progress[:18])
              and (progress[18]["state"] == "completed"
                   or controls["status"] == "INSUFFICIENT_EVIDENCE")
              and row[11] is None, "CONTROLS_ORDER")
        if controls["status"] == "FROZEN_DEVELOPMENT_ONLY":
            computation = profile["computation"]
            required_results = {}
            for ordinal in (0, 15):
                comp_index = ordinal
                expected_path = computation[comp_index]
                stored = connection.execute("SELECT payload,payload_sha256 FROM b1_path_payloads "
                                            "WHERE trial_id=? AND computation_index=?",
                                            (row[0], comp_index)).fetchone()
                _need(stored is not None and hashlib.sha256(stored[0]).hexdigest() == stored[1],
                      "STORED_PATH_PAYLOAD")
                result = _b1_parse(stored[0], "STORED_PATH_PAYLOAD")
                required_results[expected_path["kind"]] = result
            primary = required_results["CANDIDATE"]
            basket = required_results["FULL_BASKET"]
            _need(primary["variantId"] == "primary-n30-f25"
                  and primary["scenarioId"] == "base-15bp"
                  and primary["segmentId"] == "development"
                  and basket["scenarioId"] == "base-15bp" and basket["segmentId"] == "development"
                  and controls["meanExposure"] == primary["meanHeldTarget"]
                  and controls["primaryDevelopmentSd"] == primary["dailyReturnSd"]
                  and controls["fullBasketDevelopmentSd"] == basket["dailyReturnSd"]
                  and controls["riskExposure"] == min(
                      1, controls["primaryDevelopmentSd"] / controls["fullBasketDevelopmentSd"]),
                  "CONTROLS_BINDING_INVALID")
        digest = hashlib.sha256(controls_bytes).hexdigest()
        primary = connection.execute(
            "SELECT payload_sha256 FROM b1_path_payloads WHERE trial_id=? AND computation_index=0",
            (row[0],)).fetchone()
        basket = connection.execute(
            "SELECT payload_sha256 FROM b1_path_payloads WHERE trial_id=? AND computation_index=15",
            (row[0],)).fetchone()
        _need(primary is not None and basket is not None, "CONTROLS_BINDING_INVALID")
        connection.execute("""UPDATE b1_jobs SET controls_json=?,controls_sha256=?,
            control_primary_sha256=?,control_basket_sha256=? WHERE trial_id=?""",
            (controls_bytes, digest, primary[0], basket[0], row[0]))
        return _b1_job(connection, row[0])
    return _b1_run(database, operation, busy_timeout, deadline)


def settle_b1(database, receipt, outcome, reason, summary_bytes=None, *,
              busy_timeout=5, deadline=None):
    _need(outcome in ("COMPLETED", "FAILED", "TIMED_OUT", "PARTIAL")
          and type(reason) is str and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", reason),
          "SETTLEMENT_INVALID")
    summary = None
    if summary_bytes is not None:
        _need(type(summary_bytes) is bytes and 0 < len(summary_bytes) <= MAX_RESULT_BYTES,
              "RESULT_BOUND")
        summary = _b1_parse(summary_bytes, "RESULT_INVALID")
        _need(type(summary) is dict and "paths" not in summary and "controlDefinitions" not in summary
              and summary.get("protocolSha256") == _b1_profile()["protocolSha256"]
              and summary.get("implementationSha256") == _b1_profile()["implementationSha256"]
              and type(summary.get("identity")) is dict
              and summary["identity"].get("inputSha256") == _b1_profile()["inputSha256"],
              "RESULT_INVALID")
    if outcome == "COMPLETED":
        _need(summary is not None, "INCOMPLETE_BATCH")
        _validate_b1_summary(summary, _b1_profile())
    elif summary is not None:
        _need(outcome == "FAILED" and summary.get("status") == "INSUFFICIENT_EVIDENCE",
              "RESULT_SCHEMA_INVALID")
        _validate_b1_summary(summary, _b1_profile(), allow_insufficient=True)

    def operation(connection):
        row = _b1_bound(connection, receipt)
        progress = _b1_parse(row[10], "STORED_PROGRESS")
        controls = _b1_parse(row[11], "STORED_CONTROLS") if row[11] is not None else None
        if outcome == "COMPLETED":
            _need(row[3] == "RUNNING" and len(progress) == 44
                  and all(item["state"] == "completed" for item in progress)
                  and controls is not None and controls.get("status") == "FROZEN_DEVELOPMENT_ONLY",
                  "INCOMPLETE_BATCH")
        elif summary is not None:
            _need(controls is not None and controls.get("status") == "INSUFFICIENT_EVIDENCE"
                  and len(progress) == 19 and all(item["state"] == "completed" for item in progress),
                  "INCOMPLETE_BATCH")
        if summary is not None:
            _need(row[14] is None, "RESULT_ALREADY_SETTLED")
            summary_digest = hashlib.sha256(summary_bytes).hexdigest()
        else:
            summary_digest = None
        finished_at = _timestamp()
        used_before = _b1_capacity(connection)
        additional = len(summary_bytes) if summary_bytes else 0
        _need(used_before + additional <= MAX_RESULT_BYTES, "RESULT_CAPACITY")
        connection.execute("""UPDATE b1_jobs SET state=?,summary_json=?,summary_sha256=?,
            reason=?,finished_at=? WHERE trial_id=?""",
            (outcome, summary_bytes, summary_digest, reason, finished_at, row[0]))
        connection.execute("UPDATE b1_meta SET active=NULL WHERE id=1")
        return _b1_job(connection, row[0])
    return _b1_run(database, operation, busy_timeout, deadline)


def reconcile_b1(database, trial_id, note):
    _need(_digest(trial_id) and type(note) is str
          and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", note), "RECONCILIATION_INVALID")

    def operation(connection):
        row = connection.execute("SELECT * FROM b1_jobs WHERE trial_id=?", (trial_id,)).fetchone()
        _need(row is not None and row[3] in ("CLAIMED", "RUNNING")
              and connection.execute("SELECT active FROM b1_meta WHERE id=1").fetchone()[0] == trial_id,
              "NOT_UNRESOLVED")
        connection.execute("UPDATE b1_jobs SET state='UNKNOWN',reason=?,finished_at=? WHERE trial_id=?",
                           (note, _timestamp(), trial_id))
        connection.execute("UPDATE b1_meta SET active=NULL WHERE id=1")
        return _b1_job(connection, trial_id)
    return _b1_run(database, operation)


def inspect_b1(database, trial_id):
    _need(_digest(trial_id), "TRIAL_ID_INVALID")
    connection = _b1_connect(database, busy_timeout=0, readonly=True)
    try:
        _b1_check(connection)
        return _b1_job(connection, trial_id)
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def b1_remaining_capacity(database, receipt, *, deadline=None):
    connection = _b1_connect(database, busy_timeout=0.01, deadline=deadline, readonly=True)
    try:
        _b1_bound(connection, receipt)
        return MAX_RESULT_BYTES - _b1_capacity(connection)
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()
