# MERIDIAN v7.79 — Prospective Holdout Lock

Research-only. No Paper/live execution impact.

## Locked before future outcomes mature

- holdout start: `2026-09-04T20:02:00Z`
- context: `LONG|TRANSITION|NORMAL`
- family source: `SIDE_REGIME_VOLATILITY`
- outcome horizon: 14 days
- minimum matured context signals before review: 30
- assets: BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET, INJ

The hypothesis, start timestamp, horizon and minimum sample are immutable for v7.79. If any of them changes, create a new holdout version/date rather than rewriting this one.

## Initial run

- workflow run: `33914265671`
- source commit: `2d6b53a5902c2f502c1906c48dccdc3ff3e94657`
- artifact: `9952541531`
- artifact SHA-256: `9cd51d20bdccf724d589e6593b38304f9bc9d7d16a38139ed041f6773f388a98`
- Release Safety: passed

Expected initial state:
- matured universe: 0
- matured locked-context signals: 0
- status: `WAITING_FOR_MATURED_SAMPLE`

This is correct because the configured outcome horizon is 14 days and the holdout started only minutes before the first run.

## Decision

No further historical threshold/context tuning should be used to claim edge for this hypothesis. Wait for genuinely post-lock, fully matured observations. Promotion remains disabled and requires explicit human review even after the sample threshold is reached.
