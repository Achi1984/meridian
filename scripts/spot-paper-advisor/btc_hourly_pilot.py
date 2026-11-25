"""Four-hour paired BTC/USD paper experiment using public Kraken observations."""
import json
import time
from decimal import Decimal
from urllib.request import urlopen

from btc_exit_study import hourly_signals
from worker import FEE, SLIP

D = Decimal
SIZE = D('20')


def public(path):
    with urlopen('https://api.kraken.com/0/public/' + path, timeout=10) as response:
        data = json.load(response)
    if data['error']:
        raise ValueError(data['error'])
    return next(value for key, value in data['result'].items() if key != 'last')


def run():
    end = time.monotonic() + 4 * 3600
    cash = dict.fromkeys(('baseline', 'elder', 'chandelier', 'both'), D(1000))
    positions = {}
    next_entry = 0
    with open('btc-paper.jsonl', 'x', buffering=1) as out:
        while True:
            final = time.monotonic() >= end
            try:
                candles = public('OHLC?pair=XBTUSD&interval=60')
                slot = int(time.time())
                hour = slot // 3600 * 3600
                history = {int(b[0]): [int(b[0]), *map(float, b[1:5])] for b in candles[:-1]}
                color, stop = hourly_signals(history, slot)
                book = public('Depth?pair=XBTUSD&count=1')
                bid, bid_size = map(D, book['bids'][0][:2])
                ask, ask_size = map(D, book['asks'][0][:2])
                if not 0 < bid <= ask or int(time.time()) // 3600 * 3600 != hour:
                    raise ValueError('Invalid or late book')
                fills = []
                for arm, (qty, due) in list(positions.items()):
                    if bid_size >= qty and (final or slot >= due or
                            (arm in ('both', 'chandelier') and stop is True)):
                        cash[arm] += qty * bid * (1-SLIP) * (1-FEE)
                        del positions[arm]
                        fills.append([arm, 'sell', str(qty)])
                if not final and not positions and hour >= next_entry and color != 'unknown' and history.get(hour-3600):
                    qty = SIZE / (ask * (1+SLIP) * (1+FEE))
                    if ask_size >= qty:
                        for arm in cash:
                            if arm in ('both', 'elder') and color == 'red':
                                continue
                            cash[arm] -= SIZE
                            positions[arm] = (qty, hour + 7200)
                            fills.append([arm, 'buy', str(qty)])
                        next_entry = hour + 7200
                row = dict(at=slot, elder=color, chandelier=stop, bid=str(bid), ask=str(ask),
                           cash=cash, open=positions, fills=fills)
            except (OSError, ValueError, KeyError, IndexError) as exc:
                row = dict(at=int(time.time()), error=str(exc), cash=cash, open=positions)
            print(json.dumps(dict(row, final=final), default=str), file=out)
            if final:
                break
            time.sleep(min(300, max(0, end-time.monotonic())))


if __name__ == '__main__':
    run()
