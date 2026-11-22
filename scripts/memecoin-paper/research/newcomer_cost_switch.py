"""Evaluate the preregistered 97% immediate-or-recovery rule on completed paired logs."""
import argparse
import json
from decimal import Decimal
from pathlib import Path

from meme_paper_account import FEE, SIZE, UNIT
from wave_band_report import ARMS, report


def evaluate(rows):
    report([rows])
    cohort = next(row for row in rows if row['event'] == 'cohort')
    if cohort.get('holdingPolicy') != 'tenMinutesFromEntry':
        raise ValueError('Expected entry-relative holding windows')
    result = []
    for mint in cohort['mints']:
        events = [row for row in rows if row.get('mint') == mint]
        selection = next(row for row in events if row['event'] == 'cohortSelection')
        paths = {}
        entry_mark = None
        for arm in ARMS:
            events_arm = [row for row in events if row.get('arm') == arm]
            entry = next((row for row in events_arm if row['event'] == 'entry'), None)
            sale = next((row for row in events_arm if row['event'] == 'exit'), None)
            marks = [row for row in events_arm if row['event'] == 'resaleMark']
            if entry and (Decimal(str(entry['usdc'])) * UNIT != SIZE or
                          any(row['qty'] != entry['qty'] for row in marks)):
                raise ValueError('Position size or marked quantity mismatch')
            if arm == 'early':
                entry_mark = next((row['usdcRaw'] for row in marks if row['tick'] == 0), None)
            gap = any(row['event'] == 'observationUnavailable' for row in events)
            state = ('closed' if sale else 'unresolved' if entry else
                     'noEntryWithGap' if gap else 'noEntry')
            peak = drawdown = 0
            for row in marks:
                net = row['usdcRaw'] - SIZE - 2 * FEE
                peak = max(peak, net)
                drawdown = max(drawdown, peak - net)
            net_usdc = 0 if state == 'noEntry' else None
            if sale:
                net_usdc = sale['netUsdc']
            stress_usdc = -(SIZE + FEE) / UNIT if state == 'unresolved' else net_usdc
            paths[arm] = dict(state=state, netUsdc=net_usdc, zeroRecoveryNetUsdc=stress_usdc,
                              sampledDrawdownUsdc=drawdown / UNIT if marks or state == 'noEntry' else None,
                              heldSeconds=sale.get('heldSeconds') if sale else None,
                              exitReason=sale.get('reason') if sale else None,
                              marks=len(marks))
        rejected = any(r['event'] == 'costRejected' and r.get('arm') == 'early' for r in events)
        if entry_mark is not None:
            chosen = 'early' if 100 * entry_mark >= 97 * SIZE else 'wave'
        else:
            chosen = 'wave' if rejected else None
        result.append(dict(mint=mint, cohortAt=cohort['at'], liquidityUsd=selection['entryLiquidityUsd'],
                           entryResaleRaw=entry_mark, chosen=chosen, paths=paths))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('logs', type=Path, nargs='+')
    streams = [[json.loads(line) for line in p.read_text().splitlines()] for p in parser.parse_args().logs]
    report(streams)  # Reject repeated sessions before producing any output.
    print(json.dumps([evaluate(rows) for rows in streams], indent=2))
