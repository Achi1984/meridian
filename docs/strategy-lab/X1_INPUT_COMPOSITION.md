# X1 input availability and composition contract

This offline source adapter validates a fixed four-sleeve basket before passing
the histories to the unchanged `evaluateCrossMarketTrend` baseline. It is an
input contract and synthetic acceptance target, not a strategy pass or an
execution adapter.

## Input

`composeX1Input(input)` accepts a JSON-shaped object with exactly these fields:

- `decisionAt`: UTC timestamp (`YYYY-MM-DDTHH:mm:ss[.sss]Z`); its UTC calendar
  month must equal `asOfMonth`.
- `asOfMonth`: `YYYY-MM`, following the baseline evaluator's convention that
  the final observation is the immediately preceding month.
- `snapshotAt`: UTC timestamp at which the supplied snapshot was captured.
- `assets`: exactly one asset for each fixed symbol and manifest ISIN:
  `EQUITY` / `IE00B4L5Y983`, `BONDS` / `IE00B4WXJJ64`,
  `GOLD` / `IE00B4ND3602`, and `COMMODITIES` / `IE00BDFL4P12`.
  ISINs identify the fixed research universe only; they do not identify a feed,
  venue, listing, or executable instrument.

Each asset has exactly `symbol`, `isin`, and `observations`. Every observation
has exactly `month`, `totalReturnIndex`, `final`, `publishedAt`, and
`availability`. Each history must contain thirteen consecutive completed
months ending immediately before `asOfMonth`; values must be positive finite
numbers and `final` must be `true`. All timestamps are UTC. Publication,
availability, and snapshot times must not be later than the decision time;
publication and availability cannot precede the observation month's end,
availability cannot precede publication, and the snapshot cannot precede
availability.

Availability evidence is tagged per observation:

```json
{"kind":"MEASURED_RECEIPT","receivedAt":"2024-03-01T00:00:00Z"}
```

or an explicit historical assumption:

```json
{"kind":"HISTORICAL_ASSUMPTION","assumedAvailableAt":"2024-03-01T00:00:00Z"}
```

Both forms are caller-supplied declarations. The adapter neither verifies a
receipt nor upgrades an assumption to measured evidence. It does not establish
vendor publication/revision history, feed provenance, product total-return
construction, FX or distribution treatment, or snapshot integrity.

## Output and non-authority

Any invalid, missing, duplicate, extra, mismatched, nonfinal, nonfinite, or
future-dated input rejects the complete basket. Rejection returns no signals
and 100% cash as a validation result; it does not indicate what to do with any
existing positions. No asset is removed or reweighted to rescue an incomplete
basket.

For a valid basket, the unchanged baseline signal is returned: positive
twelve-month return receives LONG at fixed 1/4 weight; zero or negative return
remains cash. Results always have `executionAuthorized: false`,
`selectionActionable: false`, and `empiricalAuthorization: false`. Registration
and remaining trial budget are not inferred. Provenance limitations are
returned with both valid and invalid results.

No network, filesystem, order, PnL, portfolio-accounting, campaign-registration,
or authorization functionality is provided. Passing this structural contract
does not authorize or validate a strategy.

## Synthetic handoff and unresolved work

Tests use synthetic fixtures only. Real data provenance and costs/FX/
distributions, eligible venue and fills, portfolio accounting and risk,
historical validation, canonical ledger use, and the first-tranche slot to
replace remain unresolved. Root integration and owner merge decisions remain
separate.
