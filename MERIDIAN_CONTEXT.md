# MERIDIAN CONTEXT

## Product direction
MERIDIAN v8 is a customer-centered presentation redesign. The existing v7.65 dashboard is frozen and recoverable on `archive/v7.65-dashboard-frozen-20260905` from source commit `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.

The v8 migration reduces cognitive load. Every top-level screen answers one customer question first; technical detail is secondary and research/diagnostics are tertiary.

Final top-level structure:
- CENTER — What do I need to know now?
- DEPOT — How is my portfolio developing?
- TRADE — Do I need to act or reduce risk?
- PAPER — Which bot is actually working?
- MORE — Deep detail, market, forecast, diagnostics and research.

## v8 checkpoints
PR #43 merged to `main` as `9f006fbaa50837eb8a3b98a67d24a2156e3d1339`.
PR #44 / R8 merged to `main` as `34d52c3cc98f0bc53015001d8dca71a203a0d7be`.
R42 was merged through PR #115 as `abc5a81a431fb4ea5d4ff48a67337f015523d0bb`.
The Windows line-ending test fix was merged through PR #116 as `f78538f44b76757072e9f9a81132e7a5bf1e2af2`.
Active development branch: `feat/r45-paper-dashboard-cleanup`.
Current development build: `8.0-20260914-R45`.

### R43 ALPHA ATTRIBUTION
Every successful scanner run feeds a separate research state. At most one snapshot per symbol and four-hour bucket is stored, including rejected scanner outputs. Forward labels cover 4h, 12h, 24h, 3d and 7d and deduct the frozen round-trip cost estimate. Missing feature telemetry remains missing. A late quote cannot stand in for an earlier horizon; missed label windows are explicitly invalid.

The first descriptive screen requires at least 100 valid 24h labels, 25 distinct time buckets and three symbols. Any surviving factor is a research hypothesis, not evidence of profitable execution. Scanner-selected direction, correlated observations and excluded holding-period funding remain explicit limitations. No result can promote or modify a bot automatically.

Historical attribution uses a separate `HISTORICAL_REPLAY` state and accepts only chronological closed-candle scanner snapshots. Historical results never count toward the prospective label threshold.

### R44 EVALUATION CLOCK / ACTIVE PAPER VIEW
PAPER shows a live countdown to the next expected 24h label and an estimated first descriptive factor check. When scanner telemetry is stale, the countdown changes to `DATEN FEHLEN` instead of implying progress. Sealed or retired bots are removed from the standard view while ledgers and execution guards remain intact. Any existing open position remains visible regardless of its bot lifecycle. Recent-trade presentation remains focused on the current V3 cycle.

### R45 MOBILE PAPER HIERARCHY
The active V3 learning decision is the first substantive PAPER card. Alpha Lab, R42 experiments and BTC Funding Carry remain visible as compact status rows and expand on demand. Recent V3 trades are collapsed by default; open positions always remain visible. Deep performance, cohort, execution and opportunity-cost diagnostics stay on demand. This release changes presentation only: execution, promotion rules, ledgers and research gates are unchanged.

### R1 PAPER
`app-v8.0-paper-summary.js` provides one answer header plus four compact bot rows. Relative leadership is not promotion; promotion still requires adequate sample, positive OOS/walk-forward evidence, acceptable drawdown/stability and explicit human approval.

### R2 TRADE
`app-v8.0-trade-summary.js` reduces the default Trade view to liquidation-risk state, critical bot, buffer, one next action and compact active-bot rows. It reuses the v7.65 risk-presentation ladder and does not change execution.

### R3 CENTER
`app-v8.0-center-summary.js` turns the start dashboard into a command view. Default visible information is restricted to canonical portfolio total, current market regime, current liquidation-risk state, one next action and the best available scanner opportunity. R7 hardening requires that this opportunity must be READY/TRADE/ENTRY-quality; otherwise the UI shows `NO READY SIGNAL`.

### R4 DEPOT
`app-v8.0-depot-summary.js` reduces the default Depot view to canonical total wealth, 1D performance, a canonical-history sparkline when enough persisted history exists, Spot vs Trading/Bots split, and the four largest spot positions. If the history is not mature, it explicitly shows that history is still building instead of fabricating a chart. Full legacy Depot remains accessible via `DETAILS ANZEIGEN`.

### R5 MORE
`app-v8.0-more-hub.js` consolidates secondary depth behind one entry point. MORE contains Market, Forecast, Scanner, Research and Diagnostics routes. It does not create new trading decisions or duplicate data; it routes into existing detailed views.

### R6 NAVIGATION / MOBILE
`app-v8.0-navigation.js` installs the final five-item bottom navigation: CENTER / DEPOT / TRADE / PAPER / MORE. It delegates the first four routes to existing handlers and opens MORE for secondary tools.

### R7 PRE-MERGE HARDENING
A final code review fixed two UI-contract regressions before the first v8 merge:
- CENTER no longer falls back to a non-ready scanner candidate when no actionable signal exists.
- MORE can still invoke preserved Market/Forecast legacy handlers after v8 hides the legacy bottom navigation; Market/Forecast are represented as MORE in the five-item active state.

### R8 LIVE IPHONE HOTFIX
Post-merge iPhone screenshots exposed three concrete presentation/data-binding regressions:
- `app-v8.0-trade-summary.js` and `app-v8.0-depot-summary.js` had generic `[data-view=...]` fallbacks. The new v8 navigation itself uses `data-view`, so a missing/late real view could cause a customer summary to mount inside a navigation button. R8 binds summaries only to real `#view-*` containers.
- The legacy `#primaryBottomNav` was restored by older high-specificity `!important` CSS, so it could remain visible above/below the new five-item navigation. R8 explicitly hard-hides `#primaryBottomNav` once v8 navigation is ready.
- CENTER/TRADE were reading the empty bootstrap `MERIDIAN_PIONEX_SNAPSHOT` before the canonical browser risk model. R8 prefers the existing `canonicalBotStates()` SSOT and uses bootstrap/DOM only as fallback. CENTER also adds `DATA.btcRegime` as a market-regime fallback.

