"""Matched quotes for the five-minute confirmation and quarter-sale arms."""
from meme_paper_account import SIZE, FEE, UNIT
from new_pool_watch import GT, USDC, snapshot
from newcomer_research import ERRORS
from volume_momentum import signed_flow


def initial(bid):
    return dict(initialBid=bid, B=dict(state='pending'), C=dict(state='open', marks=0),
                follow48=dict(state='pending'))


def sample_flow(row, at, fetch):
    try:
        trades = fetch(f"{GT}/pools/{row['pool']}/trades", 60)['data']
        if isinstance(trades, list):
            return signed_flow(trades, row, at-300, at)
    except ERRORS:
        pass
    return None


def confirm(mint, p, fetch, quote, now):
    arm = p['B']
    delay = now()-p['entryAt']
    if arm['state'] != 'pending' or delay < 300:
        return
    if delay > 360:
        arm.update(state='missedWindow')
        return
    row = snapshot(fetch(f"{GT}/pools/{p['pool']}", 30)['data'])
    if row['mint'] != mint or row['pool'] != p['pool']:
        raise ValueError('pool mismatch')
    bid = quote(mint, USDC, p['quantity'])
    count = row['buys']+row['sells']
    stable = bid >= p['initialBid']
    buying = count >= 10 and row['buys']*5 >= 3*count
    fields = dict(bid=bid, buys5m=row['buys'], sells5m=row['sells'])
    if stable and buying:
        qty = quote(USDC, mint, SIZE)
        resale = quote(mint, USDC, qty)
        fields.update(quantity=qty, entryBid=resale)
        status = 'open' if resale-2*FEE >= .95*SIZE else 'skippedCosts'
    else:
        status = 'skippedSignal'
    at = int(now())
    arm.update(**fields, decisionAt=at, state=status if at-p['entryAt']<=360 else 'missedWindow')


def quarter(mint, p, quote, now):
    arm = p['C']
    if arm['state'] != 'open' or 'proceeds' in arm or now() >= p['due']:
        return
    bid = quote(mint, USDC, p['quantity'])
    at = int(now())
    if at >= p['due']:
        return
    gap = at-arm.get('lastMarkAt', p['entryAt'])
    arm.update(lastMarkAt=at, marks=arm['marks']+1, maxGap=max(gap, arm.get('maxGap',0)))
    if bid-2*FEE < 2*SIZE or p['quantity'] < 4:
        return
    # The first observed trigger is sticky even when the subsequent quote fails.
    arm.setdefault('triggerAt',at)
    qty = p['quantity']//4
    sale = quote(mint, USDC, qty)
    filled = int(now())
    if filled < p['due']:
        arm.update(proceeds=sale, soldQuantity=qty, saleAt=filled)


def terminal(mint, arm, due, qty, quote, now, proceeds=0, fees=2):
    if arm['state'] not in ('open','pending') or now()<due:
        return
    if now() <= due+1800:
        bid = quote(mint, USDC, qty)
        at = int(now())
        if at <= due+1800:
            arm.update(state='closed', exitAt=at, netUsdc=(proceeds+bid-SIZE-fees*FEE)/UNIT)
            return
    arm.update(state='unpriced')


def observe(mint, p, fetch, quote, now):
    if 'B' not in p:  # Historical A-only positions never receive retrospective signals.
        return
    try:
        confirm(mint,p,fetch,quote,now)
    except ERRORS:
        pass
    try:
        if 'triggerAt' in p['C'] and 'proceeds' not in p['C']:
            p['C'].update(state='unpriced')
        else:
            quarter(mint,p,quote,now)
    except ERRORS:
        pass
    b,c = p['B'],p['C']
    if b['state']=='open':
        try:
            terminal(mint,b,p['due'],b['quantity'],quote,now)
        except ERRORS:
            pass
    if now()>=p['due'] and c['state']=='open':
        if 'proceeds' not in c:
            if p['state'] in ('closed','unpriced'):
                c.update({k:p[k] for k in ('state','exitAt','netUsdc') if k in p})
        else:
            try:
                terminal(mint,c,p['due'],p['quantity']-c['soldQuantity'],quote,now,c['proceeds'],3)
            except ERRORS:
                pass
    try:
        terminal(mint,p['follow48'],p['due']+86400,p['quantity'],quote,now)
    except ERRORS:
        pass
