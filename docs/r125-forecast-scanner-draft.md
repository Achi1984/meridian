# MERIDIAN R125 Release — Forecast + Scanner decision hierarchy

Status: RELEASE CANDIDATE
terminalBuild: 10.0-r125
Same-day UI release: USER OVERRIDE AUTHORIZED
User authorization: `Go – Regel ändern und R125 heute mergen`
Governance: PR #580 merged on main at `1670084aa37ce421bab82492708f682aefd8e7f5`

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
One named render-order exception is allowed in `scannerLeaderCard`: the existing `scan-drill-actions` block moves before the existing `scannerConfluenceHtml(symbol)` output so State → Trust → Action is visible earlier on narrow mobile. This exception must preserve every string, selector, `data-*` attribute, event binding, score, ranking input and behavior; it creates no new product-JS semantic path.

## Visual-QA target
- 390 / 375 / 320 Forecast + Scanner
- 375 / 320 stale + error / unavailable context stress
- trust text floors
- 10px / 44px action floors
- clipping and nav occlusion guards
- first useful drill-down/action inside first viewport where feasible
- preserve dataStateInvariant and forecastFibInvariant

## Release mechanics
Same-day release override:
- explicit user authorization applies to this R125 release only
- governance PR #580 enables the user override while preserving every normal safety gate
- override changes cadence only; it does not waive CI, review, release-coordinator, privacy, research or trading requirements

Release candidate:
- coherent terminalBuild 10.0-r125
- version / manifest / checkpoint / resume / handoff identity synchronized
- rerun all exact-head gates after this identity commit
- independent Claude exact-head review is mandatory on the final head
- merge only if all gates are green and the pre-merge atomic recheck still passes

## Claude design challenge
Mailbox #571 response: GREEN_LIGHT on live main 1746155b8f1fba7cb9e2fa96a7889dc946850c5e.
Recommended core: Forecast + Scanner. Asset Detail conditional. Paper deferred.
