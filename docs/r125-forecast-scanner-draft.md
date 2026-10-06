# MERIDIAN R125 Draft — Forecast + Scanner decision hierarchy

Status: DRAFT ONLY
Base terminalBuild: 10.0-r124
Merge today: FORBIDDEN by one-UI-release-per-GitHub-UTC-day rule

North star: **Complex inside – simple outside.**

## Core scope
- Forecast (`#view-market`)
- Scanner (`#view-research`)

## Conditional stretch
- Asset Detail only after the Forecast + Scanner core is fully green.

## Deferred
- Paper is explicitly deferred to R126.

## First-viewport product contract
Each included surface must answer:
1. What is the current state?
2. Why is that state trustworthy / blocked / stale?
3. What is the next useful action or drill-down?

## Role-based readability floors
- default-visible decision/trust detail: >= 9px
- primary decision/status values: >= 11px where applicable
- interactive labels: >= 10px
- interactive target height: >= 44px
- nav labels: preserve existing >= 9px contract
- no global font-size bump

## Semantic invariants
R125 is presentation-only.
It must not change:
- Opportunity scores or ranking order
- market signal semantics
- FIB / SK rules
- data-state semantics
- tone classes
- data contracts
- portfolio authority
- Paper semantics
- research stages
- PnL
- execution behavior
- authorization flags

## Progressive disclosure
Preserve existing Scanner ranking/order and existing `details` disclosure.
Do not remove the Forecast FIB map or violate `forecastFibInvariant`.
Do not introduce a product-JS semantic path solely for presentation.

## Visual-QA target
- 390 / 375 / 320 Forecast + Scanner
- 375 / 320 stale + error / unavailable context stress
- trust text floors
- 10px / 44px action floors
- clipping and nav occlusion guards
- first useful drill-down/action inside first viewport where feasible
- preserve dataStateInvariant and forecastFibInvariant

## Release mechanics
Today:
- non-release Draft branch only
- terminalBuild remains 10.0-r124
- no version / manifest / checkpoint / resume / handoff identity bump
- no merge

Next eligible GitHub UTC day:
- synchronize coherent 10.0-r125 release identity as the final release-prep commit
- rerun exact-head gates
- independent Claude exact-head review
- merge only if all gates are green

## Claude design challenge
Mailbox #571 response: GREEN_LIGHT on live main 1746155b8f1fba7cb9e2fa96a7889dc946850c5e.
Recommended core: Forecast + Scanner. Asset Detail conditional. Paper deferred.
