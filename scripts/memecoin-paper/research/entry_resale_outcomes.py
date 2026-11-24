"""Pair the first full-size resale quote with C/F paper outcomes in an archived journal."""
import argparse
import json
from pathlib import Path

from newcomer_eight_hour import Account, SIZE, FEE, UNIT


def evaluate(events):
    accounts = {'C': Account('fixed'), 'F': Account('smallPoolFixed')}
    liquidity, trades = {}, {}
    previous = None
    for row in events:
        key = row['session'], row.get('mint')
        kind = row['event']
        if kind == 'cohortSelection':
            liquidity[key] = row['entryLiquidityUsd']
        if row.get('arm') == 'wave':
            for arm, account in accounts.items():
                if arm == 'F' and not 0 < liquidity.get(key, 0) < 20_000:
                    continue
                identity = (*key, arm)
                held = key in account.open
                account.update(row, key[0])
                if not held and key in account.open:
                    trades[identity] = dict(session=key[0], mint=key[1], arm=arm, qty=row['qty'],
                        liquidityUsd=liquidity.get(key), initialNetResaleUsdc=None, realizedUsdc=None)
                if not held:
                    continue
                trade = trades[identity]
                if (kind == 'resaleMark' and previous and previous['event'] == 'entry'
                        and previous.get('arm') == 'wave' and previous['session'] == key[0]
                        and previous['mint'] == key[1] and previous['qty'] == row['qty']):
                    trade['initialNetResaleUsdc'] = (row['usdcRaw'] - 2*FEE)/UNIT
                if key not in account.open:
                    trade['realizedUsdc'] = (row['usdcRaw'] - SIZE - 2*FEE)/UNIT
        previous = row
    return list(trades.values())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('journal', type=Path)
    args = parser.parse_args()
    with args.journal.open() as journal:
        print(json.dumps(evaluate(map(json.loads, journal)), allow_nan=False))
