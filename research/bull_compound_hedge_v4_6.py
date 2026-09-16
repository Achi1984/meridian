#!/usr/bin/env python3
"""MERIDIAN Bull Compound v0.4.6 — full-coverage funding proxy + margin audit.

Uses Binance Vision COIN-M BTCUSD_PERP funding whenever archived; for earlier
months missing from the COIN-M Vision archive, fills only those timestamps from
Binance USD-M BTCUSDT funding. The overlap is measured so the proxy substitution
is visible rather than hidden. Hedge rules remain frozen from v0.4.1.
"""
from __future__ import annotations

import csv, io, json, urllib.error, urllib.request, zipfile
from datetime import date, datetime, timezone
from pathlib import Path

import bull_compound_backtest as base
import bull_compound_backtest_v3 as ohlcmod
import bull_compound_hedge_v4_5 as v45

START='2020-05-12'; END='2025-12-31'


def fetch_archive(market,symbol,start=START,end=END):
    rows=[];loaded=[];missing=[]
    for ym in v45.month_keys(start[:7],end[:7]):
        url=(f'https://data.binance.vision/data/futures/{market}/monthly/fundingRate/'
             f'{symbol}/{symbol}-fundingRate-{ym}.zip')
        req=urllib.request.Request(url,headers={'User-Agent':'MERIDIAN-RESEARCH/0.4.6'})
        try:
            with urllib.request.urlopen(req,timeout=60) as r:raw=r.read()
        except urllib.error.HTTPError as e:
            if e.code==404:
                missing.append(ym);continue
            raise
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            text=z.read(z.namelist()[0]).decode('utf-8-sig')
        got=0
        for row in csv.reader(io.StringIO(text)):
            x=v45.parse_funding_row(row)
            if x and start<=x['date']<=end:
                rows.append(x);got+=1
        (loaded if got else missing).append(ym)
    rows.sort(key=lambda x:x['time'])
    return rows,loaded,missing


def hybrid_funding():
    cm,cm_loaded,cm_missing=fetch_archive('cm','BTCUSD_PERP')
    um,um_loaded,um_missing=fetch_archive('um','BTCUSDT')
    cm_map={x['time']:x for x in cm};um_map={x['time']:x for x in um}
    hybrid=[];cm_used=0;um_used=0
    for t in sorted(set(cm_map)|set(um_map)):
        if t in cm_map:
            hybrid.append(cm_map[t]);cm_used+=1
        else:
            hybrid.append(um_map[t]);um_used+=1
    overlap=sorted(set(cm_map)&set(um_map))
    diffs=[abs(cm_map[t]['rate']-um_map[t]['rate']) for t in overlap]
    signed=[cm_map[t]['rate']-um_map[t]['rate'] for t in overlap]
    days={x['date'] for x in hybrid}
    d0=date.fromisoformat(START);d1=date.fromisoformat(END);total_days=(d1-d0).days+1
    stats={
        'cm_events':len(cm),'um_events':len(um),'hybrid_events':len(hybrid),
        'cm_months_loaded':len(set(cm_loaded)),'cm_first':cm[0]['date'] if cm else None,'cm_last':cm[-1]['date'] if cm else None,
        'um_months_loaded':len(set(um_loaded)),'um_first':um[0]['date'] if um else None,'um_last':um[-1]['date'] if um else None,
        'cm_events_used':cm_used,'um_fallback_events_used':um_used,
        'coverage_days':len(days),'total_calendar_days':total_days,'coverage_pct':len(days)/total_days*100,
        'overlap_events':len(overlap),'overlap_mean_abs_rate_diff':sum(diffs)/len(diffs) if diffs else None,
        'overlap_mean_signed_cm_minus_um':sum(signed)/len(signed) if signed else None,
        'cm_missing_months':cm_missing,'um_missing_months':um_missing,
    }
    if stats['coverage_pct']<95:raise RuntimeError(f"funding coverage too low: {stats['coverage_pct']:.1f}%")
    return hybrid,stats


def current_margin_matrix():
    _,_,obs_liq_up,_=v45.calibration()
    current_stop_up=83200/75784.8-1
    rows=[]
    for L in (7.0,8.0,v45.OBS_SHORT_NOTIONAL_BTC/v45.OBS_SHORT_TOTAL_MARGIN_BTC):
        short_margin=0.20/L
        _,_,_,haircut=v45.calibration();liq_up=v45.liq_distance_for_leverage(L,haircut)
        rows.append({'short_effective_leverage':L,'short_margin_btc':short_margin,
                     'additional_short_margin_vs_current':max(0,short_margin-v45.OBS_SHORT_TOTAL_MARGIN_BTC),
                     'modeled_liq_up_pct':liq_up*100,'buffer_vs_strategy_12pct_stop_pp':(liq_up-v45.STOP_UP)*100})
    return {'rows':rows,
            'current_actual_stop_up_pct':current_stop_up*100,
            'current_observed_liq_up_pct':obs_liq_up*100,
            'current_actual_stop_to_liq_buffer_pp':(obs_liq_up-current_stop_up)*100,
            'current_4x_long_margin_btc':v45.OBS_LONG_MARGIN_BTC,
            'current_combined_margin_btc':v45.OBS_LONG_MARGIN_BTC+v45.OBS_SHORT_TOTAL_MARGIN_BTC}


