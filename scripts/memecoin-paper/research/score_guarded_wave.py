"""Score frozen challenger G on original wave quotes, using integer micro-USDC."""
import json
import sys
from pathlib import Path

def score(rows, allow_entry=None, trail_exit=None):
    cash, realized = 1_000_000_000, 0
    pending, positions, fills, seen = {}, {}, [], {}
    for row in rows:
        eid = row.get('eventId')
        if eid and eid in seen:
            if seen[eid] != row:
                raise ValueError('conflicting event ID')
            continue
        if eid:
            seen[eid] = row
        if row.get('arm') != 'wave' or 'mint' not in row:
            continue
        key = (row['session'], row['mint'])
        event = row['event']
        if event == 'entry':
            assert row['usdc'] == 20
            pending[key] = row
            continue
        if event not in ('resaleMark', 'exit'):
            continue
        bid = row['usdcRaw']
        if key in pending:
            entry = pending.pop(key)
            if (event == 'resaleMark' and entry['qty'] == row['qty']
                and 0 <= row['at'] - entry['at'] <= 1 and bid >= 19_300_000 and cash >= 20_050_000
                and (allow_entry is None or allow_entry(key, row))):
                cash -= 20_050_000
                positions[key] = dict(qty=row['qty'], peak=0, at=entry['at'])
            continue
        if key not in positions:
            continue
        p = positions[key]
        assert p['qty'] == row['qty']
        net = bid - 20_100_000
        p['peak'] = max(net, p['peak'])
        trail = p['peak'] >= 2_000_000 and 2*net <= p['peak']
        if trail_exit is not None:
            trail = trail_exit(key, row, trail)
        if net <= -2_000_000 or trail or event == 'exit':
            cash += bid - 50_000
            realized += net
            fills.append(dict(session=key[0], mint=key[1], entryAt=p['at'], exitAt=row['at'], qty=p['qty'], netRaw=net))
            del positions[key]
    assert cash == 1_000_000_000 + realized - 20_050_000 * len(positions)
    return dict(realizedUsdc=realized/1e6, cashIfOpenWorthZeroUsdc=cash/1e6,
                openPositions=[dict(session=k[0],mint=k[1],**v) for k,v in positions.items()], fills=fills)

if __name__ == '__main__':
    path = Path(sys.argv[1])
    rows = [json.loads(s) for s in (path/'events.jsonl').read_text().splitlines()]
    status = json.loads((path/'status.json').read_text())
    assert status['lastEvent'] == rows[-1]['event'] == 'finished'
    assert rows[-1]['at'] == status['updatedAt'] >= status['endsAt']
    assert status['endsAt'] - status['startedAt'] == 28800
    print(json.dumps(dict(runId=int(sys.argv[2]), updatedAt=status['updatedAt'], G=score(rows))))
