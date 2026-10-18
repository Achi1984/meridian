# Meridian 11 B10 visual acceptance

Local Chromium/CDP evidence for the V11 B10 preview source. The screenshots are in
[`evidence/b10/`](evidence/b10/); they are not deployment or device-acceptance evidence.

## Measured layouts

| Browser viewport | CSS viewport | Header | Disclosure | All five views |
| --- | ---: | ---: | ---: | --- |
| 320×568 | 320 px | 173 px | 49.6 px | No horizontal overflow; final content reachable |
| 375×667 | 375 px | 169 px | 44 px | No horizontal overflow; final content reachable |
| 390×844 | 390 px | 169 px | 44 px | No horizontal overflow; final content reachable |
| 1440×900 | 1425 px client area | 169 px | 44 px | No horizontal overflow; final content reachable |

At desktop, Chromium reports `innerWidth=1440` and `documentElement.clientWidth=1425`
because of its 15 px vertical scrollbar; body and document scroll widths are 1425 px.
All five desktop screenshots are 1440×900 pixels. The expanded-status screenshot is
1440×1400 pixels. The summary keeps **Unbekannt** visible while collapsed. Each tab
was selected and scrolled to its final content; every bottom edge cleared the fixed
navigation. All navigation and disclosure targets measured at least 44 px.
The expanded status keeps the B9 issue provenance and B1 last-known UI evidence
alongside the B10 layout-only entry.

## Screenshots

| Evidence | Pixels |
| --- | ---: |
| [Command, desktop](evidence/b10/v11-b10-1440x900-command.png) | 1440×900 |
| [Depot, desktop](evidence/b10/v11-b10-1440x900-depot.png) | 1440×900 |
| [Bots, desktop](evidence/b10/v11-b10-1440x900-bots.png) | 1440×900 |
| [Forecast, desktop](evidence/b10/v11-b10-1440x900-market.png) | 1440×900 |
| [Scanner, desktop](evidence/b10/v11-b10-1440x900-research.png) | 1440×900 |
| [Status disclosure expanded](evidence/b10/v11-b10-1440x1400-status-expanded.png) | 1440×1400 |
| [Command, narrow mobile](evidence/b10/v11-b10-320x568-command.png) | 320×568 |
| [Synthetic Depot filled/fresh](evidence/b10/v11-b10-synthetic-depot-filled-375x844.png) | 375×844 |
| [Synthetic Depot error/unavailable](evidence/b10/v11-b10-synthetic-depot-error-375x844.png) | 375×844 |
| [Synthetic Depot stale](evidence/b10/v11-b10-synthetic-depot-stale-375x844.png) | 375×844 |

The last three screenshots use the existing V11 browser integration harness and
synthetic test-server responses on the actual V11 page. Values and states are
fixtures, not account or market data. No private credential is present in the
screenshots or saved by the tests.

## Checks and limits

- `node --test test/v11-b10-chrome.test.js` — four exact viewport sizes; hierarchy,
  disclosure keyboard open/close, touch targets, overflow and bottom reachability pass.
- `V11_B10_EVIDENCE_DIR=/tmp/b10-evidence node --test test/v11-terminal-entry.test.js`
  — baseline reversal, terminal link and synthetic Depot filled/error/stale integration pass.
- `node --test --test-concurrency=1 test/v11-*.test.js` — all 122 focused V11 tests pass,
  including the existing 320/375/390/430 shell matrix and access/privacy/race contracts.
- The earlier workflow run `39119273653` at head `33eb9df7` failed six pre-B10 V11
  assertions; those contracts and the evidence-only disclosure selector are now updated.
  No post-fix hosted result is claimed. A local full-suite attempt passed 2533/2544 tests;
  its 11 failures were confined to non-V11 PG-dependent, publisher-Python, and V10 tests.
- `main` is now `a8cde76ba3255a77049eb6318a61efaa127cedd0` after PR873 and the unrelated
  PR872 merge. PR875 remains based on `cbe9b5a34ed31e61746a656d49bb1b81bc637eec`
  and is behind main. The merge-tree check against current main is clean; lead-owned
  base/history reconciliation, fresh exact-head/base CI, and independent review remain
  pending. This note does not claim those gates passed.
- No authenticated Depot/Bots access, real-account data, physical mobile device,
  Safari/PWA readiness, deployment, or production status was tested.
