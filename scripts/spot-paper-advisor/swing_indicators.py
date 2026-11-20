"""Daily BTC spot indicators for the offline swing replay."""
from collections import deque


class EMA:
    def __init__(self, period):
        self.period = period
        self.seed = []
        self.value = None

    def update(self, value):
        if self.value is None:
            self.seed.append(value)
            if len(self.seed) == self.period:
                self.value = sum(self.seed) / self.period
                self.seed.clear()
        else:
            self.value += 2 / (self.period + 1) * (value - self.value)
        return self.value


def sign(value):
    return int(value > 0) - int(value < 0)


class DailyIndicators:
    names = ('momentum', 'rsi', 'macd', 'fib', 'threeOfFour', 'trendThreeOfFour')

    def __init__(self):
        self.closes = deque(maxlen=20)
        self.ranges = deque(maxlen=20)
        self.fast, self.slow, self.signal = EMA(12), EMA(26), EMA(9)
        self.gain = self.loss = 0.
        self.changes = 0
        self.votes = dict.fromkeys(self.names[:4], 0)

    def update(self, close, day_range):
        if close is None:
            self.__init__()
            return
        if self.closes:
            change = close - self.closes[-1]
            self.changes += 1
            # Seed Wilder's 14-day averages with the first fourteen changes.
            divisor = min(14, self.changes)
            self.gain += (max(0., change) - self.gain) / divisor
            self.loss += (max(0., -change) - self.loss) / divisor
        # RSI above/below 50 is equivalent to average gain above/below loss.
        self.votes['rsi'] = sign(self.gain - self.loss) if self.changes >= 14 else 0
        self.votes['momentum'] = sign(close - self.closes[0]) if len(self.closes) == 20 else 0
        fast, slow = self.fast.update(close), self.slow.update(close)
        if slow is not None:
            line = fast - slow
            signal = self.signal.update(line)
            self.votes['macd'] = sign(line - signal) if signal is not None else 0
        self.votes['fib'] = 0
        if len(self.ranges) == 20 and None not in self.ranges:
            low = min(r[0] for r in self.ranges)
            high = max(r[1] for r in self.ranges)
            if high > low:
                self.votes['fib'] = (int(close > low + .618 * (high-low))
                                     - int(close < low + .382 * (high-low)))
        self.closes.append(close)
        self.ranges.append(day_range)

    def targets(self, trend):
        votes = list(self.votes.values())
        consensus = int(votes.count(1) >= 3) - int(votes.count(-1) >= 3)
        return dict(self.votes, threeOfFour=consensus,
                    trendThreeOfFour=consensus if consensus == trend else 0)


def confirmed_entry_target(quantity, trend, confirmed):
    """Hold a trend-aligned position until neutral or reversal; confirm each new entry."""
    if quantity * trend > 0:
        return trend
    return confirmed