### R9 BOOTSTRAP / CACHE SELF-HEAL
Repeated iPhone screenshots after R8 showed the old module set still running even though R8 was merged and push CI/runtime smoke were green. The root issue is the compatibility/bootstrap layer: `index.html` still references the legacy compatibility filename with an old static query, so a browser/PWA can keep an older loader/module graph alive long enough to reproduce already-fixed UI bugs.

R9 makes the compatibility layer authority-driven:
- `app-v6.06.js` fetches `version.json` with `cache: no-store` before loading modules and derives the expected module cache tag from the authoritative build.
- If the running loader tag is stale, it injects a fresh compatibility loader with a build-specific query and removes stale v8 summary/navigation CSS + DOM shells before rehydration.
- `app-release-authority.js` independently compares the active loader tag with fresh `version.json` and can request the same hot bootstrap refresh when they diverge.
- `test/v8-bootstrap-selfheal.test.js` protects the authority fetch, stale-loader refresh path, metadata sync and presentation-only boundary.

This architecture is intended to prevent future releases from requiring manual cache clearing when the compatibility filename stays stable.

Legacy detail remains accessible on demand; no v7 capability is deleted by the v8 presentation layer.

## Canonical environment
- Canonical repository: `Achi1984/meridian`; deployment source is `main`.
- Northflank deploys from canonical `main`.
- Baseline engine remains `6.2.0`; frozen ruleset `6.2-SIGNAL-V1`.
- Private portfolio/trading state remains PostgreSQL-backed.
- Read APIs remain bearer-protected through `server-gateway.js`.
- `MERIDIAN_READ_TOKEN` remains protected by startup hashing/removal of plaintext runtime exposure.
- `server.js` contains the paper-only safety invariant and must remain untouched by this v8 UI migration.

## Safety invariants
Baseline 6.2 execution is a frozen reference.
- Baseline entry, sizing, risk, exit and ledger behavior remain frozen unless explicitly approved.
- Paper only; live trading remains disabled.
- Research never silently changes execution.
- Existing privacy/token protections stay intact.
- PostgreSQL remains canonical for private financial state and portfolio history.

