"""Quote-only one-minute Solana launch short experiments. Outputs JSON Lines."""
import json
import time
from collections import Counter
from fractions import Fraction
from urllib.request import Request, urlopen

from new_pool_watch import ADDRESS, get
from newcomer_research import ERRORS
from newcomer_scanner import TOKENS, timestamp

MARGIN = 10_000_000  # 0.01 SOL per independent hypothetical position
NETWORK_BUDGET = 100_000  # assumed total opening and closing transaction cost


def uint(value):
    if type(value) not in (int, str) or not str(value).isascii() or not str(value).isdigit():
        raise ValueError('invalid unsigned integer')
    return int(value)


def quote(mint, fetch):
    url = f'https://api.shortr.fun/v1/markets/{mint}/quote/short'
    q = fetch(f'{url}?margin_lamports={MARGIN}&tier=2&slippage_bps=100', 20)
    if (q['mint'] != mint or q['tier'] != 2 or uint(q['margin_lamports']) != MARGIN
            or q['venue'] not in ('curve', 'pumpswap')):
        raise ValueError('quote identity mismatch')
    r = q['reserves']
    base, sol = uint(r['token_tokens']), uint(r['sol_lamports'])
    fees = r['fees_bps']
    if not isinstance(fees, list) or not 1 <= len(fees) <= 4:
        raise ValueError('missing venue charges')
    fees = tuple(map(uint, fees))
    owed, floor = uint(q['owed_tokens']), uint(q['min_proceeds_lamports'])
    if not 0 < owed < base or not sol or not 0 < floor <= uint(q['proceeds_lamports']) or sum(fees) >= 10000:
        raise ValueError('invalid quote economics')
    return dict(venue=q['venue'], slot=uint(r['slot']), base=base, sol=sol, fees=fees,
                owed=owed, floor=floor, expiry=uint(q['secured_until']),
                hourly=uint(q['borrow_fee_per_hour_lamports']),
                upfront=uint(q['fees']['open_fee_lamports']),
                minimum=uint(q['fees']['min_charge_lamports']),
                trigger=uint(q['liquidation']['trigger_lamports']))


def block_time(slot):
    """Look up the reserve observation time independently of the quote service."""
    payload = dict(jsonrpc='2.0', id=1, method='getBlockTime', params=[slot])
    request = Request('https://api.mainnet-beta.solana.com', data=json.dumps(payload).encode(),
                      headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=5) as response:
        return uint(json.loads(response.read(8192))['result'])


def ceiling(n, d):
    return (n+d-1)//d


def estimate(entry, mark, seconds):
    if entry['owed'] >= mark['base']:
        return None
    raw = ceiling(mark['sol']*entry['owed'], mark['base']-entry['owed'])
    buy = raw + sum(ceiling(raw*bps, 10000) for bps in mark['fees'])
    buy = ceiling(buy*101, 100)  # conservative 1% close slippage
    borrow = max(entry['minimum'], ceiling(entry['hourly']*seconds, 3600))
    if buy+borrow >= min(entry['trigger'], entry['floor']+MARGIN):
        return None
    return entry['floor']-buy-entry['upfront']-borrow-NETWORK_BUDGET


def signals(history):
    a, b, c = [Fraction(item['sol'], item['base']) for item in history]
    if b*100 >= a*105 and c*100 <= b*97:
        return ['failedPump']
    if b*100 <= a*98 and c*100 <= b*98:
        return ['continuedSelling']
    return []


