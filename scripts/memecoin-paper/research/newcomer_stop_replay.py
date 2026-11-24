"""Replay a 10% sampled stop on the recorded immediate-entry liquidation path."""
import argparse
import json
from decimal import Decimal
from pathlib import Path

from meme_paper_account import FEE, SIZE, UNIT
from wave_band_report import report


def score(mint, rows):
    early = [row for row in rows if row.get('mint') == mint and row.get('arm') == 'early']
    entries = [row for row in early if row['event'] == 'entry']
    if not entries:
        gap = any(row['event'] == 'observationUnavailable' and row.get('mint') == mint for row in rows)
        return dict(mint=mint, status='noEntryWithGap' if gap else 'noEntry')
    entry = entries[0]
    if Decimal(str(entry['usdc'])) * UNIT != SIZE:
        raise ValueError('Unexpected stake')
    marks = []
    previous_tick = -1
    for row in early:
        if row['event'] != 'resaleMark':
            continue
        if row['qty'] != entry['qty'] or row['tick'] <= previous_tick or row['at'] < entry['at']:
            raise ValueError('Inconsistent resale path')
        previous_tick = row['tick']
        marks.append(row)
    if not marks or marks[0]['tick'] != 0:
        return dict(mint=mint, status='missingEntryMark')
    sale = next((row for row in early if row['event'] == 'exit'), None)
    if sale and (sale['qty'] != entry['qty'] or sale['usdcRaw'] != marks[-1]['usdcRaw']
                 or Decimal(str(sale['netUsdc']))*UNIT != sale['usdcRaw']-SIZE-2*FEE):
        raise ValueError('Exit disagrees with last resale quote')
    peak = tight_peak = baseline_dd = tight_dd = 0
    trigger = None
    for row in marks:
        net = row['usdcRaw'] - SIZE - 2*FEE
        peak = max(peak, net)
        baseline_dd = max(baseline_dd, peak-net)
        if trigger is None:
            tight_peak = max(tight_peak, net)
            tight_dd = max(tight_dd, tight_peak-net)
            if row['tick'] > 0 and 10*net <= -SIZE:
                trigger = row
    baseline = sale['usdcRaw'] - SIZE - 2*FEE if sale else None
    tight = trigger['usdcRaw']-SIZE-2*FEE if trigger else baseline
    delta = tight-baseline if baseline is not None else None
    return dict(mint=mint, status='closed' if sale else 'unresolvedBaseline',
                baselineNet=None if baseline is None else baseline/UNIT,
                tightNet=None if tight is None else tight/UNIT,
                delta=None if delta is None else delta/UNIT, triggerTick=trigger['tick'] if trigger else None,
                changedExit=bool(trigger and (not sale or trigger is not marks[-1])),
                baselineDrawdown=baseline_dd/UNIT, tightDrawdown=tight_dd/UNIT,
                baselineZeroRecovery=(baseline if baseline is not None else -SIZE-FEE)/UNIT,
                tightZeroRecovery=(tight if tight is not None else -SIZE-FEE)/UNIT,
                missingQuotes=sum(r['event']=='missingExitQuote' for r in early))


def replay(streams):
    report(streams)
    results = []
    for rows in streams:
        cohort = next(row for row in rows if row['event'] == 'cohort')
        if cohort.get('holdingPolicy') != 'tenMinutesFromEntry':
            raise ValueError('Expected entry-relative holding policy')
        results.append(dict(cohortAt=cohort['at'], mints=[score(m, rows) for m in cohort['mints']]))
    return results


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('logs', type=Path, nargs='+')
    print(json.dumps(replay([[json.loads(line) for line in path.read_text().splitlines()]
                             for path in cli.parse_args().logs]), indent=2))