## Portfolio history
v7.64 canonical portfolio history remains the data contract. Current value formula remains `totalUsd = spotUsd + tradingUsd`. Pionex is not double-counted as Spot. Historical ranges only switch to canonical persisted history when maturity/coverage rules are met; no fabricated Pionex backfill.

## Research principles
- More evidence does not automatically become more hard entry gates.
- Evaluate performance together with trade frequency/opportunity cost.
- Judge LONG vs SHORT in regime context.
- Track avoided losers and missed winners.
- Full-window attribution is not OOS proof.
- No research bot auto-promotes; promotion requires adequate common-window sample, positive OOS expectancy/PF, acceptable drawdown, useful coverage/stability and explicit human approval.
- v7.79 prospective holdout remains locked and prospective.
- v7.86 Retest/Hold Breakout V2 remains research-only.
- Meta Allocator work remains research-only until explicit promotion criteria are satisfied.

## Release authority
v8 release metadata must stay synchronized through `scripts/release-sync.mjs`: compatibility loader cache tag, manifest, package.json/package-lock version contract and `version.json` must agree before Release Safety passes. R9 additionally treats fresh `version.json` as the runtime bootstrap authority and can hot-refresh stale v8 modules.

## Save-progress rule
Every meaningful implementation or research checkpoint must be committed to GitHub. Do not leave substantive MERIDIAN work only in chat.

## Next step
Run the complete test suite and release synchronization on the exact R45 head. Review the resulting diff and open a pull request only after explicit publication approval. After deployment, verify the answer-first PAPER order, collapsed Alpha/R42/Funding rows, preserved open positions and collapsed recent trades on iPhone.


## Agent orchestration quality process

All future MERIDIAN work follows the mandatory orchestration and review process in `MERIDIAN_AGENT_WORKFLOW.md`.

Key rules:
- Main Agent is the only user-facing agent.
- Specialist work is independently reviewed before integration.
- Review loops are capped at three; unresolved work is not merged.
- Quality gates include syntax/tests/release/runtime checks where available.
- UI changes require iPhone/mobile review.
- Trading logic requires both technical and methodology review.
- Live/time-sensitive financial data follows the two-source rule when technically possible.
- Quality takes priority over speed.
- The Main Agent may merge autonomously after all agreed gates are green.
- Actual runtime/model capabilities must be reported honestly; no review/model may be claimed unless it truly ran.


## v9 r17 Data Truth checkpoint

Physical iPhone validation of v9 r16 confirmed the cache fix and the new market-feed labels, but exposed data-truth issues:
- header correctly showed r16
- negative dollar PnL formatting was wrong because the tiny-number branch used signed comparison instead of absolute magnitude
- several positive reference snapshot percentages could still drive LOCK recommendations despite missing live investment/PnL
- global LIVE wording overstated a mixed snapshot/live dashboard
- exposure totals mixed reference bot quantities with live values
- null hedge SL could render as zero because numeric normalization accepted null as Number(null)
- the Research screen showed engine r15 while the app was r16 without clarifying that distinction

r17 addresses these as correctness issues: source-aware action gating, two-source market price cross-check, live-only actionable risk/exposure paths, missing-value preservation, negative-money formatting, mixed-data status and clearer Research engine labeling.


## v9 r18 Source Freshness checkpoint

Physical iPhone validation of r17 confirmed:
- r17 deployed correctly and reports MIXED instead of global LIVE.
- negative PnL formatting is fixed (e.g. XRP -$71.39 rather than thousands-scale output).
- public prices show PIONEX + OKX + BINANCE where cross-checking succeeds.
- only 2 of 25 tracked bot rows are currently matched from the private bot snapshot.
- 14 assets have two-source public price coverage.
- the current UI can therefore distinguish price freshness from bot-state coverage, but r17 still used the misleading term LIVE MATCH and did not require a trusted bot-snapshot timestamp.

r18 changes the contract from “matched = live” to “matched + timestamp freshness + PnL = actionable”. It also exposes PRIVATE API ROWS and UNMATCHED API to determine whether low coverage comes from the backend snapshot or the matcher.


## OKX update — 25.09.2026 06:22

The user closed the previous OKX futures positions and replaced them with two OKX Futures DCA bots.

