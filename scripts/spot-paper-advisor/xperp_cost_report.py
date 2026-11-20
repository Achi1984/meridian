"""Compare settled v3/X-Perps paper trades at two spot fees, using the recorded fills."""
import argparse
import json
import sqlite3
from contextlib import closing
from decimal import Decimal as D
from pathlib import Path

from xperp_pair import FEE, SLIP


def attribution(opening, close, spot_buy, spot_sell):
    spot_qty = D(spot_buy['states']['v3']['btc'])
    spot_entry = D(str(spot_buy['fillBook']['ask'])) * (1 + SLIP)
    spot_exit = D(str(spot_sell['fillBook']['bid'])) * (1 - SLIP)
    perp_entry, perp_exit = D(opening['price']), D(close['price'])
    perp_qty = D(opening['executedUsd']) / perp_entry
    perp_fees = perp_qty * (perp_entry + perp_exit) * FEE
    funding = D(close['fundingUsd'])
    perp_net = D(close['netUsd'])
    spot_move = spot_exit - spot_entry
    execution = perp_qty * ((perp_exit - perp_entry) - spot_move)
    size_effect = (perp_qty - spot_qty) * spot_move
    rows = []
    for bps in (20, 10):
        spot_fees = spot_qty * (spot_entry + spot_exit) * bps / 10000
        spot_net = spot_qty * spot_move - spot_fees
        delta = perp_net - spot_net
        savings = spot_fees - perp_fees
        if abs(delta - (execution + size_effect + savings - funding)) > D('.000001'):
            raise ValueError('paired PnL does not reconcile with recorded fills')
        rows.append(dict(spotFeeBps=bps, spotNetUsd=float(spot_net), futuresNetUsd=float(perp_net),
                         futuresMinusSpotUsd=float(delta), executionEffectUsd=float(execution),
                         sizeEffectUsd=float(size_effect), feeSavingsUsd=float(savings),
                         fundingEffectUsd=float(-funding)))
    return rows


def report(db):
    pending = unmatched = observed = 0
    trades = []
    entry = None
    last_slot = None
    for slot, event, data, spot in db.execute("""
        select o.slot,o.event,o.data,s.record from observations o
        left join spot.slots s on s.slot=o.slot order by o.slot
    """):
        observed += 1
        last_slot = slot
        row = json.loads(data)
        if event == 'PAPER_BUY':
            entry = (slot,row,spot)
        elif event == 'PAPER_SELL':
            if row['status'] == 'FUNDING_PENDING':
                pending += 1
            elif (entry and entry[1]['status']=='FILLED' and row['status']=='FILLED'
                  and row['entryTs']==entry[1]['ts'] and entry[2] and spot):
                fees = attribution(entry[1],row,json.loads(entry[2]),json.loads(spot))
                trades.append(dict(entrySlot=entry[0],exitSlot=slot,scenarios=fees))
            else:
                unmatched += 1
            entry = None
    return dict(observed=observed, lastSlot=last_slot, pairedClosed=len(trades), fundingPending=pending,
                unmatchedCloses=unmatched, openPaired=bool(entry and entry[1]['status']=='FILLED'), trades=trades)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    directory = parser.parse_args().directory.resolve()
    with closing(sqlite3.connect((directory/'xperp.sqlite').as_uri()+'?mode=ro',uri=True)) as db:
        db.execute('attach database ? as spot', ((directory/'round.sqlite').as_uri()+'?mode=ro',))
        print(json.dumps(report(db),allow_nan=False))
