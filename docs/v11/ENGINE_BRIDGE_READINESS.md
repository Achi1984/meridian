# V11 engine/bridge boundary evidence

Status: **BLOCKED for engine integration; static V11 preview only.** This is internal readiness evidence, not runtime readiness or permission to activate V11. No engine, live API, credential, private fixture, timer, service worker, or PWA entry was started by this work.

## Scope and governing decision

This evidence is based on main `a6e62c3a1ee4486fb817a63c1499f308e8f78442` and its isolated issue branch. Architecture decision #603 approves an additive `/v11/` preview but explicitly separates engine readiness, browser/lifecycle acceptance, CI coverage, PWA identity, and deployment gates. The current V11 page remains `static-no-live-data`; #603's single-engine Option A is not satisfied by a visual shell or by this test.

Only this document and `test/v11-engine-bridge-readiness.test.js` are in scope. The test uses Node builtins and executes the exact extracted V9 `go()` and V11 inline script against a minimal DOM. It extracts and validates the production renderer-map keys, and fails closed if extraction or binding shapes change. It does not import V9 or initialize its self-booting runtime.

## Observed source capabilities (not proposed permissions)

| Source | Directly observed behavior | Boundary consequence |
|---|---|---|
| `v9/v9.js` | If `window.MERIDIAN_V10` is false, replaces the location with `../v10/` unless `?legacy=1`; normal engine loading therefore needs the V10 flag set before its one import. | V11 currently does not import it or set the flag. |
| `v9/v9.js` | Self-boot calls `go('command')`, then outside local visual QA starts `refreshNow()`, 30-second bot sync, 60-second market sync, visible-tab refresh and online refresh. | Importing it is activation, not a passive bridge probe. This assignment did not import it. |
| `window.MERIDIAN_V10_BRIDGE` in `v9/v9.js` | `getState()` returns the mutable internal state object, not a copy. `goView(v)` runs a known renderer; `refreshCurrentView()` replaces view HTML and rebinds selected controls. `refreshNow()` runs bot sync plus market sync. | These are mutation-capable engine operations; direct state mutation and renderer calls are not safe read-only observations. |
| Same bridge | `paperOverview()` calls the protected `/api/paper/overview` endpoint. Helpers expose formatting/readiness/analysis functions as well as `marketKlines` and `marketKlinesHistory`, which perform market-data I/O. `renderResearch()` and `bindResearch()` expose research UI generation and binding. | A method named “helper” is not proof of purity. Bridge use needs an explicitly narrowed contract. No bridge method was called here. |
| `v9/v9.js` and `v10/v10.js` | V9 emits `meridian:view` and `meridian:data`; V10 listens to both and schedules decoration/refresh work. | Event ownership and repaint order are part of integration behavior, not a cosmetic detail. |
| `v8-clean/data.js`, `v9/v9.js` | Protected keys observed: `meridian.v8.readToken`, `meridian.v10.externalVenueRefs`, `meridian.v10.ledgerAuthority`. V8 token access reads/writes local/session storage; V9 loads and saves local venue references and ledger authority. | Same-origin storage is shared across `/v8/`, `/v9/`, `/v10/`, and `/v11/`; a distinct path is not isolation. V11 must not access or overwrite these keys. |

These are observed source operations, not an assertion that every operation is appropriate to expose to V11. The v9 state contains reference/snapshot fallbacks and mutable market/bot/portfolio fields; consumers must not treat presence, non-nullness, or a successful refresh attempt as authoritative or fresh evidence.

## Evidence matrix

