"""Bounded host capability probe. Artificial markers only; no Paper journal."""
import json
import os
from pathlib import Path
import sqlite3
import signal
import subprocess
import sys
import tempfile
import time


CHILD = r'''
import os,sqlite3,sys
db=sqlite3.connect(sys.argv[1],timeout=0.05,isolation_level=None)
db.execute("PRAGMA synchronous=FULL")
db.execute("PRAGMA max_page_count=64")
db.execute("BEGIN IMMEDIATE")
db.execute("INSERT INTO markers(value) VALUES (?)",(sys.argv[2],))
if sys.argv[2]=="exit_before_commit": os._exit(31)
db.execute("COMMIT")
os._exit(32)
'''


def inspect(database):
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True,
                                 timeout=0.05)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchall()
        if integrity != [("ok",)]:
            raise RuntimeError("integrity")
        return [row[0] for row in connection.execute(
            "SELECT value FROM markers ORDER BY value")]
    finally:
        connection.close()


def child(database, marker, expected_exit, deadline):
    process = subprocess.Popen(
        [sys.executable, "-I", "-c", CHILD, str(database), marker],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, shell=False,
        env={key: os.environ[key] for key in ("PATH", "LANG") if key in os.environ},
    )
    try:
        remaining = min(5.0, deadline - time.monotonic())
        if remaining <= 0 or process.wait(timeout=remaining) != expected_exit:
            raise RuntimeError("child")
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)


def probe():
    deadline = time.monotonic() + 20
    with tempfile.TemporaryDirectory(prefix="meridian-capability-") as temporary:
        root = Path(temporary)
        database = root / "markers.sqlite"
        fd = os.open(database, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        connection = sqlite3.connect(database, timeout=0.05, isolation_level=None)
        try:
            connection.execute("PRAGMA page_size=4096")
            if connection.execute("PRAGMA max_page_count=64").fetchone() != (64,):
                raise RuntimeError("page_bound")
            if connection.execute("PRAGMA journal_mode=DELETE").fetchone() != ("delete",):
                raise RuntimeError("journal_mode")
            connection.execute("PRAGMA synchronous=FULL")
            if connection.execute("PRAGMA synchronous").fetchone() != (2,):
                raise RuntimeError("sync_mode")
            connection.execute("CREATE TABLE markers(value TEXT PRIMARY KEY CHECK(length(value)<=32))")
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("INSERT INTO markers VALUES ('committed')")
            connection.execute("COMMIT")
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("INSERT INTO markers VALUES ('rolled_back')")
            connection.execute("ROLLBACK")
        finally:
            connection.close()
        if inspect(database) != ["committed"]:
            raise RuntimeError("rollback")
        child(database, "exit_before_commit", 31, deadline)
        # SQLite may need to recover its own hot rollback journal before a
        # read-only open. Opening normally is storage recovery, not Paper
        # reconciliation, retry, or reconstruction of a domain receipt.
        recovery = sqlite3.connect(database, timeout=0.05)
        try:
            recovery.execute("SELECT count(*) FROM markers").fetchone()
        finally:
            recovery.close()
        if inspect(database) != ["committed"]:
            raise RuntimeError("precommit_exit")
        child(database, "exit_after_commit", 32, deadline)
        if inspect(database) != ["committed", "exit_after_commit"]:
            raise RuntimeError("postcommit_exit")
        if sum(path.stat().st_size for path in root.iterdir()) > 1024 * 1024:
            raise RuntimeError("artifact_bound")
        if time.monotonic() >= deadline:
            raise RuntimeError("deadline")
    return {
        "scope": "HOST_CAPABILITY_ONLY_NO_PAPER_LEDGER",
        "status": "PASS", "python": sys.version.split()[0],
        "sqlite": sqlite3.sqlite_version, "platform": os.name,
        "commit_and_rollback": True, "exit_before_commit_rolled_back": True,
        "exit_after_commit_retained": True, "children_reaped": True,
        "temporary_directory_removed": not root.exists(),
        "power_loss_durability_proven": False,
        "production_compatibility_proven": False,
    }


def terminate_probe(signum, frame):
    # Unwind child finally blocks and TemporaryDirectory on the outer watchdog.
    raise TimeoutError("watchdog")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, terminate_probe)
    if len(sys.argv) != 1:
        print('{"status":"REJECTED","reason":"NO_ARGUMENTS_ALLOWED"}')
        sys.exit(2)
    try:
        print(json.dumps(probe(), sort_keys=True, separators=(",", ":")))
    except Exception:
        # Do not echo paths, arbitrary payloads, or inherited environment.
        print('{"status":"FAILED","reason":"HOST_CAPABILITY_NOT_ESTABLISHED"}')
        sys.exit(1)
