# M11-976 Depot "not loaded" state: delivery

Base: `1afdbf9e64435701f3903b17625441a19c2295ff`. Delivery head: the PR head commit (a commit cannot embed its own hash); previous reviewed head `167d6a8`.

## Files
- `v11/depot-read-client.js`: `not_loaded` state (valid token, no read attempted this unlocked session, nothing pending); `reasons` diagnostics.
- `v11/depot-read-view.js`: initial render comes from `client.revalidate()` (locked only as fallback); `not_loaded` label; fixed-category diagnostic line for unavailable/stale.
- `v11/depot-read-bootstrap.js`: subscribes to access after view construction; `unlocked` calls `view.revalidate()`; unsubscribes on error and before lock on dispose.
- `test/v11-depot-read.test.js`, `test/v11-depot-access-integration.test.js` (real `createAppAccess.verify()` with real view/client, synthetic data), `test/v11-depot-not-loaded-chrome.test.js` (Chrome/CDP, real `v11/index.html` and central gate).

## Diagnostics
`reasons` is derived at emit time (never cached across a fresh→stale revalidation) and holds only fixed categories per source:
- `current` (dashboard model): `OK` only while the model is unexpired; otherwise `TRANSPORT`, `STALE` (stale or expired) or `INCOMPLETE`.
- `prices`: `TRANSPORT` or `RECEIVED`. `RECEIVED` means the public request succeeded and parsed; it does not claim validated coverage (coverage is checked inside the current model and surfaces as `current`). `RECEIVED` is not shown to the user.
- `history`: `OK`, `TRANSPORT`, `STALE`, `EMPTY` or `INCOMPLETE`. `EMPTY` is a schema-valid archive envelope with no complete valuation points in the window (the history model reports `empty`); excluded or older stored records may still exist, so it is shown as "keine vollständigen Bewertungen im Zeitraum", not as an empty archive. It is distinct from an invalid archive (`INCOMPLETE`) and a failed request (`TRANSPORT`). Valuation admission is unchanged.
No raw responses, holdings or credentials. `INCOMPLETE` for `current` is not split further (no invented schema/price causes). Current and history stay independently valid.

## Commands and results
`PYTHONDONTWRITEBYTECODE=1 node --test test/v11-depot-not-loaded-chrome.test.js test/v11-depot-access-integration.test.js test/v11-depot-read.test.js test/v11-command-depot.test.js test/v11-depot-current.test.js test/v11-depot-history.test.js test/v11-module-cache-identity.test.js`
Result: 42 tests, 42 pass, 0 fail (Chromium headless).

## Browser evidence
`test/v11-depot-not-loaded-chrome.test.js` runs at 320x568 and 390x844 against the static-served `v11/index.html` with the real central gate. Keyboard only, using real `Tab`/`Shift+Tab` navigation (not programmatic focus or `click()`): Tab to the password field, Enter to verify; Tab to the Command/Depot navigation buttons and Enter to open each view; Tab to `Depot aktualisieren` (focus order refresh → `Depot sperren`, Shift+Tab back) and Enter to refresh; Tab to the global lock button and Enter.
Asserts: after verify no dashboard/price reads and exactly one history request (the central verify); Command and Depot both `not_loaded`; manual refresh makes one read per source; unavailable shows fixed reason text; no horizontal overflow, no overlap of Command status text, 44px Depot targets, no password in the page text; lock clears both surfaces; re-unlock returns to `not_loaded` with no new Depot reads.
Interception: the page is navigated first and `Fetch.enable` is then applied only to the patterns `*/api/private/*` and `*binance.vision*`. Those requests (central verify, dashboard, history, public prices) are answered with generated bodies; any other request matching them fails the test. Page and module loads come from the local static server and are not intercepted. Screenshots are written only if `V11_DEPOT_EVIDENCE_DIR` is set. Chrome startup can exceed the helper's 10s timeout on a cold machine; a rerun passes.

## Limits
- Full CI not run. No cache/build/workflow/auth/index changes.
- A fresh→stale projection keeps the cached chart models from the last read; only reasons and the headline state are recomputed.
- Stale handling of the stored model follows the existing model contract; no model changes were made.

## Cache identity

The Lead-allocated cache-only token `B14-M11-DEPOT976` replaces `B14-M11` on the served v11 entrypoint script sources and every internal v11 import edge, with one `app-access.js` identity across readers. The stale-edge rejection fixture now uses the previous `B14-M11`. The visible preview label, terminal r130, root, v10, manifest and `sw.js` are unchanged. Focused run: cache identity, terminal entry, shell safety, bot/strategy chrome and Depot tests pass; full CI is not run.
