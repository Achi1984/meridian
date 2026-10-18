# Meridian 11 B11 Bot cockpit acceptance

Local Chromium/CDP acceptance of the actual V11 shell and production Bot
model/view modules. The existing manual read client was fed only bounded,
synthetic fixture responses from a test-only local server. No credentials or
account data were used.

## Results

| Viewport | Mixed rows | Explicit mock reads | Horizontal overflow | Bot controls |
| --- | ---: | ---: | --- | --- |
| 320×568 | 5 | 10 | None | 44 px or greater |
| 375×667 | 5 | 10 | None | 44 px or greater |
| 390×844 | 5 | 10 | None | 44 px or greater |
| 1440×900 | 5 | 10 | None | 44 px or greater |

The five-row fixture includes two distinct BTC bots, Long/Short/Neutral/Unknown
directions, COIN-M/Linear/Unknown contracts, confirmed losses, a source P/L zero
and missing values. Browser assertions cover search, each filter, deterministic
symbol/leverage/source-P&L ordering, duplicate-symbol references, no-match vs
empty snapshot, Command direction distribution and UTC timestamp, the three
confirmed negative P/L values, and a keyboard Enter jump that clears filters,
opens the exact card and focuses its summary. Filter, sort, reset and navigation
operations cause no mock reads; the ten reads per viewport are explicit refresh
actions exercised for fresh, empty, stale, error, race, 401 and expiry paths.

Both views clear derived snapshot information on loading, stale, error, lock,
hidden-page, expiry, 401 and late-response races. At each size, the fixed
navigation does not overlap the final Bot-view content. Screenshot evidence is
in [`evidence/b11/`](evidence/b11/): Command, populated Bots and locked states
for each requested viewport.

## Checks

- `V11_B11_EVIDENCE_DIR=/tmp/meridian-b11-evidence node --test test/v11-b11-bot-cockpit-chrome.test.js`
  — passed; four actual-shell viewports and all assertions above.
- `node --test test/v11-bot-overview-model.test.js test/v11-bot-read-view.test.js`
  — 27 tests passed.
- `node --test --test-concurrency=1 test/v11-*.test.js`
  — 128 tests passed.
- `node --test test/*.test.js`
  — 2,551 passed and 11 failed (2,562 total). The failures are outside the
  V11 suites; logs include missing `pg` dependencies and unrelated publisher,
  process-boundary and source-boundary integration failures. This local result
  is not a full-CI pass and needs Lead reconciliation against the current base.
- `node --test --test-name-pattern='Terminal öffnen preserves' test/v11-terminal-entry.test.js`
  — frozen baseline hash and exact B11 reverse deltas passed.

## Evidence limits

This is synthetic local-browser evidence only. It does not establish real
Pionex-account behavior, authenticated provider data, physical-device or
Safari/PWA acceptance, deployment, production readiness, or operational
permission. Exact-head GitHub CI and independent review remain pending for B11.
