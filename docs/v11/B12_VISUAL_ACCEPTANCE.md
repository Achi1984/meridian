# Meridian 11 B12 Strategies acceptance

## Scope and evidence boundaries

B12 adds the native **Strategien** tab to M11, retains the other four main tabs
and Pionex Bots, and makes the existing five Arena models reachable in M11.
The 12 campaign families remain source-defined drafts. B1-7 is displayed as a
separate seven-asset, 44-path research candidate with 15/30 bp and +1-day
assumptions; it has no results and is not merged with the legacy eight-asset
Arena diagnosis. Historical diagnostics, ongoing Paper and live trading are
separate states. The stored 448/955 coverage failure, H9 blocker and unknown
evidence remain unchanged.

Arena import, stored-diagnosis load and provenance load require explicit user
action. Browser acceptance uses generated synthetic candles only. It does not
fetch market data, run a replay on navigation, create Paper activity, select a
winner, promote strategies, or authorize trading.

## Local validation

- `node --test test/v11-strategy-catalog.test.js test/v11-strategy-workspace-chrome.test.js` — **7/7 passed** (four responsive Chrome sizes, including 1440×900; malformed and synthetic imports).
- `node --test test/v11-terminal-entry.test.js` — **2/2 passed** (native Strategies keyboard navigation at 320/375/390/430 px; exact B11 shell baseline restoration).
- `node --test test/v11-shell-chrome.test.js` — passed at 320/375/390/430 px; all five labels remain one-line, 10 px, and touch-sized at 320 px.
- `node scripts/frozen-research-guard.mjs` — **140 checked, 0 mismatches**. `node scripts/continuity-audit.mjs` — **PASS**.
- `node --test test/*.test.js` — **2,608 passed, 6 failed**. The failures are confined to publisher-only integration harness tests (launch manifest, parent completion, PG16 role transition, read-only inspection, recovery wrapper, role supervision), outside B12 and explicitly left untouched. No M11 strategy or shell tests failed.
- Browser assertions cover the five native tabs, all 12 families, B1-7 assumptions, five Arena models, H9 blocked state, malformed and synthetic import, keyboard disclosure/navigation, 44 px controls, no horizontal overflow or bottom-nav overlap, and no V10/market/external requests.
- The test produces four actual Strategies screenshots and four actual synthetic-Arena screenshots in `evidence/b12/`. Images are browser captures, not assertion-only evidence.
- Exact-head/current-base CI and independent review remain required gates; the latest PR-triggered workflow entry had no jobs and concluded `action_required`, so it is not a CI pass.

## Limitations

No physical-device, PWA, Safari, deployed-site, real-account, live-trading or
operational-readiness proof is provided. B12 remains a draft and must not be
merged or activated by this work.
