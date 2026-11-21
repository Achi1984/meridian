"""Prospective quote-only study of newly launched Solana tokens."""
from datetime import datetime
from meme_paper_account import FEE, UNIT


def runner_signal(first, row, age, now, quote_tokens):
    try:
        launch_age = now - datetime.fromisoformat(first['created']).timestamp()
    except (ValueError, TypeError, OverflowError):
        return False
    return (0 <= launch_age <= 3600 and 60 <= age <= 900
            and row['dex'] in ('pump-fun', 'pumpswap')
            and row['quote'] in quote_tokens and row['mint'] not in quote_tokens
            and (row['mint'], row['quote']) == (first['mint'], first['quote'])
            and first['price'] > 0 and 1.05 <= row['price']/first['price'] <= 1.50
            and row['liquidity'] >= max(5000, first['liquidity'])
            and row['sells'] >= 3 and row['buys'] >= 1.5 * row['sells'])


class RunnerStudy:
    def __init__(self, quote, usdc, size):
        self.quote, self.usdc, self.size = quote, usdc, size
        self.attempted = set()
        self.open = {}
        self.trailing_peak = {}

    def enter(self, row, event):
        mint = row['mint']
        if mint in self.attempted or len(self.attempted) >= 8 or len(self.open) >= 2:
            return
        self.attempted.add(mint)
        try:
            qty = self.quote(self.usdc, mint, self.size)
            bid = self.quote(mint, self.usdc, qty)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            event('runnerEntryMissing', mint=mint, reason=type(exc).__name__)
            return
        if bid < self.size * .95:
            event('runnerEntryTooCostly', mint=mint, usdcRaw=bid)
            return
        self.open[mint] = [qty, False]
        self.trailing_peak[mint] = bid - 2 * FEE
        event('runnerPaperEntry', mint=mint, pool=row['pool'], qty=qty, costRaw=self.size)

    def mark(self, event, final):
        for mint, (qty, doubled) in list(self.open.items()):
            try:
                bid = self.quote(mint, self.usdc, qty)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                event('runnerUnresolved' if final else 'runnerMissingBid', mint=mint, reason=type(exc).__name__)
                continue
            net = bid - self.size - 2 * FEE
            if net >= self.size and not doubled:
                self.open[mint][1] = True
                event('runnerDoubleSeen', mint=mint, netUsdc=net / UNIT)
            if mint in self.trailing_peak:
                value = self.size + net
                peak = max(self.trailing_peak[mint], value)
                self.trailing_peak[mint] = peak
                if peak >= 1.5 * self.size and value <= .8 * peak:
                    event('runnerTrailingExit', mint=mint, usdcRaw=bid, netUsdc=net/UNIT,
                          peakNetUsdc=(peak-self.size)/UNIT)
                    del self.trailing_peak[mint]
            if net >= 2 * self.size or net <= -.30 * self.size or final:
                reason = 'triple' if net >= 2*self.size else 'stop' if net <= -.30*self.size else 'sessionEnd'
                event('runnerPaperExit', mint=mint, reason=reason, netUsdc=net/UNIT, usdcRaw=bid)
                # Without an earlier trail, the paired variant shares this exit.
                self.trailing_peak.pop(mint, None)
                del self.open[mint]