Authoritative screenshot snapshot:
- INJ LONG 3x Futures DCA: 65.32 USDC invested; +0.1729 USDC (+0.26%) total PnL; +0.1824 (+0.27%) variable PnL; last 7.977; TP 8.28; average cost 7.908; 0/7 safety orders; no estimated liquidation price shown.
- XRP LONG 3x Futures DCA: 65.32 USDC invested; -0.014 USDC (-0.03%) total PnL; -0.0048 (-0.01%) variable PnL; last 1.5291; TP 1.5924; average cost 1.5296; 0/9 safety orders; no estimated liquidation price shown.

Previous OKX INJ/XRP position records are stale and must not be used. The combined known DCA-bot equity from the screenshot is about 130.80 USDC, excluding any unshown OKX cash or other account balances.


## v9 r20 Pionex Bot Read Sync checkpoint

r19 iPhone acceptance on 26.09.2026 showed:
- MERIDIAN r19 deployed correctly.
- OKX Futures DCA migration rendered correctly.
- Data Truth exposed 3 private Pionex bot rows, 2/25 matches, 1 unmatched stale BTC SHORT 30x row, snapshot age 23d 8h, ACTIONABLE 0.
- Risk Cockpit correctly stayed on SYNC and Risk Priority refused to act.

Repository inspection confirmed the underlying cause:
- `/api/private/dashboard` is a persisted Postgres snapshot.
- Existing automatic exchange sync covers OKX/Bitpanda holdings only.
- No runtime component refreshed `pionexRisk.bots`.

r20 adds a dedicated, read-only Pionex Bot API runtime sync. It uses Pionex's Bot-reading endpoint and fails closed: stale snapshots remain stale on authentication/API/network errors.
## v10 r41 Pionex Bot Detail Hydration checkpoint

The read-only Pionex Bot API path introduced in v9 r20 is now split into list and detail phases. Running bot summaries are no longer assumed to contain complete risk fields. MERIDIAN hydrates every supported active futures-grid / hedge-grid row through the Futures Grid detail read endpoint before publishing a fresh snapshot.

r41 records API list rows, supported futures rows, hydrated detail rows and completeness separately. The active Data Truth surface adds BOT DETAIL coverage. Any missing/duplicate bot ID, detail mismatch, incomplete detail payload, truncated pagination or detail-read failure fails closed and leaves the prior risk snapshot stale rather than partially refreshing it.

This is data-ingestion hardening only. Trading rules, matching thresholds, Profit Lock, hedging, Paper bots, leverage and execution remain unchanged; no Pionex mutation endpoint is introduced.
## v10 r42 Pionex Read-Only Account Foundation

r42 extends the already read-only Bot API path with a separate account/futures read layer. MERIDIAN can ingest Spot trading-account balances, Futures balances and current Futures positions through Pionex GET-only endpoints once a read-only key is configured.

The UI exposes ACCOUNT API separately from BOT API so normal account reading and Bot API Beta access are not conflated. Missing credentials remain an explicit OFF/not-configured state. Errors preserve the prior snapshot as stale.

The user has not configured Pionex credentials yet. r42 is therefore code-ready but not live-connected until the runtime secret store receives read-only credentials. Trading/transfer permissions are neither required nor implemented.
## v10 r46 Pionex Account Position Layer

Live r45 proved that authenticated, correctly signed Bot API list calls return zero running bot rows for the user's existing Pionex bots. Rather than weakening Bot API guards, r46 surfaces the already implemented read-only Futures account positions as a separate live layer.

The position layer shows current Pionex Futures account risk data without claiming bot identity. Bot-specific actions remain fail-closed. Gateway health now exposes only aggregate Pionex account/bot status and position/list counts, not private position values.
## v10 r47 Pionex Wallet / Bot Account discovery

r46 is operational: the Futures account position feed is fresh and currently returns one XRP long position, while the Bot API returns zero running bot rows. Official Pionex Wallet OpenAPI documents a full-account read endpoint that separates Bot Account and Trader Account.

r47 adds `GET /api/v1/wallet/balancesFull` as a fail-soft fourth read source. MERIDIAN stores normalized private totals/categories but exposes only privacy-safe category counts, list counts and entry field names for diagnostics. This release is discovery-only; it does not map Wallet entries into actionable bots.
## v10 r48 Wallet Bot detail probes

