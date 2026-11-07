# BTC/EUR paper run 42395522899 — retained evidence reconciliation

## Result

**Reconciled bounded paper run; signal replay PASS; profitability NOT_ASSESSED.**
The original assessment is retained unchanged and continues to report
`signalReplay: NOT_PERFORMED`.

The downloaded artifact is run `42395522899`, attempt 1, artifact
`13585515926` (`spot-paper-pilot-42395522899-1`), 864,609 bytes,
SHA-256 `9523a42d2b725a360425ff7452715b12a8b5e16b12b91995c617b3c38c3aebb4`.
All 128 entries in its `SHA256SUMS` verified. All 120 unique response
references in the retained readback resolve to present raw files with matching
lengths and SHA-256 digests (3,404,502 bytes total). A fresh read-only report
reconstruction from the archived journal exactly matches the retained
readback.

| Retained report field | Reconciled value |
|---|---:|
| Outcome / classification | `COMPLETED` / `PARTIAL_BOUNDED_RUN` |
| Terminal verified / execution impact | `true` / `false` |
| Start to terminal | 2026-11-07 17:17:05.679–18:16:08.581 UTC; 3,542,902 ms (59m 2.902s) |
| Bounded coverage | 60 accepted observations, 0 gaps, 120 requests; 98.41% duration coverage |
| Data / quote accounting | `DATA_ACCEPTED` / reconciled |
| Signals / fills | 8 signals; 7 fills (4 BUY, 3 SELL) |
| Fees / observed fill turnover | 350¢ / 69,593¢ (€695.93), summed from the seven retained fills |
| Realized / unrealized PnL | -357¢ / -118¢ |
| Terminal cash / equity | 89,643¢ / 99,525¢ |
| Terminal inventory | 146,122 sat; `OPEN_UNRESOLVED_AT_TERMINAL`; fresh mark age 8 ms |
| Stop reason | `CYCLE_LIMIT` |

This was not a full-hour observation: it stopped at the 60-cycle bound, before
the configured 3,600,000 ms duration. The terminal position remains open; it
was not closed or resumed for this reconciliation. The replay validates only
the retained signal claims, startup cutoff, and checked fill quote causality.
It does not validate profitability, strategy quality, or a full-hour run.

## Offline replay provenance

The replay returned `PASS` for identity, signal replay, fill causality, and
startup cutoff: 8 signals replayed, no sampled stop fills, no discrepancies.
The pinned identity is accepted source
`81edf0b5dc3d455c2c1e1906791d56c731bea0c9`, workflow
`ddae14f01583196dfc9e9da906dcd03d41d58369`, run
`spot-paper-42395522899-1`, model `BTC_EUR_SMA5_SMA20_V1`.

The compact structured result and its input digests are recorded in
[`research/results/spot-paper-pilot-42395522899-1-signal-replay.json`](../../research/results/spot-paper-pilot-42395522899-1-signal-replay.json).
The result is an additional offline record; it does not overwrite the retained
artifact or original assessment.

## Next bounded experiment proposal — not authorization

If separately authorized, use a **fresh workflow run, unique run ID, fresh
manifest, and new retained artifact**. Do not rerun or resume the consumed
run/attempt. Keep it paper-only and within the currently supported limits:
60 cycles, at most 3,600,000 ms, 60-second polling, at most 120 requests, and
the existing 50 bps-per-side fee and other manifest risk limits. The present
run's fee was 350¢ over 69,593¢ of gross fill turnover; an ex-post, fixed-fill
fee-only sensitivity at 25/50/75 bps is 175/350/523¢ respectively, rounding
each fill's fee half-up to cents. That arithmetic must not be presented as
counterfactual fills or strategy performance.

Predeclare success as complete terminal/readback verification, 60 accepted
observations with no data gaps, reconciled per-fill fees and turnover, and
explicit reporting of actual elapsed time and any terminal inventory. A fresh
mark is required if inventory remains open; do not force-close it. The
experiment is not a profitability test, and a 60-cycle termination must not
be called a full-hour observation. This proposal authorizes no run, provider
call, scheduler, workflow change, runtime change, or live trading. Any change
needed to support a different bound or the one-shot workflow gate requires
separate scope and authorization.
