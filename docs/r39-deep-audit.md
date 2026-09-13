# MERIDIAN R39 Deep Audit

Date: 2026-09-13  
Scope: Paper bot state, ledger transitions, execution costs, funding carry, access control, public telemetry, release/runtime controls.

## Decision summary

- Baseline 6.2 remains a frozen failed reference: 30 closed trades, about -$854, PF 0.63.
- Challenger V2 remains sealed: 23 closed trades, about -$30, PF 0.98. It is not an active optimization target.
- Challenger V3 remains the only active directional experiment. Its frozen parameter phase must reach the evidence checkpoint before retain/retire decisions.
- BTC Funding Carry V1 remains an isolated prospective experiment. Initial negative PnL is dominated by reserved four-leg execution costs; success requires actual funding settlements and net break-even.
- Shadow V1 and Regime V1 remain retired. Elliott Wave 5 and the rejected portfolio allocators remain closed. Elliott Wave 3 and FIB V3 remain research candidates, not promoted bots.

## Findings and disposition

| Severity | Finding | Disposition |
|---|---|---|
| High | Scan, manual signal submission, and the periodic Baseline cycle could perform competing read-modify-write transitions against the same Paper state. | Fixed: one serial Paper transition queue; deterministic concurrency tests added. |
| High | Codex could not independently inspect protected bot state because the read token exists only in the user's browser storage. | Fixed: minimized public GET-only `/api/bot-observer`, with no holdings, credentials, IDs, quantities, or exact entry prices. |
| High | The legacy public assistant/status response exposed detailed positions, evidence, and event payloads. | Fixed: `/api/assistant` and `/api/public-status` now require read authorization. Snapshot automation uses the minimized observer. |
| Medium | Long-running interval work could accumulate queued duplicate cycles or scans. | Fixed: cycle and scan triggers use single-flight coalescing. |
| Medium | A static legacy read-token hash remains as a deployment fallback. | Accepted for this release to avoid locking out the existing mobile dashboard. Replace with a managed secret and then remove the fallback. |
| Low | Baseline observer PF/win rate could have been computed from only the ten displayed trades. | Fixed: aggregate metrics use the complete closed ledger; display remains limited to ten recent trades. |

## Accounting and strategy controls verified

- Global startup invariant rejects any configuration other than Paper on / Live off.
- Baseline, Challenger V2, Challenger V3, retired research bots, and Funding Carry use separate state ledgers.
- Challenger V3 charges entry cost once, includes expected exit cost/slippage in sizing, and rejects non-positive net targets.
- A quoted stop is budget-aware; price gaps may still exceed planned risk and remain an explicit model limitation.
- Same-symbol, portfolio-risk, daily-loss, drawdown, cooldown, and post-stop re-entry gates remain active for Challenger V3.
- Challenger V3 parameters are frozen; learning evaluation cannot auto-promote to live trading.
- Funding Carry uses equal BTC quantity on spot-long/perpetual-short legs, idempotent settlement application, four-leg cost reservation, funding reversal/basis divergence/max-loss/review exits, and no exchange order path.

## Remaining actions

1. Observe Challenger V3 through its first prospective checkpoint; do not tune mid-sample.
2. Evaluate Funding Carry only after settlement evidence and net break-even trajectory exist.
3. Configure a managed `MERIDIAN_READ_TOKEN` secret, verify mobile access, then remove the legacy hash fallback.
4. Keep the observer contract aggregate-only; private portfolio and exact execution records stay protected.

## Verification

- Full unit/integration suite: 189/189 passed after R39 release synchronization.
- Production dependencies: 0 known npm vulnerabilities across 14 production dependencies.
- Secret-pattern scan: no private keys, GitHub tokens, cloud keys, or API keys found.
- Runtime safety is rechecked after deployment by the R39 smoke test and live observer response.
