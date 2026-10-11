#!/usr/bin/env python3
"""Inactive local SQLite event deduplication/fencing prototype; no external writes."""
import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time

MAX_BYTES = 4096
MAX_INT = 9007199254740991
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,159}")
SHA = re.compile(r"[a-f0-9]{40}")
DIGEST = re.compile(r"[a-f0-9]{64}")
FIELDS = {"repository", "branch", "eventKey", "opId", "writer", "expectedHead",
          "expectedBase", "intendedHead", "payloadSha256", "expiresAt", "expectedFence"}


class FenceError(ValueError):
    pass


def fail(code):
    raise FenceError(code)


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def parse(raw):
    if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
        fail("INPUT_BOUND")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique,
                          parse_constant=lambda _: fail("INVALID_JSON"))
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        fail("INVALID_JSON")


def validate(binding):
    if type(binding) is not dict or set(binding) != FIELDS:
        fail("INVALID_BINDING")
    if binding["repository"] != "Achi1984/meridian":
        fail("INVALID_BINDING")
    for field in ("branch", "eventKey", "opId", "writer"):
        if type(binding[field]) is not str or not TOKEN.fullmatch(binding[field]):
            fail("INVALID_BINDING")
    for field in ("expectedHead", "expectedBase", "intendedHead"):
        if type(binding[field]) is not str or not SHA.fullmatch(binding[field]):
            fail("INVALID_BINDING")
    if binding["intendedHead"] == binding["expectedHead"]:
        fail("INVALID_BINDING")
    if type(binding["payloadSha256"]) is not str or not DIGEST.fullmatch(binding["payloadSha256"]):
        fail("INVALID_BINDING")
    for field in ("expiresAt", "expectedFence"):
        if type(binding[field]) is not int or not 0 <= binding[field] < MAX_INT:
            fail("INVALID_BINDING")
    now = int(time.time() * 1000)
    if not now < binding["expiresAt"] <= now + 300000:
        fail("EXPIRED")
    return json.dumps(binding, sort_keys=True, separators=(",", ":"))


def operate(database, command, value):
    """Consume events and transition an internal ledger, never authorize a write."""
    if type(database) is not str or not database or database == ":memory:" or "\0" in database:
        fail("INVALID_DATABASE")
    if command not in ("reserve", "begin", "settle") or type(value) is not dict:
        fail("INVALID_REQUEST")
    if command == "reserve":
        serialized = validate(value)
    else:
        fields = {"opId", "writer", "fence"}
        if command == "settle":
            fields |= {"outcome", "observedHead", "evidenceSha256"}
        if set(value) != fields:
            fail("INVALID_REQUEST")
        for field in ("opId", "writer"):
            if type(value[field]) is not str or not TOKEN.fullmatch(value[field]):
                fail("INVALID_REQUEST")
        if type(value["fence"]) is not int or not 1 <= value["fence"] <= MAX_INT:
            fail("INVALID_REQUEST")
        if command == "settle":
            if value["outcome"] not in ("APPLIED", "ABSENT", "UNKNOWN"):
                fail("INVALID_REQUEST")
            if type(value["observedHead"]) is not str or not SHA.fullmatch(value["observedHead"]):
                fail("INVALID_REQUEST")
            if type(value["evidenceSha256"]) is not str or not DIGEST.fullmatch(value["evidenceSha256"]):
                fail("INVALID_REQUEST")
    connection = None
    try:
        connection = sqlite3.connect(database, timeout=5, isolation_level=None)
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("CREATE TABLE IF NOT EXISTS scopes (scope TEXT PRIMARY KEY, fence INTEGER NOT NULL, active TEXT)")
        connection.execute("""CREATE TABLE IF NOT EXISTS operations (
            op TEXT PRIMARY KEY, event TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
            writer TEXT NOT NULL, fence INTEGER NOT NULL, binding TEXT NOT NULL,
            state TEXT NOT NULL, evidence TEXT)""")
        if command == "reserve":
            validate(value)  # Expiry is checked again after obtaining the write lock.
            scope = value["repository"] + ":" + value["branch"]
            event = value["repository"] + ":" + value["eventKey"]
            if connection.execute("SELECT 1 FROM operations WHERE op=? OR event=?", (value["opId"], event)).fetchone():
                fail("PERMANENTLY_CONSUMED")
            row = connection.execute("SELECT fence,active FROM scopes WHERE scope=?", (scope,)).fetchone()
            old_fence, active = row if row else (0, None)
            if old_fence != value["expectedFence"]:
                fail("STALE_FENCE")
            if active is not None:
                fail("SCOPE_BUSY")
            fence = old_fence + 1
            connection.execute("INSERT INTO operations VALUES (?,?,?,?,?,?,?,NULL)",
                               (value["opId"], event, scope, value["writer"], fence, serialized, "RESERVED"))
            connection.execute("INSERT INTO scopes VALUES (?,?,?) ON CONFLICT(scope) DO UPDATE SET fence=excluded.fence,active=excluded.active",
                               (scope, fence, value["opId"]))
            state = "RESERVED"
        else:
            row = connection.execute("SELECT scope,writer,fence,binding,state FROM operations WHERE op=?", (value["opId"],)).fetchone()
            if row is None:
                fail("UNKNOWN_OPERATION")
            scope, writer, fence, serialized, state = row
            current = connection.execute("SELECT fence,active FROM scopes WHERE scope=?", (scope,)).fetchone()
            if (writer != value["writer"] or fence != value["fence"] or current != (fence, value["opId"])):
                fail("STALE_WRITER_OR_FENCE")
            binding = json.loads(serialized)
            if command == "begin":
                if state != "RESERVED":
                    fail("ALREADY_STARTED_OR_TERMINAL")
                validate(binding)
                state = "STARTED"
                connection.execute("UPDATE operations SET state=? WHERE op=?", (state, value["opId"]))
            else:
                if state not in ("RESERVED", "STARTED"):
                    fail("TERMINAL_OPERATION")
                outcome = value["outcome"]
                # ABSENT only cancels a reservation that has never been started.
                # Once STARTED, an apparently unchanged ref cannot prove a write is not in flight.
                if outcome == "ABSENT" and (state != "RESERVED" or value["observedHead"] != binding["expectedHead"]):
                    fail("UNSAFE_ABSENCE")
                if outcome == "APPLIED" and (state != "STARTED" or value["observedHead"] != binding["intendedHead"]):
                    fail("UNSAFE_APPLIED")
                state = outcome
                connection.execute("UPDATE operations SET state=?,evidence=? WHERE op=?",
                                   (state, json.dumps(value, sort_keys=True), value["opId"]))
                if state != "UNKNOWN":
                    connection.execute("UPDATE scopes SET active=NULL WHERE scope=?", (scope,))
        connection.commit()
    except sqlite3.Error:
        fail("LEDGER_ERROR")
    finally:
        if connection is not None:
            if connection.in_transaction:
                connection.rollback()
            connection.close()
    return {"opId": value["opId"], "fence": fence, "state": state,
            "bindingSha256": hashlib.sha256(serialized.encode("ascii")).hexdigest(),
            "authenticated": False, "mayWrite": False, "mayDispatch": False, "mayMerge": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("command", choices=("reserve", "begin", "settle"))
    args = parser.parse_args()
    try:
        receipt = operate(args.db, args.command, parse(sys.stdin.buffer.read(MAX_BYTES + 1)))
    except FenceError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2
    print(json.dumps(receipt, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