r47 live discovery returned 53 wallet entries: 32 TRADING_BOT, 3 FUTURES_LITE, 17 SPOT and 1 ARBITRAGE. The bot-adjacent entries expose buOrderId, buOrderType, cateType, baseList, investmentAmount, investmentToken, profit and title.

r48 privately normalizes the TRADING_BOT/FUTURES_LITE entries and performs GET-only detail probes by buOrderId against the Pionex Futures Grid detail endpoint. The UI shows aggregate buOrderType/cateType counts and detail-probe coverage only. No detail result is promoted to Action Ready in this release.
## v10 r49 Wallet-detail live Bot fallback

r48 live discovery proved 32/35 Wallet bot detail probes succeed. All 32 successful detail reads correspond to `buOrderType=futures_grid`; the 3 `futures_lite` entries remain unsupported by the Futures Grid detail endpoint.

r49 builds a separate `PIONEX_WALLET_BOT_DETAIL` risk snapshot from the successfully hydrated futures_grid details. The UI selects it only when the complete supported set normalizes successfully and the snapshot is fresh (≤15 min). The classic Bot API remains separately visible and retains precedence whenever it is fresh and complete.

The selected Wallet detail rows still pass through the existing conservative reference matcher. No match means no Bot action. Missing PnL/capital continues to block Decision Ready / exposure completeness as before.
## v10 r50 Wallet risk normalization diagnostics

r49 deployed correctly but live UI still selected the classic Bot API EMPTY_GUARD instead of WALLET DETAIL, while Wallet discovery remained fresh and 32/35 detail probes succeeded. This isolates the blocker to the Wallet detail -> normalized live-risk step.

r50 adds aggregate diagnostics to the private Wallet risk object and BOTS UI: normalized/supported count, rejected count and reasons, detail status/trend counts, missing-base count, and top-level/buOrderData field names. No guard is relaxed in this release.
## v10 r51 Pionex enum whitespace normalization

r50 live diagnostics isolated the Wallet risk blocker: 32/32 supported details reached the normalizer with status=running, valid long/short trends and no missing base, yet 0/32 normalized. The diagnostic path trimmed strings while normalizePionexBotOrder/activeOrder/direction and detail-candidate filtering did not.

r51 trims surrounding whitespace before the existing type/status/trend allowlist comparisons. It does not add any accepted enum value. This is intended to let semantically identical documented Pionex values pass the same existing safety checks.
## v10 r52 Exact Pionex normalizer stage diagnostics

r51 live sync still returned RISK NORMALIZED 0/32 after the enum-whitespace fix. The remaining production normalizer gates are now measured directly through a shared inspector to prevent diagnostic drift.

r52 reports aggregate TYPE PASS, STATUS PASS, SYMBOL PASS, SIDE PASS and ALL PASS counts for the 32 supported Wallet futures_grid details. It also reports coarse BASE/QUOTE asset classes without revealing actual symbols or values. No guard is relaxed in this release.
## v10 r53 inverse Coin-M symbol resolution

r52 live evidence isolated the final normalization blocker: TYPE 32/32, STATUS 32/32, SIDE 32/32, SYMBOL 0/32, with BASE stable_quote 32 and QUOTE asset 32.

r53 keeps ordinary symbol resolution on `base`, but for explicit inverse/Coin-M rows only, when base is stable/quote-side and quote is an asset, it resolves the bot asset from `quote`. This addresses Pionex's inverse pair orientation without broadening other bot types.
## v10 r54 Wallet cateType preservation

r53 deployed successfully but remained at RISK NORMALIZED 0/32 and SYMBOL 0/32. The inverse symbol fallback itself was correct, but the Wallet-origin `cateType=inverse` was dropped while constructing the internal summary used for detail normalization.

r54 preserves Wallet `cateType` in the summary and through mergePionexOrderDetail. This allows the existing strict inverse-only symbol fallback to see the already validated Wallet category without expanding any allowlist or trading rule.
## v10 r55 Live/reference match-stage diagnostics

