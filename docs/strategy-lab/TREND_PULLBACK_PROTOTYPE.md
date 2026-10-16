# P1 daily trend pullback: pure signal prototype

`evaluateTrendPullback({bars, asOfMs, position})` accepts exactly 201 consecutive normalized UTC daily bars. Fields match normalize-binance-daily.mjs. All bars must be closed and received by asOfMs; receipt timestamps must be monotonic. The most recent close must be less than one day old. A missing day, extra future bar, malformed OHLCV or unknown schema rejects the entire input. Historical archives received today cannot be relabelled as historically available merely to satisfy this contract.

SMA200 includes the latest 200 closes. Negative-scale %R10 uses completed ten-day high/low windows at t-1 and t. ATR14 is the arithmetic mean of 14 completed true ranges including t, each compared with its preceding close. No Wilder smoothing. Zero-range %R is null and prevents entry.

Flat state is `position:null`. Entry candidate requires close>SMA200, previous %R<=-80 and -80<current %R<-20. Proposed initial stop is current low minus half ATR14; invalid stop rejects the candidate. This is a price-level proposal, not verified EUR risk, sizing or fill. No fixed reward/risk target is imposed by this signal module.

Open state is `{entryAtMs}` supplied by the caller. It must lie within the observed window and not in the future. An existing position exits on close<SMA200, %R>=-20 or ten daily closes strictly after the fill time. Equality to SMA200 neither opens nor forces exit. At a close-time fill boundary that just-completed candle does not count as a held bar. Protective stops are not simulated here: tick/quote execution and actual position state belong to a later engine.

Exit conditions take precedence over fresh entries; an existing position never produces an entry. Stateless calls cannot enforce persistent no-reentry or replay protection: the future engine must retain exited signal IDs and actual fills. It must not call with a fabricated flat state to reopen on a consumed bar. `signalAvailableAtMs` is at least the supplied evaluation time; a downstream quote/fill must occur strictly afterward, with sizing, costs, FX and instrument eligibility separately checked.

Outputs always have executionAuthorized=false and researchOnly=true. No I/O, scheduler, strategy backtest, PnL, allocation or live integration exists in this module. The existing fixed3:1 campaign policy still needs its own reviewed migration. Do not treat pure signal permission flags as a security boundary.

Validation: synthetic tests cover crossing, direct jump into exit region, position exits, holding boundaries, trend exit, incomplete/unreceived bars, gaps/duplicates, stale data, zero ranges, malformed state/nonfinite data and extra future input. These are correctness checks, not strategy validation. No real historical strategy evaluation was performed.
