"""Single-writer, ten-minute BTC/EUR paper advisor. No exchange order client."""
import argparse
from feeds import COST_VERSION, COST_DIGEST, CHALLENGER_DIGEST, CHALLENGER_VERSION, POLICY_DIGEST, POLICY_VERSION, book_failure, model_failure
import fcntl
import json
import math
import os
import sqlite3
import time
from datetime import datetime, timezone
from decimal import Decimal as D, ROUND_DOWN
from pathlib import Path

STEP = 600
DAY = 86400
FEE = D('.005')
SLIP = D('.001')
VERSION = 'btc-eur-advisor-v1'


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def initial():
    return dict(cash='1000', btc='0', opened=None)


def execute(state, action, book, slot):
    cash, btc = D(state['cash']), D(state['btc'])
    if action == 'HOLD':
        return 'HOLD'
    if action == 'BUY' and btc or action == 'SELL' and not btc:
        return 'POSITION_UNCHANGED'
    if book is None:
        return 'NO_FRESH_BOOK'
    if action == 'BUY':
        price = D(str(book['ask']))*(1+SLIP)*(1+FEE)
        qty = (min(D(100),cash)/price).quantize(D('.00000001'), rounding=ROUND_DOWN)
        if qty <= 0 or qty > D(str(book['askSize'])):
            return 'INSUFFICIENT_ASK_SIZE'
        state.update(cash=str(cash-qty*price),btc=str(qty),opened=slot)
        return 'PAPER_BUY'
    if action != 'SELL':
        raise ValueError('unknown action')
    if btc > D(str(book['bidSize'])):
        return 'INSUFFICIENT_BID_SIZE'
    proceeds = btc*D(str(book['bid']))*(1-SLIP)*(1-FEE)
    state.update(cash=str(cash+proceeds),btc='0',opened=None)
    return 'PAPER_SELL'


def mark(state, book):
    cash, btc = D(state['cash']), D(state['btc'])
    equity = cash if btc == 0 else None
    if btc and book and btc <= D(str(book['bidSize'])):
        equity = cash+btc*D(str(book['bid']))*(1-SLIP)*(1-FEE)
    return dict(cashEur=float(cash),btc=float(btc),equityEur=float(equity) if equity is not None else None,
                lives=float(equity/1000) if equity is not None else None)