r54 completed the read-only Pionex ingestion path: Wallet detail is the active Bot source and 32/32 supported futures-grid rows normalize successfully. Live matching remains 0/32 against the 27.09 Asset-Watch reference snapshot.

r55 instruments the existing conservative matcher without changing it. The Data Guard shows ASSET PASS, SIDE PASS, LEVERAGE PASS, STRUCTURE PASS, STRONG CANDIDATE and ACCEPTED counts, together with live/reference side distributions and aggregate live field availability.
## v10 r56 Economic-side diagnostics

r55 live evidence: ASSET 32/32, SIDE 24/32, LEVERAGE 10/32, STRUCTURE 2/32, STRONG 0, ACCEPTED 0. Live declared trend distribution is SHORT 27 / LONG 5, while the 27.09 reference snapshot is SHORT 10 / LONG 24. All 32 live rows contain leverage, lower, upper, BE, LIQ and TP fields.

Official Pionex Bot API documentation defines `trend` as grid direction (long/short/no_trend), so r56 does not invert it. Instead r56 adds a diagnostic economic-side classifier from BE/LIQ geometry and compares declared trend vs economic side, plus asset-only leverage/structure matching that ignores declared side.

No production matching or trading decision is changed.
## v10 r57 API-native bot identity

Current user screenshots on 28.09.2026 show multiple active BTC COIN-M Futures Grid bots as LONG (5x/7x/11x) with liquidation prices below break-even/open prices. The old 27.09 Asset-Watch snapshot is confirmed stale and must not remain the canonical identity gate.

r57:
- economically validates inverse Coin-M side from direct positionOpenPrice vs liquidationPrice when available;
- preserves Pionex trend as declaredSide;
- accepts complete Wallet-detail rows as API-native identity only when detailsComplete and IDs are unique;
- keeps the old Asset-Watch snapshot as historical/reference data only;
- does not promote rows to Decision Ready unless existing PnL, risk, market and capital gates also pass.


## v10 r57 follow-up — current side samples supersede screenshot inventory assumptions

A fresh user screenshot pair on 28.09.2026 at 19:05–19:06 confirms that current Pionex COIN-M inventory can contain both directions at the same time. The earlier DOT SHORT sample from 18:58 was closed immediately afterwards and is therefore historical only. Use the SUI pair as the current manual side-validation sample:
- SHORT 4x: current price 1.1556, creation price 1.0043, break-even 1.0252, liquidation 1.5636, range 0.65–1.85.
- LONG 4x: current price 1.1556, creation price 1.2463, break-even 1.2218, liquidation 0.6859, range 0.60–1.55.

Both SUI samples agree with r57 economic-side geometry (LIQ above entry/BE => SHORT; LIQ below entry/BE => LONG). Screenshot inventories are point-in-time validation evidence only. Current Wallet-detail API rows with unique bot IDs remain the live identity source; the 27.09 Asset-Watch screenshots and later manual screenshots must not be treated as canonical inventory.


## v10 r58 — inverse Coin-M reciprocal price normalization

Live r57 evidence on 28.09.2026 showed that API-native identity was working (Wallet Detail, 32/32 supported), but quote-inverse Coin-M rows still exposed reciprocal raw prices such as BTC BE 0.000011999 and TP 0.000010526 while the market traded near 83k USD. r58 normalizes quote-inverse price fields into the asset/USD convention before any risk or side interpretation.

r58:
- detects the existing strict quote-inverse shape only when the normalized symbol source is `quote_inverse`;
- converts positive raw price fields with `1 / raw` for entry/open, grid bounds, liquidation, TP and SL;
- reorders reciprocal grid bounds so `lower < upper` in asset/USD terms;
- translates Pionex pair-direction trend into asset-direction for quote-inverse rows;
- derives economic LONG/SHORT only after price normalization;
- selects estimated liquidation candidates only when they lie on the economically correct side of normalized entry;
- retains the original raw trend as `declaredSide` and exposes translated `assetDeclaredSide` for diagnostics.

Validation fixtures use the current SUI LONG/SHORT pair and the observed BTC reciprocal sample. No trading permission, execution, PaperBot, Profit Lock, leverage, hedge threshold, matcher threshold or decision gate is relaxed.


