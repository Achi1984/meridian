"""Offline BTC/EUR comparison rule for ten-minute decision-time snapshots."""
from decimal import Decimal

from worker import forced


def channel_action(snapshot, state, slot):
    """Use completed bars only. Apply normal pilot execution checks separately."""
    invested = Decimal(state['btc']) > 0
    if forced(state, slot):
        return 'SELL' if invested else 'HOLD'
    if not snapshot or len(snapshot['ten']) < 21:
        return 'HOLD'
    candles = snapshot['ten']
    close = candles[-1][4]
    if invested and close < min(bar[3] for bar in candles[-11:-1]):
        return 'SELL'
    if not invested and close > max(bar[2] for bar in candles[-21:-1]):
        return 'BUY'
    return 'HOLD'