def main():
    ds,op,hi,lo,cl=ohlcmod.fetch_ohlc();e200=base.ema(cl,200);r14=base.rsi(cl,14)
    funding,coverage=hybrid_funding();fday=v45.funding_by_day(funding)
    tr0,tr1='2020-05-12','2022-12-31';va0,va1='2023-01-01','2025-12-31'
    curL=v45.OBS_SHORT_NOTIONAL_BTC/v45.OBS_SHORT_TOTAL_MARGIN_BTC
    tests=[]
    for L in (7.0,8.0,curL):
        for fm in ('eod','conservative'):
            tests.append({'train':v45.sim(ds,op,hi,lo,cl,e200,r14,fday,tr0,tr1,L,fm),
                          'oos':v45.sim(ds,op,hi,lo,cl,e200,r14,fday,va0,va1,L,fm),
                          'continuous':v45.sim(ds,op,hi,lo,cl,e200,r14,fday,tr0,va1,L,fm)})
    out={'method':{'name':'MERIDIAN Bull Compound v0.4.6 Full-Coverage Funding Proxy Audit',
                   'funding':'COIN-M BTCUSD_PERP when archived; USD-M BTCUSDT fallback for missing COIN-M archive history',
                   'fees_bps':v45.FEE*10000,'slippage_bps':v45.SLIP*10000},
         'funding_coverage':coverage,'tests':tests,'margin_matrix':current_margin_matrix(),
         'long_grid_snapshot_stress':v45.long_snapshot_stress(),
         'baseline_without_funding_v4_1':{'train_btc':1.01863,'oos_btc':0.98438,'continuous_btc':1.03912}}
    Path('bull-compound-hedge-v4-6.json').write_text(json.dumps(out,indent=2),encoding='utf-8')

    lines=['# MERIDIAN Bull Compound v0.4.6 — full-coverage funding + margin audit','',
           '> Frozen 20% hedge rules. COIN-M funding is used where archived; missing early COIN-M archive timestamps are filled from BTCUSDT USD-M and the overlap difference is reported.','',
           '## Funding coverage',
           f"Hybrid events: **{coverage['hybrid_events']}**; calendar-day coverage **{coverage['coverage_pct']:.2f}%**. COIN-M archive: {coverage['cm_first']} → {coverage['cm_last']} ({coverage['cm_months_loaded']} months). USD-M fallback events used: **{coverage['um_fallback_events_used']}**.",
           f"Where both exist, mean absolute funding-rate difference: **{coverage['overlap_mean_abs_rate_diff']:.8f}** per funding event.",'',
           '## Continuous 2020–2025','| Short eff. leverage | Funding treatment | BTC end | vs HODL | Funding BTC | Liq buffer above strategy +12% SL | Liquidations |','|---:|---|---:|---:|---:|---:|---:|']
    for x in tests:
        r=x['continuous'];lines.append(f"| {r['effective_short_leverage']:.2f}x | {r['funding_mode']} | {r['total_btc']:.5f} | {r['relative_to_hodl_btc_pct']:+.2f}% | {r['funding_btc']:+.5f} | {r['stop_to_liq_buffer_pct']:+.2f} pp | {r['liquidations']} |")
    lines+=['','## OOS 2023–2025','| Short eff. leverage | Funding treatment | BTC end | vs HODL | Funding BTC | Stops | Liq | Max DD |','|---:|---|---:|---:|---:|---:|---:|---:|']
    for x in tests:
        r=x['oos'];lines.append(f"| {r['effective_short_leverage']:.2f}x | {r['funding_mode']} | {r['total_btc']:.5f} | {r['relative_to_hodl_btc_pct']:+.2f}% | {r['funding_btc']:+.5f} | {r['stops']} | {r['liquidations']} | {r['max_drawdown_pct']:.2f}% |")
    mm=out['margin_matrix'];lines+=['','## Current live-margin diagnostics',
        f"Observed current short SL is +{mm['current_actual_stop_up_pct']:.2f}% from entry and observed liquidation is +{mm['current_observed_liq_up_pct']:.2f}%, leaving **{mm['current_actual_stop_to_liq_buffer_pp']:.2f} percentage points** of price buffer.",
        f"Current 4x long margin + current short total margin = **{mm['current_combined_margin_btc']:.5f} BTC**.",
        '| Short effective leverage | Short margin for 0.20 BTC notional | Extra margin vs current | Buffer vs strategy +12% SL |','|---:|---:|---:|---:|']
    for r in mm['rows']:lines.append(f"| {r['short_effective_leverage']:.2f}x | {r['short_margin_btc']:.5f} BTC | {r['additional_short_margin_vs_current']:.5f} BTC | {r['buffer_vs_strategy_12pct_stop_pp']:+.2f} pp |")
    ls=out['long_grid_snapshot_stress'];lines+=['','## Current 4x long-grid snapshot sensitivity','Snapshot calibration only — not a full Pionex grid liquidation engine.','| Target long liquidation | Est. total long margin | Est. extra vs 0.0492 BTC |','|---:|---:|---:|']
    for r in ls['rows']:lines.append(f"| ${r['target_liq']:,.0f} | {r['estimated_total_margin_btc']:.5f} BTC | {r['estimated_additional_margin_btc']:.5f} BTC |")
    Path('bull-compound-hedge-v4-6.md').write_text('\n'.join(lines)+'\n',encoding='utf-8');print('\n'.join(lines))

if __name__=='__main__':main()
