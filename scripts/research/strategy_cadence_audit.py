"""Read-only comparison of expected UTC slots, Actions starts and published data."""
import argparse
import base64
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
API = "https://api.github.com/repos/Achi1984/meridian"
REPORTS = {
    "btc-grid-paper": "btc-grid-paper",
    "btc-compound-paper": "btc-compound-paper",
    "okx-fib-demo": "fib-demo",
    "okx-short-filter": "okx-filter-demo",
    "okx-rejection-paper": "okx-rejection-paper",
}


def read(path, **params):
    url = API + path + "?" + urlencode(params)
    req = Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "meridian-audit"})
    with urlopen(req, timeout=20) as response:
        return json.load(response)


def iso(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def at(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def numbers(field, limit):
    if field == "*":
        return set(range(limit))
    if field.startswith("*/"):
        return set(range(0, limit, int(field[2:])))
    values = {int(n) for n in field.split(",")}
    if not all(0 <= n < limit for n in values):
        raise ValueError("invalid schedule range")
    return values


def expected(name, start, end):
    source = (ROOT / ".github/workflows" / (name + ".yml")).read_text()
    expr, = re.findall(r"""^\s*-\s+cron:\s*['"]([^'"]+)['"]""", source, re.M)
    minute, hour, day, month, weekday = expr.split()
    if (day, month, weekday) != ("*", "*", "*"):
        raise ValueError("unsupported calendar schedule")
    minutes, hours = numbers(minute, 60), numbers(hour, 24)
    value = start.replace(second=0, microsecond=0)
    while value < end:
        if value >= start and value.hour in hours and value.minute in minutes:
            yield value
        value += timedelta(minutes=1)


def classify(slots, runs):
    # GitHub does not expose the intended cron tick. Group by creation window.
    rows = [{"slot": iso(slot), "runs": []} for slot in slots]
    others = {}
    for run in runs:
        event = run["event"]
        if event != "schedule":
            others[event] = others.get(event, 0) + 1
            continue
        created = at(run["created_at"])
        idx = next((i for i in range(len(slots)-1, -1, -1) if slots[i] <= created), None)
        if idx is None:
            continue
        started = run.get("run_started_at")
        rows[idx]["runs"].append({"id": run["id"], "start": started,
                                  "minutesAfterSlot": round((at(started)-slots[idx]).total_seconds()/60, 1) if started else None,
                                  "status": run["conclusion"] or run["status"]})
    return {"expected": len(rows), "withSuccessfulSchedule": sum(any(r["status"]=="success" for r in slot["runs"]) for slot in rows),
            "withoutSchedule": sum(not slot["runs"] for slot in rows), "otherEvents": others, "slots": rows}


def inspect(name, start, end):
    path = "/actions/workflows/" + name + ".yml/runs"
    runs = []
    page = 1
    while True:
        batch = read(path, branch="main", created=iso(start)+".."+iso(end), per_page=100, page=page)["workflow_runs"]
        runs.extend(r for r in batch if start <= at(r["created_at"]) < end)
        if len(batch) < 100:
            break
        page += 1
    summary = classify(list(expected(name, start, end)), runs)
    blob = read("/contents/" + REPORTS[name] + ".json", ref="paper-dashboard-data")
    data = json.loads(base64.b64decode(blob["content"]))
    summary["latestReport"] = {"asOf": data["asOf"], "blob": blob["sha"]}
    if name == "okx-fib-demo":
        summary["latestReport"]["frames"] = {k: {f:v.get(f) for f in ("bar","signal","decision")} for k,v in data["frames"].items()}
    elif name == "btc-compound-paper":
        summary["latestReport"]["nextBar"] = data["cursor"]
        summary["latestReport"]["decisions"] = {k:v.get("decision") for k,v in data["bots"].items()}
    elif name == "btc-grid-paper":
        summary["latestReport"]["evaluatedBars"] = data["bars"]
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--end", help="UTC window end, e.g. 2026-11-29T19:30:00Z")
    args = parser.parse_args()
    end = at(args.end) if args.end else datetime.now(timezone.utc).replace(second=0,microsecond=0)
    if end.utcoffset() != timedelta(0):
        parser.error("end must include UTC offset zero")
    start = end - timedelta(days=1)
    results = {}
    for name in REPORTS:
        try:
            results[name] = inspect(name, start, end)
        except (OSError, ValueError, KeyError) as exc:
            results[name] = {"error": str(exc)}
    print(json.dumps({"start":iso(start),"end":iso(end),"workflows":results},indent=2))
    raise SystemExit(int(any("error" in result for result in results.values())))
