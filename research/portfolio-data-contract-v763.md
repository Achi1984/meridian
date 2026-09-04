# MERIDIAN v7.63 — Portfolio Data Contract V1

## Problem
The Depot headline, chart endpoint and 1D display could be based on different valuation paths. In the observed case the headline showed about $27,783 while the latest chart point/high remained around $28,165. Previous fixes added Pionex equity to historical spot series at display time, which did not guarantee that the latest chart point equaled the current canonical portfolio value.

## Decision
Introduce one canonical current portfolio snapshot:

`totalUsd = spotUsd + tradingUsd`

- `spotUsd`: non-Pionex holdings valued with live prices where available.
- `tradingUsd`: Pionex equity snapshot, preferring `portfolio.pionexEquityUsd`, with manual venue balance fallback.
- the Depot headline consumes the same canonical total.
- whenever the Depot chart is resampled, its final point is replaced/appended with the canonical current total.
- consistency telemetry is exposed as `MERIDIAN_PORTFOLIO_CONSISTENCY`; silent endpoint drift is no longer accepted.

## Scope
Display/data consistency only. Baseline 6.2, Paper execution, bot logic, risk, exits and `server.js` are unchanged.

## Important limitation
Historical Pionex equity is not reconstructed from future/current snapshots. v7.63 guarantees current endpoint identity and explicit source semantics; a later history migration can persist full canonical snapshots at capture time so every historical point uses the same contract.

## Regression contract
- current headline total equals canonical snapshot total;
- latest Depot chart value equals canonical snapshot total within tolerance;
- Pionex holdings are not double counted in spot;
- mismatch is surfaced as `PORTFOLIO_DATA_MISMATCH` by the pure contract helper;
- 1D helper uses one adjusted basis for both current and previous values.
