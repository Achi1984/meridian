"""Observe Jupiter minimum proceeds five seconds after each account F paper sale."""
import json
import time
from concurrent.futures import ThreadPoolExecutor


class ExitRequotes:
    def __init__(self, path, quote, usdc):
        self.path = path
        self.quote = quote
        self.usdc = usdc
        self.worker = ThreadPoolExecutor(max_workers=1)
        self.pending = None

    def write(self, record):
        with self.path.open('a') as stream:
            stream.write(json.dumps(record) + '\n')

    def observe(self, row):
        if not any(fill['account'] == 'F' and fill['side'] == 'sell' for fill in row['fills']):
            return
        record = dict(sourceEventId=row['eventId'], positionId=row['positionId'],
                      mint=row['mint'], qty=row['qty'], signalAt=row['at'], primaryRaw=row['usdcRaw'])
        if self.pending and not self.pending.done():
            self.write(dict(record, state='busy'))
            return
        if self.pending:
            self.pending.result()
        self.pending = self.worker.submit(self.measure, record, time.monotonic())

    def measure(self, record, start):
        time.sleep(max(0, start + 5 - time.monotonic()))
        requested = time.monotonic()
        try:
            value = self.quote(record['mint'], self.usdc, record['qty'])
            if type(value) is not int or value <= 0:
                raise ValueError('Invalid quote')
            record.update(state='quoted', delayedRaw=value)
        except Exception as exc:  # A provider failure must not interrupt the paper campaign.
            record.update(state='unavailable', reason=type(exc).__name__)
        record.update(requestDelaySeconds=round(requested-start, 3),
                      responseDelaySeconds=round(time.monotonic()-start, 3))
        self.write(record)

    def close(self):
        self.worker.shutdown(wait=True)
        if self.pending:
            self.pending.result()


def summarize(directory):
    sales = {}
    for line in (directory/'events.jsonl').read_text().splitlines():
        row = json.loads(line)
        if any(f['account'] == 'F' and f['side'] == 'sell' for f in row['fills']):
            sales[row['eventId']] = row
    path = directory/'exit-requotes.jsonl'
    seen = set()
    valid = worse = busy = unavailable = delta = 0
    delays = []
    for line in path.read_text().splitlines() if path.exists() else []:
        probe = json.loads(line)
        key = probe['sourceEventId']
        sale = sales[key]
        if key in seen or any(probe[k] != sale[k] for k in ('mint','qty','positionId')) or probe['primaryRaw'] != sale['usdcRaw']:
            raise ValueError('Unmatched or duplicated quote measurement')
        seen.add(key)
        if probe['state'] == 'busy':
            busy += 1
        elif probe['state'] == 'unavailable':
            unavailable += 1
        elif probe['state'] == 'quoted':
            diff = probe['delayedRaw'] - probe['primaryRaw']
            valid += 1
            worse += int(diff < 0)
            delta += diff
            delays.append(probe['responseDelaySeconds'])
        else:
            raise ValueError('Unknown quote measurement')
    print(f'Konto F · {len(sales)} Paper-Verkäufe · {valid} Folgekurse · {unavailable} nicht verfügbar · '
          f'{busy} gleichzeitig belegt · {len(sales)-len(seen)} ohne Messung')
    if valid:
        print(f'\nBei {worse} Folgeangeboten sank der Mindesterlös. Summe der Differenzen '
              f'{delta / 1_000_000:+.6f} USDC. Antworten nach {min(delays):.1f} bis {max(delays):.1f} Sekunden.')


if __name__ == '__main__':
    import sys
    from pathlib import Path
    summarize(Path(sys.argv[1]))
