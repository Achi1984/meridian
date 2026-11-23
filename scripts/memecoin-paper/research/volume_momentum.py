"""Prospective, quote-only 20 USDC momentum comparison on the scanner cohort."""
import time
from collections import Counter

from meme_paper_account import FEE, UNIT
from new_pool_watch import GT, SIZE, USDC, number, spot_quote
from newcomer_research import ERRORS
from newcomer_scanner import market_reader, metrics, scan, timestamp
from newcomer_wave_pair import EXIT_GRACE, HOLD_SECONDS, emit


def signed_flow(trades, row, start, end):
    """Return net buy USD for a complete window; None means unknown."""
    fills = {}
    oldest = end
    for trade in trades:
        a = trade['attributes']
        at = timestamp(a['block_timestamp'])
        oldest = min(at, oldest)
        if not start <= at < end or a.get('is_anomalous'):
            continue
        pair = a['from_token_address'], a['to_token_address']
        if pair == (row['quote'], row['mint']):
            sign = 1
        elif pair == (row['mint'], row['quote']):
            sign = -1
        else:
            continue
        fills[trade['id']] = sign * number(a['volume_in_usd'])
    if len(trades) >= 300 and oldest >= start:
        return None
    return sum(fills.values())


def entry_signal(row, end, fetch):
    path = f"{GT}/pools/{row['pool']}"
    candles = fetch(path+f'/ohlcv/minute?aggregate=1&currency=usd&token=base&limit=31'
                    f'&include_empty_intervals=true&before_timestamp={end}', 120)
    if candles['meta']['base']['address'] != row['mint']:
        raise ValueError('pool mint mismatch')
    trades = fetch(path+'/trades', 60)['data']
    windows = metrics(row, candles['data']['attributes']['ohlcv_list'], trades, end)
    five, thirty = windows.get(5, {}), windows.get(30, {})
    if thirty.get('observedMinutes') != 30 or timestamp(row['created']) > end-1800:
        return False, dict(reason='incomplete30m')
    if not five:
        return False, dict(reason='incomplete5m')
    current = five['volumeUsd']
    previous = (thirty['volumeUsd']-current)/5
    change = five['changePct']
    net = signed_flow(trades, row, end-300, end)
    if net is None:
        return False, dict(reason='incompleteTradeFlow')
    passed = (previous > 0 and current >= 2*previous and change is not None
              and 2-1e-9 <= change <= 10+1e-9 and net > 0)
    return passed, dict(asOf=end, volume5mUsd=current, previousMean5mUsd=previous,
                        changePct=change, netBuys5mUsd=net)


class Position:
    def __init__(self, row, qty, initial, at, accepted):
        self.row, self.qty, self.at = row, qty, at
        self.accepted = accepted
        self.high, self.high_at = initial, at
        self.pending = self.standard = self.strategy = self.delayed = None
        self.standard_at = self.strategy_at = self.strategy_delayed = None

    def observe(self, at, bid, sell_pressure):
        if at-self.at > HOLD_SECONDS+EXIT_GRACE:
            return
        net = bid-SIZE-2*FEE
        if self.standard_at is not None and at > self.standard_at and self.delayed is None:
            self.delayed = net
        if self.strategy_at is not None and at > self.strategy_at and self.strategy_delayed is None:
            self.strategy_delayed = net
        if self.pending is not None and at > self.pending and self.strategy is None:
            self.strategy, self.strategy_at = net, at
        if bid > self.high:
            self.high, self.high_at = bid, at
        baseline_exit = at-self.at >= HOLD_SECONDS or net >= 2*SIZE or 10*net <= -3*SIZE
        if baseline_exit and self.standard is None:
            self.standard, self.standard_at = net, at
        if self.accepted and self.strategy is None:
            if baseline_exit:
                self.strategy, self.strategy_at = net, at
            elif self.pending is None and at-self.high_at >= 120 and sell_pressure:
                self.pending = at


