# BTC/EUR paired paper diagnostic 001: verified post-run receipt

## Run and verification

| Field | Recorded value |
| --- | --- |
| Run ID | `btc-eur-paired-diag-20261110-001` |
| Source commit | `ae924141854362257738322ac9a1022cd47e0b02` |
| Account and model pair | `BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2` / `BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1` |
| Report evaluation | `VERIFIED_COMPLETE` / `TERMINAL_REPORT_RECONCILED` |
| Cycles and stop reason | 479 completed of 479 attempted / `DURATION_LIMIT` |
| SHA-256 of host-export bytes | `2bd635067b3c2f7a80daed4213eb641e864baea72fb508370a51f36675cfc7a3` |

The one-shot Northflank reader used build `curvy-coach-4375` and a copy of the
original evidence volume. It opened the exact terminal export, required
`TERMINAL_JOURNAL_VERIFIED` and `READ_ONLY_VERIFIED`, then evaluated the export
against the independently pinned
[expected identity](receipts/btc-eur-paired-diag-20261110-001.expected-identity.json).
Only the aggregate metrics, verifier status and raw-export SHA-256 were emitted
to the project logs. The temporary reader and copied volume were removed after
verification. The original evidence remains on the original volume.

## Paper observations

All amounts are EUR. Each account started with €1,000 and ended flat. A fill
is one simulated execution. The evaluator reports sampled equity drawdown.

| Arm | Fills | Net P&L | Booked modeled fees | Sampled drawdown | Final equity |
| --- | ---: | ---: | ---: | ---: | ---: |
| CONFIRM2 baseline | 20 | −6.05 | 4.00 | 6.43 | 993.95 |
| CONFIRM2 + 5-minute trend filter | 8 | −2.22 | 1.60 | 2.22 | 997.78 |
| Cash control | 0 | 0.00 | 0.00 | 0.00 | 1000.00 |

The challenger had 12 fewer fills and a €3.83 smaller net loss than the
baseline. Cash had the highest final equity in this window. Booked fees are
already reflected in net P&L. The run used modeled assumptions of 20 bp fee
and 10 bp slippage per side. This is a single paper observation with
`NO_WINNER_OR_PROMOTION` qualification.

## Dashboard handoff

On 2026-11-16 the full evaluator DTO was transferred privately and inserted
into the immutable report store. The dry run and database readback matched on
run ID, canonical content, and this ingester digest:

`b6edebbbc18bcf909a851a3630153d82e2e8802e99b376c28a1e1d5a4aaa8831`

The digest covers the report envelope. The host-export SHA-256 above covers
the raw export. [PR #1380](https://github.com/Achi1984/meridian/pull/1380)
added a targeted fallback for the interrupted `btc-eur-trend-host-8h-002`
selection when its final row is missing. The production gateway returned
HTTP 200 and `VERIFIED_COMPLETE` for diagnostic 001 in the authorized handler
check. The authenticated Meridian V11 strategy view displayed diagnostic 001
and all three comparison arms under **Gepaarter Paper-Vergleich**. It reported
479 completed cycles and 7 h 59 min 30 s of common data coverage.

## Follow-up paper test

Repeat the same two model configurations and cash control with unchanged
cost assumptions on a new paper window. Assign a fresh run identity and
isolated volume. Before a writer is started, capture the immutable
repository-qualified image reference, exclusive host evidence, canonical
mount and runtime-user readback, and a bounded SIGTERM drill. Verify those
exact artifacts using the [offline preflight](BTC_EUR_OFFLINE_PREFLIGHT.md).
