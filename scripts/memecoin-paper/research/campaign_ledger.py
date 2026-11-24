"""Independent cash and inventory reconciliation from recorded paper fills."""
from collections import Counter
from decimal import Decimal
import json


def reconcile(records, accounts, start, fee):
    cash = Counter({name: start for name in accounts})
    positions = {}
    realized = Counter()
    closed = Counter()
    for fill in records:
        name = fill['account']
        key = name, fill['positionId']
        qty, raw = fill['qty'], fill['usdcRaw']
        if name not in accounts or type(qty) is not int or qty <= 0 or type(raw) is not int or raw <= 0:
            raise ValueError(f'Invalid fill {key}')
        if fill['side'] == 'buy':
            if key in positions:
                raise ValueError(f'Duplicate buy {key}')
            positions[key] = qty, raw+fee
            cash[name] -= raw+fee
        elif fill['side'] == 'sell':
            remaining, cost = positions[key]
            if qty > remaining:
                raise ValueError(f'Oversale {key}')
            basis = cost*qty//remaining
            positions[key] = remaining-qty, cost-basis
            cash[name] += raw-fee
            realized[name] += raw-fee-basis
            if qty == remaining:
                closed[name] += 1
        else:
            raise ValueError(f'Invalid fill side {key}')
    for name, account in accounts.items():
        inventory = {pid: qty for (owner,pid),(qty,_) in positions.items() if owner == name and qty}
        expected = {p['positionId']:p['qty'] for p in account['openPositions']}
        if (inventory != expected or len(expected) != len(account['openPositions']) or
            cash[name] != Decimal(str(account['cashUsdc']))*1000000 or
            realized[name] != Decimal(str(account['realizedUsdc']))*1000000 or
            closed[name] != account['closedTrades']):
            raise ValueError(f'Journal mismatch for account {name}')

def verify_journal(path, accounts, start, fee):
    seen = {}
    fills = []
    with path.open() as stream:
        for line in stream:
            row = json.loads(line)
            identifier = row.get('eventId')
            if identifier is None:
                raise ValueError('Missing event identifier')
            if identifier in seen:
                if seen[identifier] != row:
                    raise ValueError(f'Conflicting journal event {identifier}')
                continue
            seen[identifier] = row
            fills.extend(row['fills'])
    reconcile(fills, accounts, start, fee)
