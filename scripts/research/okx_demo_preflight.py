"""Check the EEA demo account and BTC X-Perp using authenticated GET requests."""
import base64
import hashlib
import hmac
import json
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from http.client import HTTPSConnection
from urllib.parse import urlencode

HOST = "eea.okx.com"
INSTRUMENT = "BTC-USD_UM_XPERP-310328"
NAMES = ("OKX_DEMO_API_KEY", "OKX_DEMO_SECRET_KEY", "OKX_DEMO_PASSPHRASE")


class PreflightError(Exception):
    pass


def get(path, credentials, **query):
    target = path + ("?" + urlencode(query) if query else "")
    key, secret, passphrase = credentials
    stamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    digest = hmac.new(secret.encode(), (stamp + "GET" + target).encode(), hashlib.sha256)
    headers = {"x-simulated-trading": "1", "OK-ACCESS-KEY": key, "OK-ACCESS-TIMESTAMP": stamp,
               "OK-ACCESS-SIGN": base64.b64encode(digest.digest()).decode(), "OK-ACCESS-PASSPHRASE": passphrase}
    connection = HTTPSConnection(HOST, timeout=12)
    try:
        connection.request("GET", target, headers=headers)
        response = connection.getresponse()
        if response.status != 200:
            raise PreflightError("HTTP " + str(response.status))
        payload = json.load(response)
        if payload["code"] != "0" or not isinstance(payload["data"], list):
            raise PreflightError("API request rejected")
        return payload["data"]
    finally:
        connection.close()


def report_btc_contracts(credentials):
    fields = ("instId", "instType", "state", "ctType", "settleCcy", "expTime",
              "ctVal", "ctValCcy", "minSz", "lotSz")
    for kind in ("FUTURES", "SWAP"):
        rows = get("/api/v5/account/instruments", credentials, instType=kind)
        contracts = [row for row in rows if row["instId"].startswith("BTC-")]
        print(f"BTC inventory {kind}: {len(contracts)}")
        for row in sorted(contracts, key=lambda item: item["instId"]):
            print("BTC contract " + json.dumps({field: row.get(field) for field in fields}))


def check(credentials):
    configs = get("/api/v5/account/config", credentials)
    if len(configs) != 1:
        raise PreflightError("account config unavailable")
    permissions = set(configs[0]["perm"].split(","))
    if "trade" not in permissions or "withdraw" in permissions:
        raise PreflightError("demo key requires trade permission and withdrawal disabled")
    if configs[0]["posMode"] != "net_mode":
        raise PreflightError("rehearsal expects net position mode")
    instruments = get("/api/v5/account/instruments", credentials, instType="FUTURES", instId=INSTRUMENT)
    expected = {"instId": INSTRUMENT, "instType": "FUTURES", "state": "live",
                "ctType": "linear", "settleCcy": "USDC", "ctValCcy": "BTC"}
    if len(instruments) != 1 or not all(instruments[0].get(k) == v for k, v in expected.items()):
        report_btc_contracts(credentials)
        raise PreflightError("BTC USDC X-Perp unavailable or contract specifications changed")
    contract = instruments[0]
    if (Decimal(contract["ctVal"]), Decimal(contract["minSz"]), Decimal(contract["lotSz"])) != (
            Decimal("1"), Decimal("0.0001"), Decimal("0.0001")):
        raise PreflightError("BTC X-Perp size specifications changed")
    balances = get("/api/v5/account/balance", credentials, ccy="USDC")
    if len(balances) != 1:
        raise PreflightError("demo balance response unavailable")
    usdc = [row for row in balances[0]["details"] if row["ccy"] == "USDC"]
    if len(usdc) > 1:
        raise PreflightError("ambiguous USDC demo balance")
    available = Decimal(usdc[0]["availBal"]) if usdc else Decimal(0)
    if not available.is_finite():
        raise PreflightError("invalid available demo balance")
    positions = get("/api/v5/account/positions", credentials, instId=INSTRUMENT)
    open_positions = sum(Decimal(row["pos"]) != 0 for row in positions)
    orders = get("/api/v5/trade/orders-pending", credentials, instId=INSTRUMENT)
    print(f"Demo {INSTRUMENT}: available USDC={available}, open positions={open_positions}, "
          f"pending standard orders (returned)={len(orders)}. Orders sent: 0.")
    if available <= 0 or open_positions or orders:
        raise PreflightError("requires positive available USDC and clear initial exposure")


if __name__ == "__main__":
    credentials = tuple(os.environ.get(name, "") for name in NAMES)
    if not all(credentials):
        sys.exit("Demo configuration missing: " + ", ".join(n for n, value in zip(NAMES, credentials) if not value))
    try:
        check(credentials)
    except PreflightError as error:
        sys.exit("Demo preflight stopped: " + str(error))
    except (InvalidOperation, ValueError, OSError, KeyError, ArithmeticError, TypeError):
        sys.exit("Demo preflight stopped: network or response format error")
