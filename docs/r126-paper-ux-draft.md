# R126 Paper UX Draft

Status: RELEASE CANDIDATE on terminalBuild 10.0-r126.

## Goal

Apply the product principle **Complex inside – simple outside** to `#view-paper` without changing Paper/Live authorization, strategy semantics, ranking, P&L calculation, research stage, execution behavior, data contracts or bridge behavior.

The first useful viewport should answer:

1. What is this surface?
2. What is allowed and not allowed?
3. What evidence is being observed?
4. What safe read-only action or drill-down is available?

## Scope

- Paper surface only.
- Move the existing `VALIDATION ONLY` authority note before the evidence summary in DOM order.
- Preserve every existing authority/safety string and Paper model order.
- Raise Paper readability floors with view-scoped CSS:
  - default-visible trust/detail >= 9px
  - authority/warning copy >= 10px
  - primary status/value >= 11px where applicable
  - toolbar action labels >= 10px with >= 44px targets
- At <=420px, use a 2-column Paper model metric grid to reduce clipping pressure without hiding or clamping trust text.
- Add Paper-specific visual QA gates and fixtures for fresh, stale, refresh error, unavailable, loading and safety-blocked states at 390/375/320.
- First-viewport QA requires the Paper authority/state surface and toolbar action to be fully above the bottom nav; valid Paper snapshots must also expose the start of the evidence summary.

## Semantic safeguards

The following remain unchanged and are protected by tests:

- `VALIDATION ONLY`
- `PAPER ONLY`
- `liveTrading=false`
- “bewertet keinen Gewinner”
- “autorisiert keine Promotion oder Live-Ausführung”
- “feste Reihenfolge · keine Performance-Sortierung”
- model order:
  1. BASELINE 6.2
  2. CHALLENGER V2
  3. CHALLENGER V3
  4. DIRECTIONAL V4
  5. FUNDING CARRY V2
- GET-only protected Paper Overview bridge
- `paperOverviewTrusted` research-only / execution-neutral contract

## Explicit exclusions

No changes to:

- Paper or Live authorization
- any `*Authorized` flag
- model ranking or performance sorting
- score/tone semantics
- P&L, DD, PF, win-rate calculations
- model names or safety copy
- `paperOverviewTrusted`, `paperModelStats`, bridge/data contract, polling or refresh behavior
- buttons/events/data-* bindings
- Forecast, Scanner, Command, Depot, Bots or Asset Detail
- FIB, SK, edge, holdout, profit-agent or Lab
- research stage or execution behavior
- release identity files

No global font-size rule, no `!important`, no hidden/clamped authority text.

## Release mechanics

R126 release-candidate conversion is explicitly authorized by the user on 2026-10-06:

`Go – R126 heute als Release Candidate vorbereiten und nach GREEN mergen.`

The candidate uses coherent terminalBuild `10.0-r126`. Merge is authorized only after mandatory exact-head CI is GREEN and Claude gives a fresh exact-head GREEN_LIGHT on the final candidate. No safety, research, privacy, execution or trading gate is waived.

## Deferred R125 follow-ups

Kept outside this Paper-only scope unless required to prevent a Paper false-green:

- meaningful Forecast first-action anchor
- rendered Bot-pair 11px fixture

The generic “full action above nav” concept is implemented for Paper as an R126 QA invariant. Stale/error behavior is documented through explicit Paper fixture states rather than a broad cross-surface exemption.


## Release-candidate hardening

Before merge, the candidate additionally proves:
- rendered Paper model DOM order remains BASELINE 6.2 → CHALLENGER V2 → CHALLENGER V3 → DIRECTIONAL V4 → FUNDING CARRY V2 even though the Visual-QA fixture deliberately gives the last model the largest P&L;
- rendered R42 cohort evidence is present in trusted Paper snapshots;
- the synthetic Paper fixture remains localhost + visualQa-only;
- exact-head Release Safety and Visual QA must pass again on the r126 identity head.
