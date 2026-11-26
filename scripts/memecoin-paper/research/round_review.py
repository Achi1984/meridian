"""Track the first subsequent full-size exit quote for each remaining paper lot."""
import json
import os
import time
from pathlib import Path

from campaign_ledger import verify_journal
from meme_paper_account import START, FEE, UNIT
from newcomer_wave_pair import ERRORS, USDC, spot_quote


def follow(directory, window=1800, quote=spot_quote, clock=time.time, sleep=time.sleep):
    status = json.loads((directory / 'status.json').read_text())
    if status['lastEvent'] != 'finished' or status.get('ledgerVerified') is not True:
        raise ValueError('Final verified report required')
    accounts = status['accounts']
    verify_journal(directory / 'events.jsonl', accounts, START, FEE)
    lots = {(p['mint'], p['qty']) for a in accounts.values() for p in a['openPositions']}
    path = directory / 'exit-followup.json'
    records = {key: dict(mint=key[0], qty=key[1], attempts=0, firstBidRaw=None)
               for key in sorted(lots)}
    start = clock()
    deadline = start + window
    def save():
        result = dict(roundStartedAt=status['startedAt'], roundFinishedAt=status['updatedAt'],
                      followStartedAt=int(start), updatedAt=int(clock()), quotes=list(records.values()))
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps(result))
        temp.replace(path)
    save()
    while clock() < deadline:
        pending = [r for r in records.values() if r['firstBidRaw'] is None]
        if not pending:
            break
        for record in pending:
            if clock() >= deadline:
                break
            record['attempts'] += 1
            try:
                bid = quote(record['mint'], USDC, record['qty'])
            except ERRORS as error:
                record['lastError'] = type(error).__name__
            else:
                record.update(firstBidRaw=bid, receivedAt=int(clock()))
            save()
        if all(r['firstBidRaw'] is not None for r in records.values()):
            break
        sleep(min(60, max(0, deadline-clock())))
    if os.getenv('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as report:
            print('| Bot | Cash USDC | Realisierter PnL | Ohne besten Coin | Offen | Nachträgliche Bewertung¹ |', file=report)
            print('|---|---:|---:|---:|---:|---:|', file=report)
            for name, account in sorted(accounts.items()):
                bids = [records[p['mint'], p['qty']]['firstBidRaw'] for p in account['openPositions']]
                value = 'offen' if None in bids else f"{account['cashUsdc']+sum(b-FEE for b in bids)/UNIT:.2f}"
                print('|', name, '|', account['cashUsdc'], '|', account['realizedUsdc'], '|',
                      account['realizedWithoutBestMintUsdc'], '|', len(bids), '|', value, '|', file=report)
            print('\n¹ Erste spätere Jupiter-Quotes je Restmenge nach Verkaufsgebühr. '
                  'Die Kurse können von unterschiedlichen Zeitpunkten stammen.', file=report)
    return records


if __name__ == '__main__':
    import sys
    follow(Path(sys.argv[1]))