def forced(state, slot):
    return slot%DAY == DAY-STEP or (state['opened'] is not None and state['opened']//DAY < slot//DAY)


def reference(candles, state):
    # Fixed intraday comparator: SMA5 vs SMA20 of completed ten-minute closes.
    if len(candles) < 20:
        return 'HOLD'
    closes = [D(str(row[4])) for row in candles[-20:]]
    gap = sum(closes[-5:])*4-sum(closes)
    if gap > 0 and not D(state['btc']):
        return 'BUY'
    if gap < 0 and D(state['btc']):
        return 'SELL'
    return 'HOLD'


def challenger_inputs(snapshot, state, slot):
    book = snapshot['book']
    bid, ask = D(str(book['bid'])), D(str(book['ask']))
    entry_unit = ask * (1 + SLIP) * (1 + FEE)
    exit_factor = (1 - SLIP) * (1 - FEE)
    quantity = (min(D(100), D(state['cash'])) / entry_unit).quantize(D('.00000001'), rounding=ROUND_DOWN)
    ten = snapshot['ten']
    previous = ten[-7:-1]
    return dict(entryBreakEvenExitBidEur=float(entry_unit / exit_factor),
                breakEvenRiseFromBidPct=float(100 * (entry_unit / (bid * exit_factor) - 1)),
                askCoversEntry=quantity > 0 and quantity <= D(str(book['askSize'])),
                bidCoversPosition=D(state['btc']) <= D(str(book['bidSize'])),
                priorHourHighEur=max(row[2] for row in previous),
                priorHourLowEur=min(row[3] for row in previous),
                minutesUntilMandatoryExit=(DAY - STEP - slot % DAY) // 60)


def range_covers_cost(snapshot, book):
    bars = snapshot['ten'][-6:]
    span = D(str(max(row[2] for row in bars))) - D(str(min(row[3] for row in bars)))
    required_bid = D(str(book['ask'])) * (1+SLIP)*(1+FEE) / ((1-SLIP)*(1-FEE))
    return len(bars) == 6 and span > required_bid - D(str(book['bid']))


def connect(path, model, *, challenger=False, cost_aware=False):
    db = sqlite3.connect(path)
    with db:
        db.execute('CREATE TABLE IF NOT EXISTS slots (slot INTEGER PRIMARY KEY, record TEXT)')
        db.execute('CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
        policy, digest = (CHALLENGER_VERSION, CHALLENGER_DIGEST) if challenger else (POLICY_VERSION, POLICY_DIGEST)
        if cost_aware:
            policy, digest = COST_VERSION, COST_DIGEST
        identity=json.dumps([VERSION, policy, digest, model])
        db.execute('INSERT OR IGNORE INTO config VALUES (1,?)',(identity,))
        if db.execute('SELECT value FROM config WHERE id=1').fetchone()[0]!=identity:
            raise ValueError('model or policy changed: use a separate challenger database')
    return db


def estimate_cost(usage, rates):
    if usage is None or rates is None:
        return None
    return ((usage['input']-usage['cached'])*rates[0] + usage['cached']*rates[1]
            + usage['output']*rates[2])/1e6


def cycle(db, slot, model, key, feeds, rates=None, clock=time.time):
    # Reserve before remote I/O. A crash leaves an auditable pending slot; never retry a billed call.
    if slot % STEP or not slot <= clock() < slot+STEP:
        raise ValueError('not current UTC slot')
    with db:
        latest=db.execute('SELECT MAX(slot) FROM slots').fetchone()[0]
        if latest is not None and slot <= latest:
            return None
        db.execute('INSERT INTO slots VALUES (?,NULL)',(slot,))
    row=db.execute('SELECT record FROM slots WHERE record IS NOT NULL ORDER BY slot DESC LIMIT 1').fetchone()
    previous=json.loads(row[0]) if row else {}
    states=previous.get('states',{name:initial() for name in ('model','reference','cash')})
    history=[]
    for (raw,) in db.execute('SELECT record FROM slots WHERE record IS NOT NULL ORDER BY slot DESC LIMIT 6'):
        history.append(json.loads(raw)['report']['last'])
    _, policy, digest, _ = json.loads(db.execute("SELECT value FROM config WHERE id=1").fetchone()[0])
    snapshot=None
    market_status='OK'
    if forced(states['model'],slot) and forced(states['reference'],slot):
        market_status='DAY_CLOSE_BOOK_ONLY'
    else:
        try:
            snapshot=feeds.market(slot)
        except Exception as exc:
            market_status=str(exc) if isinstance(exc,feeds.FeedError) else 'MARKET_ERROR'
    action,reason,usage='HOLD','MARKET_UNAVAILABLE',None
    cost=0
    if forced(states['model'],slot):
        action,reason='SELL' if D(states['model']['btc']) else 'HOLD','DAY_CLOSE'
    elif not key:
        reason='MODEL_KEY_UNAVAILABLE'
    elif (policy == COST_VERSION and snapshot and clock() < slot+90 and not D(states['model']['btc'])
          and not range_covers_cost(snapshot, snapshot['book'])):
        reason = 'Stundenbandbreite deckt die Handelskosten nicht.'
    elif snapshot and clock() < slot+90:
        # A separately committed slot reservation already records possible request intent.
        try:
            context = {'policy':VERSION,'slotUtc':iso(slot),'market':snapshot,
                'portfolio':mark(states['model'],snapshot['book']),'recent':history[::-1],
                'initialEur':1000,'entryBudgetEur':100,'feeBpsPerSide':50,'slippageBpsPerSide':10}
            if policy in (CHALLENGER_VERSION, COST_VERSION):
                context.update(policy=policy, executionContext=challenger_inputs(snapshot, states['model'], slot))
                del context['recent']
            if policy == COST_VERSION and D(states['model']['btc']):
                state = states['model']
                cost_basis = D(state['entryCostEur'])
                quantity = D(state['btc'])
                context['position'] = dict(entryCostEur=float(cost_basis), minutesHeld=(slot-state['opened'])//60,
                    liquidationPnlEur=float(quantity * D(str(snapshot['book']['bid'])) * (1-SLIP)*(1-FEE) - cost_basis)
                    if context['executionContext']['bidCoversPosition'] else None)
            action,reason,usage=feeds.decide(context, model, key)
            if action not in ('BUY','SELL','HOLD') or not isinstance(reason,str) or not reason.strip():
                raise ValueError('invalid decision')
            cost=estimate_cost(usage,rates)
        except Exception as exc:
            usage=getattr(exc,'usage',None)
            action = 'HOLD'
            reason = f'MODEL_UNAVAILABLE: {model_failure(exc)}'
            cost = estimate_cost(usage, rates)
    elif snapshot:
        reason='DECISION_WINDOW_EXPIRED'
    ref=reference(snapshot['ten'],states['reference']) if snapshot else 'HOLD'
    if forced(states['reference'],slot):
        ref='SELL' if D(states['reference']['btc']) else 'HOLD'
    # Always obtain a new executable book after the decision, independently of the signal feed.
    try:
        book=feeds.book()
        book_status = 'OK' if book else 'NO_BOOK'
    except Exception as exc:
        book=None
        book_status = book_failure(exc)
    now=clock()
    if book and any(not 0 <= now-book[field] <= 5 for field in ('received','bidAt','askAt')):
        book=None
        book_status = 'BOOK_TIME_INVALID_AT_FILL'
    in_slot=slot <= now < slot+STEP
    executable=book if in_slot else None
    def fill(name, desired):
        if not forced(states[name],slot) and now>=slot+90 and desired!='HOLD':
            return 'DECISION_WINDOW_EXPIRED'
        return execute(states[name],desired,executable,slot)
    if policy == COST_VERSION and action == 'BUY' and executable and not range_covers_cost(snapshot, executable):
        action, reason = 'HOLD', 'Aktuelles Orderbuch deckt die Gewinnschwelle im Stundenband nicht.'
    cash_before = D(states['model']['cash'])
    execution=fill('model',action)
    if policy == COST_VERSION:
        if execution == 'PAPER_BUY':
            states['model']['entryCostEur'] = str(cash_before - D(states['model']['cash']))
        elif execution == 'PAPER_SELL':
            states['model'].pop('entryCostEur', None)
    ref_execution=fill('reference',ref)
    last=dict(at=iso(now),action=action,reason=reason,execution=execution)
    prior_cost=previous.get('report',{}).get('apiCostEur',0)
    pending=db.execute('SELECT count(*) FROM slots WHERE slot < ? AND record IS NULL',(slot,)).fetchone()[0]
    total=None if pending or cost is None or prior_cost is None else prior_cost+cost
    report=dict(schema='MERIDIAN_ADVISOR_V1',asOf=iso(now),model=model,arms={k:mark(v,book) for k,v in states.items()},
                last=last,apiCostEur=total)
    record=dict(version=VERSION,promptVersion=policy,promptDigest=digest,marketStatus=market_status,slot=slot,states=states,report=report,inputs=snapshot,executionBook=book,
                executionBookStatus=book_status,
                referenceAction=ref,referenceExecution=ref_execution,usage=usage,slotApiCostEur=cost,pendingSlots=pending)
    with db:
        db.execute('UPDATE slots SET record=? WHERE slot=?',(json.dumps(record,allow_nan=False),slot))
    return report


def main():
    import feeds
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,required=True)
    policies = parser.add_mutually_exclusive_group()
    policies.add_argument('--cost-aware', action='store_true', help='Use the isolated v3 cost-aware policy')
    policies.add_argument('--challenger', action='store_true', help='Use the v2 decision policy in a separate directory')
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    key=os.environ.get('OPENAI_API_KEY')
    model=os.environ.get('MERIDIAN_OPENAI_MODEL')
    if not model:
        parser.error('set MERIDIAN_OPENAI_MODEL to a pinned model version')
    if not key and not (args.directory/'advisor.sqlite').is_file():
        parser.error('set OPENAI_API_KEY before starting a new model account')
    rates=None
    raw=os.environ.get('MERIDIAN_EUR_PER_MILLION')
    if raw:
        rates=list(map(float,raw.split(',')))
        if len(rates)!=3 or not all(math.isfinite(v) and v>=0 for v in rates):
            parser.error('supply input,cached-input,output EUR per million tokens')
    args.directory.mkdir(parents=True,exist_ok=True)
    with (args.directory/'writer.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        db=connect(args.directory/'advisor.sqlite',model,challenger=args.challenger, cost_aware=args.cost_aware)
        while True:
            slot=int(time.time())//STEP*STEP
            cycle(db,slot,model,key,feeds,rates)
            saved=db.execute('SELECT record FROM slots WHERE record IS NOT NULL ORDER BY slot DESC LIMIT 1').fetchone()
            if saved:
                tmp=args.directory/'report.tmp'
                tmp.write_text(json.dumps(json.loads(saved[0])['report'],ensure_ascii=False))
                tmp.replace(args.directory/'report.json')
            if args.once:
                break
            time.sleep(max(.1,slot+STEP-time.time()))


if __name__=='__main__':
    main()