## v10 r59 — live acceptance cleanup after r58

Fresh r58 screenshots confirmed the reciprocal Coin-M fix: SUI is now recognized as one LONG plus one SHORT, the live Wallet Detail layer is API Native, and safety normalization can detect the SUI short stop-loss only ~0.88% before liquidation.

The same screenshots exposed three presentation/data-authority issues:
- the legacy v9 COMMAND cards could repaint after the v10 adapter and reintroduce a second stale DATA GUARD / exposure / OKX snapshot layer;
- leveraged exposure totals were labeled as generic USD although the calculation is investment USD × leverage, i.e. notional;
- the fresh `/wallet/balancesFull` total was available in `pionexAccount.wallet.totalInUsdt` but the canonical portfolio path still fell back to a screenshot value when no older private Pionex equity snapshot existed.

r59 makes the v10 command layer authoritative after asynchronous v9 repaints, labels live long/short/net values explicitly as NOTIONAL, and uses the fresh Wallet API total as the Pionex equity fallback before any screenshot fallback. Decision readiness remains fail-closed while bot PnL is unavailable.


## v10 r60 — deterministic live-view lifecycle + wallet total diagnostics

Live r59 screenshots on 28.09.2026 confirmed the r58/r59 data fixes, but exposed two remaining UI lifecycle problems:
- COMMAND could keep the pre-sync v9 portfolio hero even after the current state had fresh API data;
- BOTS could fall back to the legacy v9 bot-group rendering after a tab change because the v10 MutationObserver did not deterministically force decoration for navigation events.

r60 adds a read-only bridge refresh for the currently active v9 view. On a fresh `meridian:data` event, COMMAND first rebuilds its underlying v9 hero from the current state and is then decorated by v10. Navigation clicks explicitly schedule a forced v10 render on the next animation frame, so BOTS cannot remain in the legacy representation after a tab switch.

The private Wallet + Detail diagnostic block now shows:
- `wallet.totalInUsdt` as WALLET TOTAL,
- `botAccount.totalInUsdt`,
- `traderAccount.totalInUsdt`,
- wallet snapshot age.

Missing wallet values remain unknown (`—`), never coerced to zero. No PnL field is promoted and no decision gate is relaxed.


## v10 r61 — explicit view authority + fresher Wallet equity precedence

Live r60 screenshots on 28.09.2026 confirmed that the COMMAND hero now refreshes after API sync, but the BOTS tab could still remain in the legacy v9 renderer after navigation. The root cause is lifecycle authority: a nav click can rebuild the legacy view without a guaranteed semantic event for the v10 adapter.

r61 makes the source renderer emit a dedicated `meridian:view` event after every `go(v)`. The v10 adapter listens to that event and forces the active view decoration, independent of click bubbling and MutationObserver timing.

The same screenshots also showed a Pionex private snapshot with no timestamp still outranking a fresh Wallet API account snapshot. r61 changes only portfolio-source precedence: a fresh successful Wallet API `totalInUsdt` is preferred when the private equity snapshot is not fresh, or when Wallet API is at least as new. A fresh newer private snapshot still retains priority.

No bot PnL is inferred; no decision or execution rule changes.


## v10 r62 — stale-shell self-heal

At 20:18 local time on 28.09.2026 the user still saw v10 r60 although runtime smoke had already confirmed v10 r61 on GitHub Pages and the gateway deployment was healthy. This isolated the remaining problem to a client-side stale HTML/PWA shell rather than deployment lag.

r62 adds a permanent stale-shell recovery path:
- root navigation uses a build-specific `build=r62&fresh=r62` URL;
- the web app manifest launch URL is updated from the obsolete v8 start URL to the current v10 build and is linked from both root and v10 shell;
- the v10 shell probes `version.json` with `cache:'no-store'` on boot and on BFCache restore; when `terminalBuild` differs from the loaded shell it reloads itself with a fresh cache-busting query;
- runtime smoke now rejects stale PWA launch URLs and missing self-heal code.

This cannot retroactively modify an already cached r60 document, so one one-time cache-busted navigation is still required for a client currently stuck on r60. After r62 is loaded once, future terminal releases can self-heal without manual cache clearing.
