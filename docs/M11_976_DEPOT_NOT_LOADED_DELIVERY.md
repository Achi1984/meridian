# M11-976 Depot "not loaded" state: delivery

Base: `1afdbf9e64435701f3903b17625441a19c2295ff`. Final head: see the PR head commit.

## Files
- `v11/depot-read-client.js`: `not_loaded` state (valid token, no read attempted this unlocked session, nothing pending); `reasons` diagnostics.
- `v11/depot-read-view.js`: initial render comes from `client.revalidate()` (locked only as fallback); `not_loaded` label; fixed-category diagnostic line for unavailable/stale.
- `v11/depot-read-bootstrap.js`: subscribes to access after view construction; `unlocked` calls `view.revalidate()`; unsubscribes on error and before lock on dispose.
- `test/v11-depot-read.test.js`, `test/v11-depot-access-integration.test.js` (real `createAppAccess.verify()` with real view/client, synthetic data).

## Diagnostics
`reasons` holds only fixed categories per source: `current` (dashboard), `prices`, `history`, each one of `OK`, `TRANSPORT`, `INCOMPLETE`, `STALE`, `EMPTY`. No raw responses, holdings or credentials. `INCOMPLETE` for `current` is not split further (no invented schema/price causes). Current and history stay independently valid.

## Commands
`PYTHONDONTWRITEBYTECODE=1 node --test test/v11-depot-access-integration.test.js test/v11-depot-read.test.js test/v11-command-depot.test.js test/v11-depot-current.test.js test/v11-depot-history.test.js`

## Limits
- No 320/390 viewport or keyboard browser evidence was produced; the existing refresh button is the only CTA.
- Full CI not run. No cache/build/workflow/auth/index changes.
