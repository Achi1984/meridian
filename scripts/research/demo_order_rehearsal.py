"""Offline recovery rehearsal for a single BTC demo entry, using OKX order snapshots."""
import json
import sqlite3
from contextlib import closing
from decimal import Decimal
from pathlib import Path


class EntryRehearsal:
    """One entry per database. Persist intent before simulating a venue submission."""

    def __init__(self, db):
        self.db = db
        db.execute("""CREATE TABLE IF NOT EXISTS entry (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            client_id TEXT NOT NULL, requested TEXT NOT NULL,
            status TEXT NOT NULL, filled TEXT NOT NULL, stopped INTEGER NOT NULL,
            venue_id TEXT)""")

    def reserve(self, client_id, requested):
        size = Decimal(requested)
        if not (client_id.isascii() and client_id.isalnum() and len(client_id) <= 32
                and size.is_finite() and size > 0):
            raise ValueError("invalid entry intent")
        with self.db:
            cursor = self.db.execute("INSERT OR IGNORE INTO entry VALUES (1, ?, ?, 'unknown', '0', 0, NULL)",
                                     (client_id, str(size)))
            if not cursor.rowcount:
                saved_id, saved_size = self.db.execute("SELECT client_id, requested FROM entry").fetchone()
                if client_id != saved_id or size != Decimal(saved_size):
                    raise ValueError("another intent already occupies this rehearsal")
            return cursor.rowcount == 1

    def record_rejection(self, client_id, item_code):
        """Use only a definitive, matched item-level business rejection."""
        # Explicit demo case: insufficient balance. Other outcomes need a lookup.
        if item_code != "51008":
            raise ValueError("ambiguous response requires lookup")
        with self.db:
            cursor = self.db.execute(
                "UPDATE entry SET status='rejected' WHERE client_id=? AND status IN ('unknown', 'rejected')",
                (client_id,))
            if not cursor.rowcount:
                raise ValueError("rejection does not match an unresolved entry")

    def stop(self):
        with self.db:
            cursor = self.db.execute("UPDATE entry SET stopped = 1")
            if not cursor.rowcount:
                raise ValueError("reserve the rehearsal entry first")

    def observe(self, reply):
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            row = self.db.execute("SELECT client_id, requested, status, filled, venue_id FROM entry").fetchone()
            if row is None:
                raise ValueError("unknown intent")
            client_id, requested, previous, old_fill, venue_id = row
            if (reply["clOrdId"] != client_id or reply["instId"] != "BTC-USDT-SWAP"
                    or reply["side"] != "buy" or not reply["ordId"]
                    or venue_id not in (None, reply["ordId"]) or Decimal(reply["sz"]) != Decimal(requested)):
                raise ValueError("unmatched order")
            filled, size = Decimal(reply["accFillSz"]), Decimal(requested)
            status = reply["state"]
            if not filled.is_finite() or not Decimal(old_fill) <= filled <= size:
                raise ValueError("invalid cumulative fill")
            valid = ((status == "live" and filled == 0)
                     or (status == "partially_filled" and 0 < filled < size)
                     or (status == "filled" and filled == size)
                     or (status == "canceled" and filled < size))
            if previous == "rejected" or not valid or (previous in ("filled", "canceled")
                             and (status != previous or filled != Decimal(old_fill))):
                raise ValueError("inconsistent order state")
            self.db.execute("UPDATE entry SET status=?, filled=?, venue_id=?",
                            (status, str(filled), reply["ordId"]))

    def reconcile(self, position, open_orders):
        """Check one isolated, initially flat demo account in net position mode."""
        state = self.report()
        if (position["instId"] != "BTC-USDT-SWAP" or position["posSide"] != "net"
                or state["status"] not in ("filled", "canceled", "rejected") or open_orders != []
                or Decimal(position["pos"]) != Decimal(state["filledContracts"])):
            raise ValueError("account reconciliation pending")
        return dict(matched=True, remainingContracts=position["pos"],
                    flat=Decimal(position["pos"]) == 0)

    def report(self):
        client_id, status, filled, stopped = self.db.execute(
            "SELECT client_id, status, filled, stopped FROM entry").fetchone()
        return dict(clientId=client_id, status=status, filledContracts=filled,
                    stopped=bool(stopped), cancelRequired=bool(stopped and status in ("live", "partially_filled")),
                    lookupRequired=status == "unknown", reconcilePosition=Decimal(filled) > 0)


def replay(directory):
    path = directory / "entry.sqlite"
    base = dict(clOrdId="MeridianDemo1", ordId="1234", instId="BTC-USDT-SWAP", side="buy", sz="0.16")
    with closing(sqlite3.connect(path)) as db:
        entry = EntryRehearsal(db)
        if not entry.reserve(base["clOrdId"], base["sz"]):
            raise ValueError("use a fresh rehearsal directory")
        # Simulated venue acceptance followed by lost response and process exit.
    with closing(sqlite3.connect(path)) as db:
        entry = EntryRehearsal(db)
        if entry.reserve(base["clOrdId"], base["sz"]):
            raise RuntimeError("duplicate submission after restart")
        recovery = entry.report()
        partial = dict(base, state="partially_filled", accFillSz="0.06")
        entry.observe(partial)
        entry.observe(partial)
        entry.stop()
        stop = entry.report()
        # One more fill races the simulated cancellation.
        entry.observe(dict(base, state="canceled", accFillSz="0.08"))
        position = dict(instId="BTC-USDT-SWAP", posSide="net", pos="0.08")
        return dict(mode="offline", ordersSent=0, recovery=recovery, stop=stop,
                    final=entry.report(), account=entry.reconcile(position, []))


if __name__ == "__main__":
    import tempfile
    with tempfile.TemporaryDirectory() as folder:
        print(json.dumps(replay(Path(folder)), indent=2))
