"""Offline research only: closed 4h candles, fixed universe, no orders/state writes."""
import argparse
import hashlib
import itertools
import json
import warnings
from pathlib import Path

import numpy as np
from statsmodels.tsa.stattools import adfuller, coint

SYMBOLS = ('BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'DOGEUSDT')
WINDOWS = (250, 500, 750)
INTERVAL = 14400000
FAMILY = 28 * len(WINDOWS)


def validate(data):
    """Reject gaps, duplicates, mismatched timestamps, future or unfinished candles."""
    series = data['series']
    if set(series) != set(SYMBOLS):
        raise ValueError('Fixed eight-symbol universe required')
    reference = None
    for symbol in SYMBOLS:
        rows = np.asarray(series[symbol], dtype=float)
        if rows.ndim != 2 or rows.shape[1] != 2 or len(rows) < 751 or not np.isfinite(rows).all():
            raise ValueError(f'{symbol}: invalid history')
        times = rows[:, 0]
        if (rows[:, 1] <= 0).any() or not np.all(np.diff(times) == INTERVAL):
            raise ValueError(f'{symbol}: invalid prices or candle gaps')
        if times[-1] + INTERVAL > data['asOf'] or data['asOf'] - times[-1] >= 2 * INTERVAL:
            raise ValueError(f'{symbol}: unfinished or stale history')
        if reference is not None and not np.array_equal(reference, times):
            raise ValueError('Unaligned histories')
        reference = times


def estimate(y, x, n):
    # Latest candle is evaluation-only: never included in fit or residual scale.
    yt, xt = y[-n-1:-1], x[-n-1:-1]
    alpha, beta = np.linalg.lstsq(np.column_stack([np.ones(n), xt]), yt, rcond=None)[0]
    residual = yt - alpha - beta * xt
    scale = residual.std(ddof=2)
    if scale < 1e-8:
        raise ValueError('Degenerate residual variance')
    with warnings.catch_warnings():
        warnings.simplefilter('error')
        _, p, _ = coint(yt, xt, trend='c', maxlag=12, autolag='aic')
        integrated = all(adfuller(v, maxlag=12, autolag='AIC')[1] > .05 and
                         adfuller(np.diff(v), maxlag=12, autolag='AIC')[1] < .01 for v in (yt, xt))
    return dict(observations=n, beta=float(beta), pAdjusted=min(1., float(p)*FAMILY),
                integrated=bool(integrated), z=float((y[-1]-alpha-beta*x[-1])/scale),
                residual=float(y[-1]-alpha-beta*x[-1]))


def scan(data, costs_bps):
    validate(data)
    if not np.isfinite(costs_bps) or costs_bps <= 0:
        raise ValueError('Positive all-in round-trip cost assumption required')
    results = []
    for a, b in itertools.combinations(SYMBOLS, 2):
        row = dict(pair=[a, b], eligible=False)
        try:
            windows = [estimate(np.log(np.asarray(data['series'][a])[:, 1]),
                                np.log(np.asarray(data['series'][b])[:, 1]), n) for n in WINDOWS]
            betas = [w['beta'] for w in windows]
            stable = min(betas) > 0 and max(betas)/min(betas) <= 1.25
            reasons = []
            if not all(w['integrated'] for w in windows): reasons.append('I1_ASSUMPTION_FAILED')
            if not all(w['pAdjusted'] <= .01 for w in windows): reasons.append('COINTEGRATION_NOT_ROBUST')
            if not stable: reasons.append('HEDGE_UNSTABLE')
            if not (all(2.5 <= w['z'] <= 4 for w in windows) or all(-4 <= w['z'] <= -2.5 for w in windows)):
                reasons.append('NO_CONSISTENT_ENTRY')
            # Scenario only: full residual convergence, normalized to gross dollars.
            # This is NOT an expected return or executable-price backtest.
            edge = min(abs(w['residual'])/(1+abs(w['beta']))*10000 for w in windows)
            if edge <= 2*costs_bps: reasons.append('INSUFFICIENT_COST_BUFFER')
            row.update(windows=windows, convergenceScenarioBps=edge,
                       reasons=reasons, eligible=not reasons)
        except (ValueError, Warning, np.linalg.LinAlgError) as exc:
            row['reasons'] = ['ESTIMATION_FAILED: '+str(exc)]
        results.append(row)
    return dict(policy='PAIRS-OFFLINE-V1', executionImpact=False, asOf=data['asOf'],
                hypotheses=FAMILY, correction='Bonferroni across fixed 28 pairs x 3 windows',
                roundTripCostsBps=costs_bps, candidates=results,
                limitation='Screen only; no profitability claim, live adapter or automatic activation')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('--costs-bps', type=float, required=True)
    args = parser.parse_args()
    raw = Path(args.input).read_bytes()
    result = scan(json.loads(raw), args.costs_bps)
    result['inputSha256'] = hashlib.sha256(raw).hexdigest()
    print(json.dumps(result, indent=2, allow_nan=False))