| Boundary | Existing evidence / observation | Result |
|---|---|---|
| V9 one-time import and V10 redirect guard | `test/v11-terminal-entry.test.js` exercises the static terminal link and actual V11 browser navigation. The V9 redirect guard and V10-flag condition are observed in `v9/v9.js`. | The shell does not import V9. The correct pre-import ordering has not been exercised by a V11 integration boot. |
| DOM mapping and navigation ownership | `test/v11-shell-safety.test.js` and `test/v11-shell-navigation.test.js` cover the current V11 shell. The new VM test executes the real extracted V9 `go()`, actual V11 inline navigation, and V9 per-button binding; it extracts the production renderer keys `command`, `bots`, `market`, `research`, and `more`. | **BLOCKED:** V9 `go()` toggles `.active` before looking up its renderer. V11's `depot` key is absent from the V9 renderer map, so extracted `go('depot')` throws before `meridian:view` dispatch. On a supported key, V9 replaces renderer HTML but leaves V11 `hidden` and `aria-current` flags untouched. The test separately invokes V9's per-button handler and V11's delegated handler in the VM; this sequence is not evidence of browser event propagation. |
| Renderer owner | V9 `go()` and `refreshCurrentView()` write view `innerHTML`; V10 listens for engine events and decorates/re-renders. V11 currently has its own static view/nav owner. | **Unresolved:** no single renderer/navigation owner has been established for an integrated V11 page. |
| `meridian:data` / `meridian:view` | V9 emits these events; V10 subscribes. Existing R131 browser harness observes `meridian:data`. | V11 event subscription and repaint/lifecycle ordering are not accepted or browser-tested. |
| Storage isolation | Existing `test/v11-shell-safety.test.js` rejects V11 token/storage/bridge references; `test/v8-clean-architecture.test.js` covers V8 token handling. V9 owns the listed V10 reference/authority storage keys. | Current static shell guard passes without duplicating its checks here. No V11 browser integration has tested shared-origin storage behavior. |
| Source authority, freshness, unknown and partial states | Reuse `test/r128-snapshot-atomicity.test.js`, `test/r131-market-integration.test.js`, and `test/r131-browser-lifecycle.test.js`; V11 shell contracts also require unknown states to fail closed. | Existing engine evidence stays in its own tests. It is not V11 runtime parity evidence. R132 decision hierarchy remains a separate lead-owned, unmerged source and is not ported here. |
| Bot/market freshness | Existing tests cover the 15-minute bot evidence and 3-minute per-asset market evidence; see R128 and R131 tests above. | Threshold evidence exists for the current engine, not for an activated V11 integration. |
| V11 browser/lifecycle/iPhone/PWA acceptance | Existing shell Chrome tests cover static layout/navigation at configured widths, and terminal-entry tests verify its link path. | **Missing:** synthetic integrated-engine browser tests, duplicate import/timer and repaint lifecycle tests, bfcache/visibility recovery, real iPhone/Safari/PWA acceptance, and PWA/rollback rehearsal. #603 keeps these as separate gates. |

Historic bot snapshot atomicity (R128, merged #593) and market/lifecycle integrity (R131, merged #597) are reused through the existing tests; this package does not reopen or reimplement them. The existing shell safety guard is also reused rather than duplicated. UI-only work in #605/#623 does not constitute engine integration evidence. The existing V11 source remains static and contains no live data bootstrap.

## Validation record

Exact commands and observed outcomes are recorded here after local validation. A test passing means only that its stated source/shell condition was observed; it does not change the BLOCKED status above.

- `node --test test/v11-engine-bridge-readiness.test.js` — **3 passed, 0 failed**.
- `node --test test/v11-engine-bridge-readiness.test.js test/v11-shell-safety.test.js test/v11-shell-navigation.test.js` — **7 passed, 0 failed** (including the renderer-map and unsupported `depot` proof).
- `node --test test/v11-engine-bridge-readiness.test.js test/v11-shell-safety.test.js test/v11-shell-navigation.test.js test/v11-shell-chrome.test.js` — **6 passed, 1 failed**; the existing Chrome CDP test could not start DevTools before its timeout.
- `node --test test/*.test.js` — **2,132 passed, 5 failed** (2,137 total). All five failures were `ERR_MODULE_NOT_FOUND` for the already-declared `pg` package in existing tests (`okx-portfolio-authority-sync`, `pionex-account-read-sync`, `pionex-bot-auto-sync`, `portfolio-history-runtime`, and `v10-r66-wallet-pnl-normalization`). This is an incomplete suite result, not a PASS.
- `git diff --check` — passed.
- Not run: live/private API calls, real account fixtures, self-booted engine, deployment, merge, or PWA activation.

## Current limits and next gate

No synthetic integrated browser/lifecycle test has been authorized in this two-file package. The minimal VM harness proves current renderer-map/navigation incompatibilities from extracted source but does not model browser event propagation or exception handling, CSS/layout, network, timers, storage implementations, bfcache, or phone hardware. In particular, it does not prove how a real browser click handles an exception from V9's per-button handler before delegated navigation runs. No tests here validate the engine itself.

Do not label the V11 runtime ready or activate it based on these checks. A separately authorized integration package must first define one navigation/renderer owner and a narrow read-only bridge contract, then add bounded synthetic lifecycle/browser evidence without live account data. Any PWA, routing, workflow/CI coverage, release-identity, deployment, or stage transition remains separately gated under #603 and current governance.