def comparison(positions):
    rows = {}
    for label in ('standard', 'filterOnly', 'filterAndFade'):
        by_mint = Counter()
        unresolved = 0
        for p in positions:
            if label != 'standard' and not p.accepted:
                continue
            net = p.strategy if label == 'filterAndFade' else p.standard
            if net is None:
                unresolved += 1
            else:
                by_mint[p.row['mint']] += net
        total = sum(by_mint.values())
        rows[label] = dict(closed=len(by_mint), unresolved=unresolved, netUsdc=total/UNIT,
                           withoutBestUsdc=(total-max(by_mint.values()))/UNIT if by_mint else None)
    matched = [p for p in positions if p.accepted and p.standard is not None and p.strategy is not None]
    rows['exitComparison'] = dict(matched=len(matched), netDeltaUsdc=sum(
        p.strategy-p.standard for p in matched)/UNIT if matched else None)
    skipped = [p for p in positions if not p.accepted and p.standard is not None]
    delayed = [p for p in positions if p.accepted and p.delayed is not None and p.strategy_delayed is not None]
    rows['oneQuoteLater'] = dict(matched=len(delayed), incomplete=sum(p.accepted for p in positions)-len(delayed),
        standardNetUsdc=sum(p.delayed for p in delayed)/UNIT if delayed else None,
        strategyNetUsdc=sum(p.strategy_delayed for p in delayed)/UNIT if delayed else None)
    rows['filterComparison'] = dict(skippedClosed=len(skipped),
        avoidedLossUsdc=-sum(min(0,p.standard) for p in skipped)/UNIT,
        missedProfitUsdc=sum(max(0,p.standard) for p in skipped)/UNIT)
    return rows


def run(fetch=None, quote=spot_quote, output=emit, clock=time.time, sleep=time.sleep):
    fetch = fetch or market_reader()
    as_of = None
    def journal(kind, **fields):
        nonlocal as_of
        if kind == 'scannerSummary':
            as_of = fields['asOf']
        output(kind, **fields)

    cohort = scan(journal, fetch=fetch, quote=quote, now=clock)[:2]
    positions = []
    for row in cohort:
        mint = row['mint']
        end = int(clock()//60)*60
        try:
            passed, evidence = entry_signal(row, end, fetch)
        except ERRORS as exc:
            passed, evidence = False, dict(reason=type(exc).__name__)
        try:
            qty = quote(USDC, mint, SIZE)
            bid = quote(mint, USDC, qty)
        except ERRORS as exc:
            output('momentumUnavailable', mint=mint, reason=type(exc).__name__)
            continue
        at = int(clock())
        if at-end >= 120 or at-as_of >= 300:
            evidence['reason'] = 'staleSignal'
        usable = 'reason' not in evidence
        accepted = usable and passed and bid-2*FEE >= 19_600_000
        baseline = bid >= .95*SIZE
        output('momentumDecision', mint=mint, at=at, rankAsOf=as_of, evidence=evidence,
               qty=qty, netResaleUsdc=(bid-2*FEE)/UNIT, baseline=baseline, accepted=accepted,
               comparable=usable and baseline)
        if usable and baseline:
            positions.append(Position(row, qty, bid, at, accepted))
    while any(clock()-p.at <= HOLD_SECONDS+EXIT_GRACE and p.delayed is None for p in positions):
        sleep(60)
        for p in positions:
            if clock()-p.at > HOLD_SECONDS+EXIT_GRACE or p.delayed is not None:
                continue
            mint = p.row['mint']
            end = int(clock()//60)*60
            flow = None
            if p.accepted and p.strategy is None and p.pending is None and end+60-p.high_at >= 120:
                try:
                    ticks = fetch(f"{GT}/pools/{p.row['pool']}/trades", 60)['data']
                    flow = signed_flow(ticks, p.row, end-60, end)
                except ERRORS:
                    pass
            try:
                bid = quote(mint, USDC, p.qty)
            except ERRORS as exc:
                output('momentumMissingBid', mint=mint, reason=type(exc).__name__)
                continue
            at = int(clock())
            if at-end >= 60:
                flow = None
            p.observe(at, bid, flow is not None and flow < 0)
            output('momentumMark', mint=mint, qty=p.qty, at=at, bidRaw=bid, netBuy1mUsd=flow,
                   fadeSignalAt=p.pending, standardNetRaw=p.standard, strategyNetRaw=p.strategy,
                   nextStandardQuoteNetRaw=p.delayed, nextStrategyQuoteNetRaw=p.strategy_delayed)
    output('momentumSummary', **comparison(positions))


if __name__ == '__main__':
    run()
