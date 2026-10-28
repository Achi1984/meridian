# M11-976 Depot "not loaded" state: delivery

Base: `1afdbf9e64435701f3903b17625441a19c2295ff`. Final head: see the PR head commit.

## Files
- `v11/depot-read-client.js`: `not_loaded` state (valid token, no read attempted this unlocked session, nothing pending); `reasons` diagnostics.
- `v11/depot-read-view.js`: initial render comes from `client.revalidate()` (locked only as fallback); `not_loaded` label; fixed-category diagnostic line for unavailable/stale.
- `v11/depot-read-bootstrap.js`: subscribes to access after view construction; `unlocked` calls `view.revalidate()`; unsubscribes on error and before lock on dispose.
- `test/v11-depot-read.test.js`, `test/v11-depot-access-integration.test.js` (real `createAppAccess.verify()` with real view/client, synthetic data), `test/v11-depot-not-loaded-chrome.test.js` (Chrome/CDP, real `v11/index.html` and central gate).

## Diagnostics
`reasons` holds only fixed categories per source: `current` (dashboard), `prices`, `history`, each one of `OK`, `TRANSPORT`, `INCOMPLETE` or `STALE`. No raw responses, holdings or credentials. `INCOMPLETE` for `current` is not split further (no invented schema/price causes). Current and history stay independently valid.

## Commands
`PYTHONDONTWRITEBYTECODE=1 node --test test/v11-depot-not-loaded-chrome.test.js test/v11-depot-access-integration.test.js test/v11-depot-read.test.js test/v11-command-depot.test.js test/v11-depot-current.test.js test/v11-depot-history.test.js`

## Browser evidence
`test/v11-depot-not-loaded-chrome.test.js` runs at 320x568 and 390x844 against the static-served `v11/index.html`. All Depot/verify requests are intercepted and answered with generated bodies. Keyboard only: password entry plus Enter, Enter on the refresh button, Enter on the global lock button. Asserts: after verify no dashboard/price reads and exactly one history request (the central verify); Command and Depot both `not_loaded`; manual refresh makes one read per source; unavailable shows fixed reason text; no horizontal overflow, no overlap of Command status text, 44px Depot targets, no password in page text; lock clears both surfaces; re-unlock returns to `not_loaded` with no new Depot reads. Result: pass at both sizes (Chromium headless; Chrome DevTools startup can exceed the helper's 10s timeout on a cold machine, in which case a rerun passes). Screenshots are written only if `V11_DEPOT_EVIDENCE_DIR` is set.

## Limits
- Full CI not run. No cache/build/workflow/auth/index changes.
- An empty but valid history archive is reported as `INCOMPLETE` (no separate empty category), because the stored model is not fresh without a point.
