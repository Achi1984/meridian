"""Check the EEA demo account and BTC swap using authenticated GET requests."""
import base64
import hashlib
import hmac
import json
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from http.client import HTTPSConnection
from urllib.parse import urlencode

HOST = "eea.okx.com"
INSTRUMENT = "BTC-USDT-SWAP"
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


def check(credentials):
    configs = get("/api/v5/account/config", credentials)
    if len(configs) != 1:
        raise PreflightError("account config unavailable")
    permissions = set(configs[0]["perm"].split(","))
    if "trade" not in permissions or "withdraw" in permissions:
        raise PreflightError("demo key requires trade permission and withdrawal disabled")
    if configs[0]["posMode"] != "net_mode":
        raise PreflightError("rehearsal expects net position mode")
    instruments = get("/api/v5/account/instruments", credentials, instType="SWAP", instId=INSTRUMENT)
    if not any(row["instId"] == INSTRUMENT and row["state"] == "live" and row["ctType"] == "linear"
               and row["settleCcy"] == "USDT" for row in instruments):
        raise PreflightError("BTC USDT swap unavailable in account")
    positions = get("/api/v5/account/positions", credentials, instId=INSTRUMENT)
    if any(Decimal(p["pos"]) != 0 for p in positions):
        raise PreflightError("existing BTC swap exposure")
    if get("/api/v5/trade/orders-pending", credentials, instId=INSTRUMENT):
        raise PreflightError("existing BTC swap order")
    print("Demo authentication, target instrument and initial position checked. Orders sent: 0.")


if __name__ == "__main__":
    credentials = tuple(os.environ.get(name, "") for name in NAMES)
    if not all(credentials):
        sys.exit("Demo configuration missing: " + ", ".join(n for n, value in zip(NAMES, credentials) if not value))
    try:
        check(credentials)
    except PreflightError as error:
        sys.exit("Demo preflight stopped: " + str(error))
    except (ValueError, OSError, KeyError, ArithmeticError, TypeError):
        sys.exit("Demo preflight stopped: network or response format error")
