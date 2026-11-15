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

This receipt stores aggregate observations. The immutable paired-report
ingester expects the full evaluator DTO and the separately pinned exact-run
identity. The raw-export hash above is distinct from the canonical ingester
digest. The DTO was evaluated inside Northflank and was not retained as a
file for ingestion. There is no ingestion or authenticated dashboard
readback receipt for this run.

Retrieve the complete validated DTO through a private transfer from the
retained evidence, dry-run the ingester with the exact identity, and retain
its run ID and digest. An operator can then approve a single immutable
insert and compare the resulting authenticated readback with the dry run.
Use the sequence in the [finalization runbook](../strategy-lab/paired-finalization/RUNBOOK.md)
with the exact identity above; that runbook's example targets a different run.

## Follow-up paper test

Repeat the same two model configurations and cash control with unchanged
cost assumptions on a new paper window. Assign a fresh run identity and
isolated volume. Before a writer is started, capture the immutable
repository-qualified image reference, exclusive host evidence, canonical
mount and runtime-user readback, and a bounded SIGTERM drill. Verify those
exact artifacts using the [offline preflight](BTC_EUR_OFFLINE_PREFLIGHT.md).
