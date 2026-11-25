"""Signal-time features for the Top 100 hourly breakout pilot."""
import math
from statistics import mean, median, pstdev

HOUR = 3600


def ema(values, length):
    value = mean(values[:length])
    result = [value]
    for x in values[length:]:
        value += 2/(length+1)*(x-value)
        result.append(value)
    return result


def wilder_rsi(closes):
    changes = [b-a for a,b in zip(closes,closes[1:])]
    up = mean(max(x,0) for x in changes[:14])
    down = mean(max(-x,0) for x in changes[:14])
    for x in changes[14:]:
        up = (13*up+max(x,0))/14
        down = (13*down+max(-x,0))/14
    return 100*up/(up+down) if up+down else 50.


def bandwidth(window):
    return 4*pstdev(window)/mean(window)


def indicator_values(history, slot, signal):
    closes = [history[t] for t in range(slot-120*HOUR,slot,HOUR)]
    if not all(math.isfinite(v) and v>0 for v in closes):
        raise ValueError('invalid close')
    fast,slow = ema(closes,12),ema(closes,26)
    macd = [a-b for a,b in zip(fast[14:],slow)]
    hist = macd[-1]-ema(macd,9)[-1]
    # Width immediately before the breakout vs the preceding 48 widths.
    prior_width = bandwidth(closes[-21:-1])
    typical = median(bandwidth(closes[j-20:j]) for j in range(len(closes)-49,len(closes)-1))
    side = signal['side']
    width = signal['rangeHigh']-signal['rangeLow']
    edge = signal['rangeHigh'] if side==1 else signal['rangeLow']
    return dict(macdHistogram=hist,rsi=wilder_rsi(closes),preWidth=prior_width,
                typicalWidth=typical,extension=side*(closes[-1]-edge)/width if width>0 else None)


def flags(values, side):
    return {'MACD aligned':side*values['macdHistogram']>0,
            'RSI not extended':values['rsi']<70 if side==1 else values['rsi']>30,
            'BB prior compression':values['preWidth']<values['typicalWidth'],
            'before Fib 1.272':values['extension']<.272 if values['extension'] is not None else None}
