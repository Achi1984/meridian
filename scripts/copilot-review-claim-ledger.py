#!/usr/bin/env python3
"""Durable, source-only one-use claims for advisory review requests."""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import uuid

REPOSITORY = "Achi1984/meridian"
MAX_INPUT_BYTES = 4096
MAX_TTL_MS = 300_000
MAX_SAFE_INTEGER = 9_007_199_254_740_991
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
SHA1_PATTERN = re.compile(r"^[a-f0-9]{40}$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
FIELDS = {
    "repository",
    "pr",
    "headSha",
    "baseSha",
    "requestId",
    "packetSha256",
    "modelId",
    "expiresAt",
}


class ClaimLedgerError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _fail(code):
    raise ClaimLedgerError(code)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail("JSON_DUPLICATE_KEY")
        result[key] = value
    return result


def _reject_constant(_value):
    _fail("JSON_INVALID")


def parse_input(raw):
    if not isinstance(raw, bytes) or len(raw) > MAX_INPUT_BYTES:
        _fail("INPUT_BOUND")
    try:
        value = json.loads(
            raw.decode("utf-8", "strict"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeError, json.JSONDecodeError):
        _fail("JSON_INVALID")
    if not isinstance(value, dict):
        _fail("BINDING_INVALID")
    return value


def _validate_binding(binding, now_ms):
    if not isinstance(binding, dict) or set(binding) != FIELDS:
        _fail("BINDING_INVALID")
    if binding["repository"] != REPOSITORY:
        _fail("BINDING_INVALID")
    if type(binding["pr"]) is not int or not 1 <= binding["pr"] <= MAX_SAFE_INTEGER:
        _fail("BINDING_INVALID")
    if not isinstance(binding["headSha"], str) or not SHA1_PATTERN.fullmatch(binding["headSha"]):
        _fail("BINDING_INVALID")
    if not isinstance(binding["baseSha"], str) or not SHA1_PATTERN.fullmatch(binding["baseSha"]):
        _fail("BINDING_INVALID")
    if binding["headSha"] == binding["baseSha"]:
        _fail("BINDING_INVALID")
    if not isinstance(binding["packetSha256"], str) or not SHA256_PATTERN.fullmatch(binding["packetSha256"]):
        _fail("BINDING_INVALID")
    request_id = binding["requestId"]
    if not isinstance(request_id, str) or not ID_PATTERN.fullmatch(request_id):
        _fail("BINDING_INVALID")
    model_id = binding["modelId"]
    if (
        not isinstance(model_id, str)
        or not ID_PATTERN.fullmatch(model_id)
        or not model_id.startswith("claude-")
        or re.search(r"(^|[._-])(auto|latest|default)($|[._-])", model_id, re.IGNORECASE)
    ):
        _fail("BINDING_INVALID")
    expires_at = binding["expiresAt"]
    if type(expires_at) is not int or not 0 < expires_at <= MAX_SAFE_INTEGER:
        _fail("BINDING_INVALID")
    if type(now_ms) is not int or not 0 <= now_ms <= MAX_SAFE_INTEGER:
        _fail("CLOCK_INVALID")
    if now_ms >= expires_at or expires_at - now_ms > MAX_TTL_MS:
        _fail("EXPIRED")
    return {key: binding[key] for key in (
        "repository",
        "pr",
        "headSha",
        "baseSha",
        "requestId",
        "packetSha256",
        "modelId",
        "expiresAt",
    )}


def _database_path(database):
    try:
        path = os.fspath(database)
    except TypeError:
        _fail("DATABASE_INVALID")
    if (
        not isinstance(path, str)
        or not path
        or path == ":memory:"
        or len(path.encode("utf-8", "strict")) > 4096
        or "\0" in path
    ):
        _fail("DATABASE_INVALID")
    return path


def consume_claim(database, binding):
    """Atomically consume one binding and return the runtime-compatible receipt."""
    current_time = int(time.time() * 1000)
    binding = _validate_binding(binding, current_time)
    path = _database_path(database)
    claim_id = uuid.uuid4().hex
    serialized = json.dumps(binding, sort_keys=True, separators=(",", ":")).encode("ascii")
    binding_hash = hashlib.sha256(serialized).hexdigest()
    connection = None
    try:
        connection = sqlite3.connect(path, timeout=10, isolation_level=None)
        connection.execute("PRAGMA busy_timeout = 10000")
        connection.execute("PRAGMA synchronous = FULL")
        connection.execute("BEGIN IMMEDIATE")
        current_time = int(time.time() * 1000)
        binding = _validate_binding(binding, current_time)
        connection.execute(
            """CREATE TABLE IF NOT EXISTS consumed_claims (
                request_id TEXT PRIMARY KEY,
                claim_id TEXT NOT NULL UNIQUE,
                binding_sha256 TEXT NOT NULL,
                repository TEXT NOT NULL,
                pr INTEGER NOT NULL,
                head_sha TEXT NOT NULL,
                base_sha TEXT NOT NULL,
                packet_sha256 TEXT NOT NULL,
                model_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                consumed_at INTEGER NOT NULL
            )"""
        )
        connection.execute(
            """INSERT INTO consumed_claims (
                request_id, claim_id, binding_sha256, repository, pr, head_sha,
                base_sha, packet_sha256, model_id, expires_at, consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                binding["requestId"],
                claim_id,
                binding_hash,
                binding["repository"],
                binding["pr"],
                binding["headSha"],
                binding["baseSha"],
                binding["packetSha256"],
                binding["modelId"],
                binding["expiresAt"],
                current_time,
            ),
        )
        connection.commit()
    except ClaimLedgerError:
        if connection is not None:
            connection.rollback()
        raise
    except sqlite3.IntegrityError:
        if connection is not None:
            connection.rollback()
        _fail("CLAIM_ALREADY_CONSUMED")
    except sqlite3.Error:
        if connection is not None:
            connection.rollback()
        _fail("LEDGER_ERROR")
    finally:
        if connection is not None:
            connection.close()
    return {"claimId": claim_id, "binding": binding}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="durable SQLite database path")
    parser.add_argument("command", choices=("consume",))
    args = parser.parse_args(argv)
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        binding = parse_input(raw)
        receipt = consume_claim(args.db, binding)
    except ClaimLedgerError as error:
        print(json.dumps({"error": error.code}, separators=(",", ":")), file=sys.stderr)
        return 2
    print(json.dumps(receipt, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
