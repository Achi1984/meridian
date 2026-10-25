"""Manual, fail-closed D2 historical one-shot launcher."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys

import journal
import supervisor


TRIAL_KEY = "trial-historical-d2-r1"
LIMITS = {"batch_seconds": 1800, "path_seconds": 60}
PROJECT_ROOT = Path(__file__).resolve().parents[2]
OWNER_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,79}\Z")


class LaunchError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class TerminationRequested(InterruptedError):
    pass


def _need(condition, code):
    if not condition:
        raise LaunchError(code)


def _private_directory(path):
    try:
        info = os.lstat(path)
    except OSError:
        raise LaunchError("PRIVATE_DIRECTORY_INVALID")
    _need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
          and info.st_mode & 0o077 == 0, "PRIVATE_DIRECTORY_INVALID")


def _absolute_exact(raw, *, existing):
    _need(type(raw) is str and raw and Path(raw).is_absolute(), "EXACT_PATH_REQUIRED")
    path = Path(raw)
    try:
        resolved = path.resolve(strict=existing)
    except OSError:
        raise LaunchError("EXACT_PATH_INVALID")
    _need(str(resolved) == raw, "EXACT_PATH_INVALID")
    return path


def _private_regular_file(path, *, existing):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        if not existing:
            return None
        raise LaunchError("PRIVATE_FILE_INVALID")
    except OSError:
        raise LaunchError("PRIVATE_FILE_INVALID")
    _need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
          and info.st_mode & 0o077 == 0, "PRIVATE_FILE_INVALID")
    return info


def _validate_outside_repository(path):
    _need(not path.is_relative_to(PROJECT_ROOT), "PRIVATE_PATH_IN_REPOSITORY")


def _validate_journal_path(raw):
    path = _absolute_exact(raw, existing=True)
    _validate_outside_repository(path)
    _private_directory(path.parent)
    _private_regular_file(path, existing=True)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{path}{suffix}")
        if os.path.lexists(sidecar):
            _absolute_exact(str(sidecar), existing=True)
            _private_regular_file(sidecar, existing=True)
    return path


def _validate_evidence_path(raw):
    path = _absolute_exact(raw, existing=False)
    _validate_outside_repository(path)
    _private_directory(path.parent)
    _need(_private_regular_file(path, existing=False) is None, "EVIDENCE_ALREADY_EXISTS")
    return path


def _profile_preflight():
    try:
        profile = journal._b1_profile(journal.HISTORICAL_PROFILE_NAME)
    except journal.JournalError as error:
        raise LaunchError(error.code)
    _need(profile["profile"] == journal.HISTORICAL_PROFILE_NAME
          and profile["status"] == "FROZEN_FOR_D2"
          and profile["inputManifest"] is not None
          and profile["inputManifestSha256"] is not None
          and profile["inputSha256"] is not None
          and profile["approvalReceipt"] is not None
          and profile["trialKey"] == TRIAL_KEY
          and profile["limits"] == {
              "paths": 44, "pathSeconds": LIMITS["path_seconds"],
              "batchSeconds": LIMITS["batch_seconds"],
              "outputBytes": journal.MAX_RESULT_BYTES, "attemptsPerPath": 1,
          }, "HISTORICAL_ADMISSION_REQUIRED")
    return profile


def _journal_preflight(database, profile):
    try:
        connection = journal._b1_connect(database, busy_timeout=0, readonly=True)
    except journal.JournalError as error:
        raise LaunchError(error.code)
    try:
        journal._b1_check(connection)
        stored_profile = journal._profile_for_connection(connection)
        _need(stored_profile["runProfileSha256"] == profile["runProfileSha256"]
              and stored_profile["sourceIdentitySha256"] == profile["sourceIdentitySha256"],
              "JOURNAL_PROFILE_MISMATCH")
        row = connection.execute(
            "SELECT profile,active FROM b1_meta WHERE id=1").fetchone()
        _need(row == (journal.HISTORICAL_PROFILE_NAME, None), "JOURNAL_FENCE_ACTIVE")
        jobs = connection.execute("SELECT COUNT(*) FROM b1_jobs").fetchone()[0]
        queued = connection.execute(
            "SELECT COUNT(*) FROM b1_jobs WHERE state='QUEUED'").fetchone()[0]
        _need(jobs == 0 and queued == 0, "JOURNAL_NOT_EMPTY")
        budgets = connection.execute("SELECT COUNT(*) FROM b1_daily_budget").fetchone()[0]
        _need(budgets == 0, "JOURNAL_BUDGET_NOT_EMPTY")
    except journal.JournalError as error:
        raise LaunchError(error.code)
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def _create_evidence(path):
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags, 0o600)
        os.fchmod(fd, 0o600)
        info = os.fstat(fd)
        _need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
              and info.st_mode & 0o077 == 0, "EVIDENCE_PERMISSIONS_INVALID")
        parent_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        return fd
    except FileExistsError:
        raise LaunchError("EVIDENCE_ALREADY_EXISTS")
    except LaunchError:
        if "fd" in locals():
            os.close(fd)
        raise
    except OSError:
        if "fd" in locals():
            os.close(fd)
        raise LaunchError("EVIDENCE_CREATE_FAILED")
    except BaseException:
        if "fd" in locals():
            os.close(fd)
        raise


def _record(fd, sequence, event, **fields):
    raw = (json.dumps(
        {"sequence": sequence, "event": event, **fields},
        sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()
    offset = 0
    while offset < len(raw):
        offset += os.write(fd, raw[offset:])
    os.fsync(fd)


def _safe_code(error):
    code = getattr(error, "code", None)
    if type(code) is str and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", code):
        return code
    if isinstance(error, TerminationRequested):
        return "SIGTERM_INTERRUPTED"
    if isinstance(error, KeyboardInterrupt):
        return "INTERRUPTED"
    return "LAUNCH_FAILED"


def _safe_reason(value):
    return value if type(value) is str and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", value) else None


def _enqueue_matches(enqueued, profile):
    return (
        type(enqueued) is dict
        and enqueued.get("trialId") == hashlib.sha256(TRIAL_KEY.encode()).hexdigest()
        and enqueued.get("trialKey") == TRIAL_KEY
        and enqueued.get("profile") == journal.HISTORICAL_PROFILE_NAME
        and type(enqueued.get("attempts")) is int and enqueued["attempts"] == 0
        and enqueued.get("owner") is None and enqueued.get("fence") == 0
        and enqueued.get("sourceSha256") == profile["sourceIdentitySha256"]
        and enqueued.get("dataSha256") == profile["inputSha256"]
        and enqueued.get("manifestSha256") == profile["manifestSha256"]
        and enqueued.get("pathIds") == list(profile["pathIds"])
        and enqueued.get("executionAuthorized") is False
        and enqueued.get("promotionAuthorized") is False
    )


def _claim_matches(claim, profile, owner):
    trial_id = hashlib.sha256(TRIAL_KEY.encode()).hexdigest()
    return (
        type(claim) is dict
        and claim.get("trialId") == trial_id
        and claim.get("trialKey") == TRIAL_KEY
        and claim.get("profile") == journal.HISTORICAL_PROFILE_NAME
        and claim.get("owner") == owner
        and type(claim.get("fence")) is int and claim["fence"] > 0
        and type(claim.get("attempts")) is int and claim["attempts"] == 1
        and claim.get("sourceSha256") == profile["sourceIdentitySha256"]
        and claim.get("dataSha256") == profile["inputSha256"]
        and claim.get("manifestSha256") == profile["manifestSha256"]
        and claim.get("pathIds") == list(profile["pathIds"])
        and claim.get("computationPathIds") == profile["computationPathIds"]
        and claim.get("executionAuthorized") is False
        and claim.get("promotionAuthorized") is False
    )


def run_once(database, evidence_path, owner):
    _need(sys.platform.startswith("linux"), "LINUX_REQUIRED")
    _need(type(owner) is str and OWNER_PATTERN.fullmatch(owner) is not None, "OWNER_INVALID")
    profile = _profile_preflight()
    database = _validate_journal_path(database)
    evidence_path = _validate_evidence_path(evidence_path)
    _journal_preflight(database, profile)

    fd = _create_evidence(evidence_path)
    sequence = 0

    def record(event, **fields):
        nonlocal sequence
        _record(fd, sequence, event, **fields)
        sequence += 1

    try:
        record("intent", trialKey=TRIAL_KEY, owner=owner, batchSeconds=LIMITS["batch_seconds"],
               pathSeconds=LIMITS["path_seconds"], outputBytes=journal.MAX_RESULT_BYTES)
        record("enqueue_invoked")
        try:
            enqueued = journal.enqueue_b1(database, TRIAL_KEY)
        except BaseException:
            record("enqueue_outcome", state="AMBIGUOUS")
            raise
        enqueue_matched = _enqueue_matches(enqueued, profile)
        record("enqueue_returned",
               trialId=enqueued.get("trialId") if type(enqueued) is dict else None,
               attempts=enqueued.get("attempts") if type(enqueued) is dict else None,
               identityValid=enqueue_matched)
        _need(enqueue_matched, "ENQUEUE_IDENTITY_MISMATCH")

        record("claim_invoked")
        try:
            scheduled = journal.scheduler_tick_b1(database, enabled=True, owner=owner)
        except BaseException:
            record("claim_outcome", state="AMBIGUOUS")
            raise
        claim = scheduled.get("claim") if type(scheduled) is dict else None
        matched = (
            type(scheduled) is dict and scheduled.get("state") == "claimed"
            and scheduled.get("claimed") is True
            and _claim_matches(claim, profile, owner)
        )
        scheduler_state = scheduled.get("state") if type(scheduled) is dict else None
        record("claim_returned",
               state=scheduler_state if scheduler_state in (
                   "claimed", "blocked", "idle", "active", "rejected", "off") else "INVALID",
               claimedIdentityValid=matched,
               trialId=(claim.get("trialId") if type(claim) is dict
                        and claim.get("trialId") == hashlib.sha256(TRIAL_KEY.encode()).hexdigest()
                        else None),
               fence=(claim.get("fence") if type(claim) is dict
                      and type(claim.get("fence")) is int else None))
        _need(matched, "CLAIM_IDENTITY_MISMATCH")

        record("run_invoked", batchTimer="supervisor_invocation", setupAndEnqueueExcluded=True)
        try:
            result = supervisor.run_b1_batch(database, claim, limits=LIMITS)
        except BaseException:
            record("run_outcome", state="AMBIGUOUS")
            raise
        result_state = result.get("state") if type(result) is dict else None
        state = result_state if result_state in (
            "completed", "failed", "timed_out", "partial", "unknown", "UNSETTLED") else "INVALID"
        record("run_returned", state=state,
               reason=_safe_reason(result.get("reason")) if type(result) is dict else None,
               persistConfirmed=result.get("persistConfirmed") if type(result) is dict else None)
        return {"state": state, "reason": _safe_reason(
            result.get("reason")) if type(result) is dict else None}
    except BaseException as error:
        try:
            record("failure", code=_safe_code(error))
        except OSError:
            pass
        raise
    finally:
        os.close(fd)


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(2, "D2_ONE_SHOT_STOP ARGUMENTS_INVALID\n")


def main(argv=None):
    parser = _Parser(description="Manual, single-attempt D2 historical launcher.")
    parser.add_argument("command", choices=("execute",))
    parser.add_argument("--journal", required=True, metavar="EXACT_EXISTING_JOURNAL")
    parser.add_argument("--evidence", required=True, metavar="EXACT_NEW_PRIVATE_RECEIPT")
    parser.add_argument("--owner", required=True, metavar="EXPLICIT_OWNER")
    args = parser.parse_args(argv)

    def terminate(signum, _frame):
        raise TerminationRequested(signal.Signals(signum).name)

    signal.signal(signal.SIGTERM, terminate)
    try:
        outcome = run_once(args.journal, args.evidence, args.owner)
    except BaseException as error:
        print(f"D2_ONE_SHOT_STOP {_safe_code(error)}", file=sys.stderr)
        return 1
    print(f"D2_ONE_SHOT_RETURNED state={outcome['state']}")
    return 0 if outcome["state"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
