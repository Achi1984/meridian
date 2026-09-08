# MERIDIAN R20 — Shadow V1 and Regime V1 retirement

Decision date: 2026-09-08. Approved by user.

## Decision

- Shadow V1 is RETIRED: 23 closed trades, PF 0.44, realized PnL -1179.22 USD, max drawdown 12.03%.
- Regime V1 is RETIRED: 29 closed trades, PF 0.32, realized PnL -981.42 USD, max drawdown 10.39%.
- Both had zero open positions at the final pre-change runtime check.
- Challenger V2 remains available as the strongest legacy Paper candidate.
- Baseline 6.2 remains the frozen control.

## Behavior

The scanner no longer observes, submits or cycles Shadow V1 and Regime V1. Their PostgreSQL ledgers and read endpoints remain intact. Status payloads expose RETIRED, active=false, ledgerFrozen=true, date and reason.

No ledger reset, deletion, balance rewrite or strategy promotion occurs.

## Invariants

Live trading remains off. Pionex is untouched. Baseline entry, risk, sizing and exit behavior is unchanged. The server change is limited to lifecycle guards and read-only status metadata.
