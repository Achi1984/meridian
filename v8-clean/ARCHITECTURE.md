# MERIDIAN v8 Clean Rebuild

## Decision
v8 is rebuilt as an isolated frontend instead of layering more customer UI wrappers over the legacy v7 renderer tree.

## Non-negotiable boundaries
- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- No Paper/live execution, sizing, risk, exit or ledger behavior changes.
- `server.js` remains untouched.
- Existing PostgreSQL/private-dashboard and canonical portfolio contracts remain the data authority.
- Legacy v7.65 remains frozen and recoverable.

## Frontend architecture
`v8-clean/` is a standalone app entry and does **not** load `index.html`, `app-v6.06.js`, legacy UI wrappers, hidden legacy navigation buttons or legacy renderer functions.

Layers:
1. **Data adapters** — same-origin API contracts only. One canonical source per metric.
2. **State** — one explicit application state with one active route.
3. **Views** — exactly five real root containers: CENTER, DEPOT, TRADE, PAPER, MORE.
4. **Details modules** — explicit child modules opened from the owning view; never overlays that impersonate a top-level route.
5. **Navigation** — one five-item navigation controlling only v8-clean state.

## R1 — Shell + CENTER
- Standalone mobile-first shell.
- Deterministic five-view navigation.
- CENTER consumes `/api/private/dashboard` through a dedicated adapter.
- Private read token exists only in session storage under `meridian.v8.readToken`; no secret is committed.

## R2 — DEPOT
- DEPOT is a real clean view, not a wrapper around the legacy Depot DOM.
- Spot value is rebuilt from private holdings and excludes Pionex holdings exactly as the canonical v7.63 contract does.
- Trading/Bots value uses canonical Pionex equity (`portfolio.pionexEquityUsd`, then compatible private fallbacks).
- Total is always `spotUsd + tradingUsd`; no second headline-total source is accepted.
- 1D history comes only from `/api/private/portfolio-history?range=1d`.
- 1D performance is shown only after at least 16.8h canonical coverage. Cashflow-adjusted performance is used only when both sides can be represented on that basis; otherwise raw canonical total is used.
- Top positions are derived from the same spot holdings valuation. BETH is displayed as ETH exposure and OKSOL as SOL exposure without changing underlying quantities or execution.
- No fabricated history and no legacy chart fallback.

## Remaining clean views
- TRADE — direct risk/bot adapter.
- PAPER — direct research ledger/analytics adapter, research-only.
- MORE — explicit Market, Forecast, Scanner, Research, Diagnostics and settings modules.

## Why this avoids the current failures
- No renderer from another view can repaint the active view.
- No hidden legacy button controls route state.
- No `data-view` collision between navigation buttons and content roots.
- No overlay can leave the underlying page visually active.
- Cache/versioning can be handled by one clean entry rather than a compatibility-loader chain.
- DEPOT cannot disagree with a legacy DOM card because the clean app never reads legacy DOM values.

## Promotion plan
The clean rebuild stays isolated on `v8-clean/rebuild` until all five views are complete, regression-tested and visually verified on iPhone. Only then should the production entry switch from the current compatibility stack to the clean shell.
