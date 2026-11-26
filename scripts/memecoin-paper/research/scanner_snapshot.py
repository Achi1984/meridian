"""Export one completed read-only scanner observation for the dashboard."""
import json
from datetime import datetime
from math import isfinite
from pathlib import Path
from statistics import median
import time

from new_pool_watch import get
from newcomer_research import ERRORS

from newcomer_scanner import market_reader, scan


def daily_context(fetch=get, clock=time.time):
    base = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd'
    result = {'source': 'CoinGecko', 'windowHours': 24}
    for name, query in [('btc', 'ids=bitcoin'),
                        ('meme', 'category=meme-token&order=market_cap_desc&per_page=100&page=1')]:
        try:
            rows = fetch(base+'&'+query, 180)
            received = int(clock())
            if not isinstance(rows, list):
                raise ValueError('invalid market list')
            changes = {}
            for row in rows:
                coin = row['id']
                if name == 'btc' and coin != 'bitcoin':
                    continue
                stamp = datetime.fromisoformat(row['last_updated'].replace('Z', '+00:00'))
                change = row.get('price_change_percentage_24h')
                if (stamp.tzinfo and 0 <= received-stamp.timestamp() <= 300
                        and type(change) in (int, float) and isfinite(change)):
                    changes[coin] = change
            minimum = 1 if name == 'btc' else 50
            result[name] = dict(medianChangePct=median(changes.values()) if len(changes) >= minimum else None,
                                count=len(changes), receivedAt=received)
        except ERRORS as exc:
            result[name] = dict(medianChangePct=None, count=0, error=type(exc).__name__)
    return result


def add_peer_comparison(candidates, cutoff):
    # Compare full candles on identical boundaries, excluding the candidate itself.
    for minutes in (5, 30, 60):
        returns = {}
        for row in candidates:
            window = row['windows'].get(minutes, {})
            change = window.get('changePct')
            if (row['earliest30mAt'] is not None and row['earliest30mAt']-1800 <= cutoff-minutes*60
                    and window.get('observedMinutes') == minutes and type(change) in (int, float)
                    and isfinite(change)):
                returns[row['mint']] = change
        for row in candidates:
            peers = [change for mint, change in returns.items() if mint != row['mint']]
            benchmark = median(peers) if len(peers) >= 3 else None
            change = returns.get(row['mint'])
            row.setdefault('solanaNewcomerPeers', {})[minutes] = dict(
                count=len(peers), medianChangePct=benchmark,
                excessPp=change-benchmark if change is not None and benchmark is not None else None)


def snapshot(collect=scan, read_context=daily_context):
    context = read_context()
    candidates = []
    summary = {}
    warnings = []
    def record(kind, **fields):
        if kind == 'scannerCandidate':
            row = fields.pop('row')
            candidates.append(dict(mint=row['mint'], symbol=row.get('symbol'),
                                   **{key: fields.get(key) for key in
                                      ('asOf','windows','ranks','reasons','netResaleUsdc','earliest30mAt')}))
        elif kind == 'scannerSourceUnavailable':
            warnings.append(fields['source'])
        elif kind == 'scannerSummary':
            summary.update(fields)
    collect(record, fetch=market_reader(interval=13), ranked_windows_only=True)
    if (summary.get('sampled') != len(candidates) or not summary.get('asOf')
            or any(r['asOf'] != summary['asOf'] for r in candidates)):
        raise ValueError('Incomplete scanner observation')
    add_peer_comparison(candidates, summary['asOf'])
    return dict(schema=1, **summary, observedAt=int(time.time()), dailyMarketContext=context,
                warnings=warnings, candidates=candidates)


if __name__ == '__main__':
    Path('scanner-live.json').write_text(json.dumps(snapshot(), allow_nan=False)+'\n')
