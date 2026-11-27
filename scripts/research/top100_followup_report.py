"""Value all three independent accounts at one completed UTC minute."""
import json
import os
import sys
import time
from pathlib import Path
from top100_paper import D, FEE, HOUR, ok, settle


def report(state, stage, clock):
    cutoff = min(clock, state['start'] + 8 * HOUR) // 60 * 60
    marks = {}
    accounts = {}
    for name, account in state['accounts'].items():
        realized = D(0)
        unrealized = D(0)
        fees = D(0)
        funding = D(0)
        missing_marks = pending_funding = 0
        for trade in account['closed'] + list(account['open'].values()):
            inst = trade['instrument']
            entry = trade['entry']
            qty = D(entry['qty'])
            entry_price = D(entry['price'])
            fees += qty * entry_price * FEE
            exit = trade.get('exit')
            if exit:
                exit_price = D(exit['price'])
                realized += trade['side'] * qty * (exit_price - entry_price)
                fees += qty * exit_price * FEE
            else:
                if inst not in marks:
                    try:
                        candles = ok('market/history-mark-price-candles', instId=inst,
                                     bar='1m', after=cutoff * 1000, limit=3)
                        price = next(D(c[4]) for c in candles if
                                     int(c[0]) == (cutoff - 60) * 1000 and c[-1] == '1')
                        marks[inst] = price if price.is_finite() and price > 0 else None
                    except (OSError, ValueError, IndexError, KeyError, ArithmeticError, StopIteration):
                        marks[inst] = None
                if marks[inst] is None or entry['ts'] > cutoff * 1000:
                    missing_marks += 1
                else:
                    unrealized += trade['side'] * qty * (marks[inst] - entry_price)
            try:
                funding += (D(trade['funding']) if trade.get('funding') is not None else
                            settle(trade if exit else dict(trade, exit={'ts':cutoff * 1000})))
            except (OSError, KeyError, ValueError, ArithmeticError, StopIteration, IndexError):
                pending_funding += 1
        equity = realized + unrealized - fees + funding + 1000
        accounts[name] = dict(closed=len(account['closed']), open=len(account['open']),
                              realizedGross=float(realized), openGross=None if missing_marks else float(unrealized),
                              fees=float(fees), funding=None if pending_funding else float(funding),
                              equity=None if missing_marks or pending_funding else float(equity))
    return dict(runId=int(os.environ['GITHUB_RUN_ID']), stage=stage, start=state['start'],
                asOf=cutoff, universeAt=next(iter(state['universes'].values()))['at'],
                accounts=accounts, observations=len(state['observations']))


if __name__ == '__main__':
    state = json.loads(Path(sys.argv[1]).read_text())
    print(json.dumps(report(state, sys.argv[2], int(time.time())), allow_nan=False))
