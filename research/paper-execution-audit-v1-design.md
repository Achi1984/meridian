# MERIDIAN Paper Execution Audit V1 — Design Lock

Status: RESEARCH ONLY. No execution or promotion path.

## Question

Do the existing Paper ledgers show diagnostic evidence of stop-fill overruns, near-simultaneous closures, same-direction multi-asset bundles, or rapid same-symbol/same-side re-entry?

## Predeclared diagnostics

- material stop overrun: realized loss greater than 1.25 times frozen gross entry-to-stop risk;
- closure cluster: at least two observed closes no more than 90 seconds apart;
- directional opening bundle: at least two different symbols, same side, opened within 30 minutes;
- rapid re-entry: same symbol and side reopened within six hours after the prior close.

These definitions describe behavior. They are not new trade gates, strategy parameters or promotion criteria.

## Data boundary

The public read-only assistant endpoint exposes recent closed trades, not the complete PostgreSQL ledgers. Every result must show observed/total coverage. No full-ledger conclusion may be claimed from a partial window.

## Invariants

- Baseline 6.2 remains frozen.
- `server.js`, Paper/live execution, Pionex, sizing, entries, exits and ledgers remain unchanged.
- No bot is reset, resumed or promoted.