def run(mints, emit, fetch=get, clock=time.time, sleep=time.sleep, slot_time=block_time):
    history, positions = {}, {}
    index = 0
    retried = False
    while index < 4:
        transient_failures = 0
        start = clock()
        for mint, born in mints.items():
            active = positions.pop(mint, None)
            try:
                q = quote(mint, fetch)
                observed = uint(slot_time(q['slot']))
                received = int(clock())
                if not 0 <= received-observed <= 20:
                    raise ValueError('stale or future reserve slot')
                at = observed
                previous = history.get(mint, [])
                if previous:
                    last_at, last = previous[-1]
                    if (not 40 <= at-last_at <= 90 or q['slot'] <= last['slot']
                            or q['venue'] != last['venue']):
                        raise ValueError('observation continuity lost')
                history[mint] = previous + [(at, q)]
                emit(dict(event='quote', mint=mint, at=at, receivedAt=received, **q))
                if active:
                    bot, when, entry = active
                    pnl = estimate(entry, q, at-when) if at < entry['expiry'] else None
                    emit(dict(event='paperMark' if pnl is not None else 'unresolved',
                              bot=bot, mint=mint, estimatedPnlLamports=pnl))
                if index == 2 and len(previous) == 2 and 0 <= at-born <= 86400 and q['expiry'] > at+90:
                    for bot in signals([item for _, item in history[mint]]):
                        positions[mint] = bot, at, q
                        emit(dict(event='paperOpen', bot=bot, mint=mint, at=at))
            except ERRORS as exc:
                if getattr(exc, 'code', None) in (502, 503, 504):
                    transient_failures += 1
                history.pop(mint, None)
                emit(dict(event='quoteUnavailable', mint=mint, status=getattr(exc, 'code', None),
                          reason=str(exc)[:160]))
                if active:
                    emit(dict(event='unresolved', mint=mint, bot=active[0]))
        if index == 0 and not retried and mints and transient_failures == len(mints):
            retried = True
            emit(dict(event='initialRoundRetry', delaySeconds=60, mintCount=len(mints)))
            sleep(60)
            continue
        if (index < 2 and history) or (index == 2 and positions):
            sleep(max(0, start+60-clock()))
        else:
            break
        index += 1


MARKET_PAGE = ('https://api.shortr.fun/v1/markets?has_liquidity=true'
               '&sort=created&order=desc&limit=30')


def cohort(fetch, now, emit):
    try:
        page = fetch(MARKET_PAGE, 120)
        rows = next((page[key] for key in ('items', 'markets', 'data')
                     if isinstance(page.get(key), list)), None) if isinstance(page, dict) else None
        if rows is None or any(not isinstance(row, dict) or not isinstance(row.get('mint'), str)
                               or not ADDRESS.fullmatch(row['mint']) for row in rows):
            raise ValueError('invalid short market page')
        listed = sorted({row['mint'] for row in rows[:30]})
    except ERRORS as exc:
        emit(dict(event='marketDirectoryUnavailable', status=getattr(exc, 'code', None),
                  reason=str(exc)[:160]))
        listed = None

    if listed is None:
        source = 'recentLaunchFallback'
        url = TOKENS+'/recent?limit=100'
    else:
        source = 'listedWithLiquidity'
        url = TOKENS+'/search?query='+','.join(listed)
    tokens = fetch(url, 120) if listed != [] else []
    if not isinstance(tokens, list):
        raise ValueError('invalid token metadata response')
    result = {}
    for item in tokens:
        if not isinstance(item, dict):
            continue
        mint = item.get('id')
        first = item.get('firstPool')
        if (not isinstance(mint, str) or not ADDRESS.fullmatch(mint)
                or (listed is not None and mint not in listed)
                or item.get('launchpad') != 'pump.fun' or not isinstance(first, dict)):
            continue
        try:
            born = timestamp(first['createdAt'])
        except (TypeError, ValueError, KeyError):
            continue
        if 0 <= now-born <= 86400:
            result[mint] = born
    selected = dict(sorted(result.items(), key=lambda pair: (-pair[1], pair[0]))[:6])
    emit(dict(event='cohort', source=source, listedSample=len(listed) if listed is not None else None,
              mints=selected))
    return selected


if __name__ == '__main__':
    counts = Counter()

    def write(row):
        counts[row['event']] += 1
        print(json.dumps(row), flush=True)

    try:
        selected = cohort(get, time.time(), write)
        run(selected, write)
    except ERRORS as exc:
        write(dict(event='discoveryUnavailable', reason=str(exc)[:160]))
    print(json.dumps(dict(event='summary', counts=counts)))
