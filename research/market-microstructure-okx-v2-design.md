# MERIDIAN Market Microstructure — OKX Source Audit V2

Status: PREDECLARED / RESEARCH ONLY / NO PROMOTION  
Declared: 2026-09-06, before the first OKX evidence run

## Decision scope

This audit tests whether unauthenticated, official OKX public REST data can form a reproducible data foundation for future microstructure research. It is a venue-specific source audit, not a replacement or proxy for Binance data and not an alpha test.

No result may affect Baseline 6.2.0 / 6.2-SIGNAL-V1, Paper, live execution, Pionex bots, `server.js`, position sizing, entries, exits, or promotion state.

## Locked universe and cutoff

- Instruments: BTC-USDT-SWAP, ETH-USDT-SWAP, SOL-USDT-SWAP, XRP-USDT-SWAP, ADA-USDT-SWAP, AVAX-USDT-SWAP, LINK-USDT-SWAP
- Cutoff: most recent fully closed UTC hour at run time
- No symbol removal after results
- No interpolation, forward fill, synthetic values, or cross-venue substitution

## Official endpoints under audit

| Feature | Endpoint | Requested history | Canonical timestamp / conservative availability |
|---|---|---:|---|
| Funding | `/api/v5/public/funding-rate-history` | 90 days | `fundingTime` / `fundingTime` |
| Open interest | `/api/v5/rubik/stat/contracts/open-interest-history` | 30 days, 1H | returned `ts` / `ts + 1H` |
| Taker flow | `/api/v5/rubik/stat/taker-volume` | 30 days, 1H | returned `ts` / `ts + 1H` |

The audit must record HTTP status, OKX response code/message, schema validity, requested range, actual returned range, pagination behavior, row counts, raw SHA-256 and normalized SHA-256. An endpoint requiring authentication, rejecting the GitHub runner, or returning insufficient public history fails explicitly; no bypass, proxy or alternate venue is permitted.

## Predeclared quality gates

All seven instruments must pass a feature independently before that feature is research-ready.

### Funding

- coverage >= 90% of observations expected from the observed median cadence over 90 days
- numeric funding rate and timestamp
- no duplicate canonical timestamps
- strictly monotonic normalized timestamps
- no gap greater than 2x observed median cadence
- latest observation no older than 2x observed median cadence at cutoff

### Open interest and taker flow

- hourly coverage >= 95% over 30 days
- numeric required fields and timestamp
- no duplicate canonical timestamps
- strictly monotonic normalized timestamps
- no gap greater than 2 hours
- latest observation no older than 2 hours at cutoff

For taker flow, OKX `sellVol` and `buyVol` must remain separately preserved; no inferred side is invented. For open interest, the returned native OI fields are preserved without cross-instrument unit aggregation.

## Frozen decision rule

- A feature is `ready` only if every locked instrument passes every gate.
- An alpha experiment is not permitted by this audit alone, even if all features pass.
- Data-quality success is not alpha evidence and never implies promotion.
- If coverage or transport fails, threshold tuning, shorter post-result windows, asset deletion and silent fallbacks are forbidden.
- A later experiment, if separately predeclared, must identify the evidence as OKX-derived and must evaluate performance plus opportunity count, LONG/SHORT x regime, asset concentration, drawdown, sample adequacy and chronological walk-forward OOS.
