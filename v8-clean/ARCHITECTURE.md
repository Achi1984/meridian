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

## R1 scope
- Standalone mobile-first shell.
- Deterministic five-view navigation.
- CENTER implemented first against `/api/private/dashboard` via a dedicated adapter.
- Private read token exists only in session storage under `meridian.v8.readToken` in this prototype; no secret is committed.
- DEPOT / TRADE / PAPER / MORE remain explicit placeholders until their adapters are implemented.

## Why this avoids the current failures
- No renderer from another view can repaint the active view.
- No hidden legacy button controls route state.
- No `data-view` collision between navigation buttons and content roots.
- No overlay can leave the underlying page visually active.
- Cache/versioning can be handled by one clean entry rather than a compatibility-loader chain.

## Promotion plan
The clean rebuild stays isolated on `v8-clean/rebuild` until all five views are complete, regression-tested and visually verified on iPhone. Only then should the production entry switch from the current compatibility stack to the clean shell.
