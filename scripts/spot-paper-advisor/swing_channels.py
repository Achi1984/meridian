"""Fixed daily directional-strength, breakout and exit variants for offline BTC replay."""
from collections import deque
from itertools import product


class Wilder:
    def __init__(self):
        self.value = 0.
        self.count = 0

    def update(self, sample):
        self.count += 1
        self.value += (sample - self.value) / min(14, self.count)
        return self.value if self.count >= 14 else None


class ChannelSignals:
    def __init__(self):
        self.ranges = deque(maxlen=20)
        self.prev = self.close = self.atr = self.adx = None
        self.breakout = self.channel_exit = 0
        self.smoothers = [Wilder() for _ in range(4)]

    def update(self, close, day_range):
        if close is None or day_range is None:
            self.__init__()
            return
        low, high = day_range
        self.close = close
        if self.prev:
            last_low, last_high, last_close = self.prev
            tr, plus, minus, strength = self.smoothers
            self.atr = tr.update(max(high-low, abs(high-last_close), abs(low-last_close)))
            up, down = high-last_high, last_low-low
            p = plus.update(up if up > max(down, 0.) else 0.)
            m = minus.update(down if down > max(up, 0.) else 0.)
            if p is not None:
                self.adx = strength.update(100*abs(p-m)/(p+m) if p+m else 0.)
        history = list(self.ranges)
        self.breakout = self.cross(close, history, 20)
        self.channel_exit = self.cross(close, history, 10)
        self.ranges.append(day_range)
        self.prev = low, high, close

    @staticmethod
    def cross(close, history, length):
        if len(history) < length:
            return 0
        window = history[-length:]
        return int(close > max(r[1] for r in window)) - int(close < min(r[0] for r in window))


class ChannelRule:
    def __init__(self, adx, breakout, channel, trail):
        self.adx, self.breakout, self.channel, self.trail = adx, breakout, channel, trail
        self.stop = None
        self.name = '_'.join(key for key, enabled in zip(
            ('adx25', 'break20', 'exit10', 'atr3'), (adx, breakout, channel, trail)) if enabled) or 'base'

    def target(self, quantity, trend, confirmed, signal):
        side = int(quantity > 0) - int(quantity < 0)
        if side and side == trend:
            stop_hit = self.stop is not None and signal.close is not None and side*(signal.close-self.stop) <= 0
            if (self.channel and signal.channel_exit == -side) or stop_hit:
                self.stop = None
                return 0
            self.move_stop(side, signal)
            return side
        self.stop = None
        if self.adx and (signal.adx is None or signal.adx < 25):
            return 0
        if self.breakout and signal.breakout != confirmed:
            return 0
        if self.trail and signal.atr is None:
            return 0
        if confirmed:
            self.move_stop(confirmed, signal)
        return confirmed

    def move_stop(self, side, signal):
        if self.trail and signal.atr is not None:
            level = signal.close - side*3*signal.atr
            if self.stop is None or side*(level-self.stop) > 0:
                self.stop = level


def configurations():
    return [ChannelRule(*switches) for switches in product((False, True), repeat=4)]
