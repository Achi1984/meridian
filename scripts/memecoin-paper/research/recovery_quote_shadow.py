"""Compare the 10% net target with a 97% initial resale filter on the same recovery entries."""
import argparse
import json
from collections import Counter
from pathlib import Path

from meme_paper_account import SIZE, UNIT
from newcomer_profit_target import replay


def initial_quotes(streams):
    quotes = {}
    for rows in streams:
        cohort = next(row['at'] for row in rows if row['event'] == 'cohort')
        for index, entry in enumerate(rows):
            if entry['event'] != 'entry' or entry['arm'] != 'wave':
                continue
            raw = entry.get('initialResaleRaw')
            if raw is None:
                # Legacy collector emits the already obtained resale quote immediately after entry.
                following = rows[index + 1:index + 2]
                if following:
                    mark = following[0]
                    if (mark['event'] == 'resaleMark' and mark['at'] == entry['at']
                            and all(mark.get(k) == entry[k] for k in ('mint', 'qty', 'arm'))):
                        raw = mark['usdcRaw']
            if raw is not None and (type(raw) is not int or raw <= 0):
                raise ValueError('Invalid initial resale quote')
            quotes[cohort, entry['mint']] = raw
    return quotes


def compare(streams):
    baseline = replay(streams, 'wave')
    quotes = initial_quotes(streams)
    counts = Counter()
    avoided = missed = retained = 0
    deltas = []
    for row in baseline['observations']:
        state = row['target']['state']
        if row['repeatedMint'] or state not in ('closed', 'unresolved'):
            counts['repeat' if row['repeatedMint'] else state] += 1
            continue
        raw = quotes[row['cohortAt'], row['mint']]
        if raw is None:
            counts['missingEntryQuote'] += 1
            continue
        keep = 100 * raw >= 97 * SIZE
        counts['kept' if keep else 'skipped'] += 1
        if state == 'unresolved':
            counts['unresolvedKept' if keep else 'unresolvedSkipped'] += 1
            continue
        pnl = round(row['target']['netUsdc'] * UNIT)
        deltas.append(0 if keep else -pnl)
        if keep:
            retained += pnl
        else:
            avoided += max(0, -pnl)
            missed += max(0, pnl)
    return dict(counts=dict(counts), resolvedPairs=len(deltas), avoidedLossUsdc=avoided/UNIT,
                missedProfitUsdc=missed/UNIT, filteredRealizedUsdc=retained/UNIT,
                baselinePairedRealizedUsdc=(retained + missed - avoided)/UNIT,
                pairedDeltaUsdc=sum(deltas)/UNIT if deltas else None,
                deltaWithoutBestMintUsdc=(sum(deltas)-max(deltas))/UNIT if len(deltas)>1 else None)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('sessions', nargs='+', type=Path, help='One completed session per JSONL file')
    args = cli.parse_args()
    print(json.dumps(compare([[json.loads(line) for line in path.read_text().splitlines()]
                              for path in args.sessions]), indent=2))
