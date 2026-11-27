"""Compare F's recorded entries with a trailing exit on the same full-size quotes."""
import argparse
import json
from pathlib import Path

from meme_paper_account import FEE, SIZE, START, UNIT


def score(directory):
    status = json.loads((directory / 'status.json').read_text())
    if status.get('ledgerVerified') is not True or status['lastEvent'] != 'finished':
        raise ValueError('Expected a completed, reconciled journal')
    reference = status['accounts']['F']
    if reference['policy'] != 'smallPoolFixed':
        raise ValueError('Unexpected reference strategy')
    open_positions = {}
    fixed_positions = {}
    seen = {}
    cash = START
    skipped = []
    fixed_results = {}
    trailing_results = {}
    trades = []
    bought = set()
    last = None
    for line in (directory / 'events.jsonl').read_text().splitlines():
        row = json.loads(line)
        event_id = row['eventId']
        if event_id in seen:
            if seen[event_id] != row:
                raise ValueError('Conflicting event ID')
            continue
        if not seen and (row['event'] != 'start' or row['at'] != status['startedAt']):
            raise ValueError('Missing start')
        seen[event_id] = last = row
        for fill in row['fills']:
            if fill['account'] != 'F':
                continue
            key = fill['positionId']
            qty = fill['qty']
            if (row.get('arm') != 'wave' or row.get('positionId') != key or qty != row['qty']
                    or key != f"{row['session']}:wave:{row['mint']}" or type(qty) is not int or qty <= 0):
                raise ValueError('Inconsistent F fill')
            if fill['side'] == 'buy':
                if row['event'] != 'entry' or fill['usdcRaw'] != SIZE or key in bought:
                    raise ValueError('Invalid F entry')
                bought.add(key)
                fixed_positions[key] = qty
                if cash >= SIZE + FEE:
                    cash -= SIZE + FEE
                    open_positions[key] = dict(qty=qty, peak=0, marks=0)
                else:
                    skipped.append(key)
            elif fill['side'] == 'sell' and fixed_positions.pop(key) == qty:
                if row['event'] not in ('resaleMark', 'exit') or row['usdcRaw'] != fill['usdcRaw']:
                    raise ValueError('Invalid F exit')
                fixed_results[key] = fill['usdcRaw'] - SIZE - 2 * FEE
            else:
                raise ValueError('Unknown F fill')

        key = row.get('positionId')
        position = open_positions.get(key)
        if not position or row.get('arm') != 'wave' or row['event'] not in ('resaleMark', 'exit'):
            continue
        bid = row['usdcRaw']
        if type(bid) is not int or bid <= 0 or row['qty'] != position['qty']:
            raise ValueError('Invalid full-size exit quote')
        net = bid - SIZE - 2 * FEE
        # As in A, the initial resale check cannot arm the trail.
        trail = position['peak'] * 10 >= SIZE and 2 * net <= position['peak']
        if trail or row['event'] == 'exit':
            cash += bid - FEE
            trailing_results[key] = net
            trades.append(dict(positionId=key, at=row['at'], netUsdc=net / UNIT,
                               reason='trailing' if trail else 'timed'))
            del open_positions[key]
        else:
            if position['marks']:
                position['peak'] = max(position['peak'], net)
            position['marks'] += 1

    fixed_net = sum(fixed_results.values())
    fixed_closed = len(fixed_results)
    if (not last or last['event'] != 'finished' or last['at'] != status['updatedAt']
            or fixed_closed != reference['closedTrades'] or fixed_net / UNIT != reference['realizedUsdc']
            or fixed_positions != {p['positionId']: p['qty'] for p in reference['openPositions']}):
        raise ValueError('Journal does not reconcile with final F account')
    realized = cash - START + len(open_positions) * (SIZE + FEE)
    paired = fixed_results.keys() & trailing_results.keys()
    fixed_paired = sum(fixed_results[key] for key in paired)
    trailing_paired = sum(trailing_results[key] for key in paired)
    skipped_closed = [key for key in skipped if key in fixed_results]
    comparison = dict(
        sharedEntries=len(bought) - len(skipped),
        bothClosed=len(paired),
        sharedStillOpenOnEitherSide=len(bought) - len(skipped) - len(paired),
        pairedFixedNetUsdc=fixed_paired / UNIT,
        pairedTrailingNetUsdc=trailing_paired / UNIT,
        pairedTrailingMinusFixedUsdc=(trailing_paired - fixed_paired) / UNIT,
        skippedFixedClosed=len(skipped_closed),
        skippedFixedStillOpen=len(skipped) - len(skipped_closed),
        skippedFixedRealizedUsdc=sum(fixed_results[key] for key in skipped_closed) / UNIT,
    )
    return dict(comparison=comparison, startedAt=status['startedAt'], endedAt=status['updatedAt'], initialUsdc=START / UNIT,
                fixed=dict(realizedUsdc=fixed_net / UNIT, closed=fixed_closed, open=len(fixed_positions)),
                trailing=dict(realizedUsdc=realized / UNIT, cashUsdc=cash / UNIT, closed=len(trades),
                              open=list(open_positions), skippedForCash=len(skipped), trades=trades))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    print(json.dumps(score(parser.parse_args().directory), indent=2))
