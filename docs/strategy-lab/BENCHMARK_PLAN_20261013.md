# Evidence-led strategy benchmark plan — 2026-10-13

Status: DRAFT / source design only. Owner: ChatGPT paper-strategy lane.
Integration base reconciled: 5aee595821666853d5f427785439e64474b1a838. Related: PRs 752, 755, 757, 758.

## Owner decision and implementation status

On 2026-10-13 the owner withdrew the mandatory 3:1 reward/risk constraint and delegated research assumptions to ChatGPT and its agents. For new research, 3:1 is an optional hypothesis, not a universal acceptance gate. This supersedes the earlier user preference prospectively; it does not rewrite frozen experiments or turn failed strategies into successes.

This document records the decision and proposed benchmark contract. It does NOT yet migrate `campaign-20261013.json`, its validator, or `evaluate-trade-plan.mjs`: those still implement the legacy 3:1 contract. In particular, `qualifiesPlannedCRV` means only compliance with that old mathematical threshold. It must not be consumed as a profitability or strategy-readiness verdict. All execution permissions remain unchanged. No research runner, recurring agent dispatcher or live activation is installed by this packet.

The platform/autonomy lane retains ownership of runtime integration, CI/CD, scheduling and production behavior. This isolated document does not modify those paths. Update after the owner's 20:23 instruction: PR 756 is merged as 5aee595821666853d5f427785439e64474b1a838. Main Safety 38445176451, Smoke 38445176492, Coordinator 38445176468 and Pages 38445178905 were directly verified successful on that commit. The prior integration blocker is cleared; PR 745 is superseded. This does not establish that every intermittent Chrome failure is fixed or waive this candidate's own integration gates.

## What matters instead of a fixed ratio

Using realized net average winning trade W, net average losing trade magnitude L, and win probability p, expected net trade PnL is pW - (1-p)L. A hypothetical 1:1 net ratio with 60% winners yields +0.2R, while 3:1 with 20% winners yields -0.2R. These are illustrations, not Meridian measurements. Planned stop/target ratios differ from realized outcomes under partial fills, time exits, gaps and funding.

Evaluate net return together with drawdown, recovery time, tail loss, exposure, turnover, concentration and uncertainty. No universal CRV, profit-factor or Sharpe cutoff establishes robustness. Existing 0.25% trade-risk and portfolio loss-limit defaults remain unvalidated design assumptions, not proven optimal limits.

## Evidence and limits

1. Moskowitz, Ooi and Pedersen, *Time Series Momentum*, JFE 2012: historical persistence across 58 liquid futures/forwards, primarily one-to-twelve-month horizons. Supports a simple trend comparator; does not validate five-minute crypto trading or H7's low-volatility selection. https://fairmodel.econ.yale.edu/ec439/mosk.pdf
2. Liu, Tsyvinski and Wu, *Common Risk Factors in Cryptocurrency*, working paper 2019: historical market, size and momentum factors. Supports testing relative momentum with point-in-time coin membership; factor returns do not establish executable net returns after shorting, delisting and funding costs. https://economics.yale.edu/sites/default/files/2022-10/LiuTsyvinskiWu2019%20COMMON%20RISK%20FACTORS.pdf
3. Schmeling, Schrimpf and Todorov, *Crypto Carry*, BIS WP 1087: economic basis for spot/futures carry, with limits to arbitrage and margin risks. This is a reason to model both legs correctly, not a risk-free-return claim. https://www.bis.org/publications/working-paper-1087-crypto-carry
4. Bailey and Lopez de Prado, *The Deflated Sharpe Ratio*: multiple testing and non-normal returns can inflate apparent performance. A corrected statistic supplements, rather than replaces, chronological separation and a full trial ledger. https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf

These sources guide hypotheses. None proves a currently profitable Meridian bot. Known Meridian TSMOM, breakout, flow and grid failures remain failures; literature is not permission to relabel their previously inspected data as fresh validation.

## Research order and bounded first tranche

Retain the frozen Low-Vol Rank Weighted V2 reference exactly as it is, with its own historical and prospective evidence. Its result does not transfer to H7, which is a different spot strategy.

| Priority | Candidate / question | Proposed exit design | Appropriate control |
| --- | --- | --- | --- |
| 1 | H7 defensive spot: does low-vol selection add value beyond trend and cash? | Daily closed-price trend failure; weekly selection changes; no fixed profit target | Same universe and SMA200 eligibility, same total exposure, equal allocation across eligible coins without low-vol ranking |
| 2 | H5 shock/reclaim: is the subsequent rebound strong and frequent enough after costs? | Existing shock-open target and shock-extreme stop; proposed time exit after six 5-minute bars | Predeclared asset/time/regime-matched events lacking the shock/reclaim condition |
| Later | Simple time-series and cross-sectional momentum | Fixed signal reversal/rebalance rules defined before results | Cash, passive exposure and matched-risk market exposure |
| Separate lane | Carry / funding | Contract-specific two-leg rules | Executable funding/basis after all financing and margin effects |
| Conditional | Whale activity | Only after receipt times and entity/event labels are reliable | Price/volume model without whale feature |

First tranche: H7 baseline and H5 baseline, with at most one registered alternative each: at most four strategy candidates. Alternatives are slots, not permission for unrestricted searches. Every tried/manual/failed variant counts within the existing campaign budget (at most three per family and 36 total); controls and their modifications are also recorded, and become counted candidates if eligible for selection. The earlier H5/H7 designs must be reconciled into the trial ledger before any empirical run. No automatic family-budget reset.

H7 keeps the prototype's SMA200 eligibility, 30-return volatility ranking, up to three 25% spot allocations and remaining cash. Proposed weekly selection time: Saturday 00:00 UTC after the preceding daily bar has closed and become available. Daily trend exits use only available closed bars and execute at the next observed tradable price. Exit proceeds stay cash until the next weekly selection; weekly rebalancing restores target weights. These additions complete a proposed economic specification, not an already implemented bot. Missing prices cannot be filled at stale marks: block new orders, flag the affected interval and apply an explicitly registered outage/valuation policy before a run can be valid.

H5 retains its existing shock/reclaim signal. Its structural gross reward/risk below one disproved compatibility with the old 3:1 policy, not profitability. Entry is after confirmed signal availability; a first executable price already beyond the target invalidates entry. The proposed six-bar time exit is a new assumption and must be registered as part of the completed baseline. Same-bar stop/target ordering requires finer execution data or an explicitly conservative adverse-first model. No target extension merely to improve the displayed ratio.

## Capital, costs and leverage

Use independent 10,000 EUR virtual accounts; declare quote currency, EUR conversion source and timestamps. Spot has no borrowing. For derivatives, first compare identical nominal positions under 1x, 3x and 10x margin settings. Margin leverage changes collateral and liquidation distance; it does not multiply a fixed position's PnL. Increasing nominal portfolio exposure is a separate risk variant and is outside this first comparison.

Derivatives scenarios require historical instrument specifications, maintenance-margin tiers, liquidation/mark prices, funding times, fee assumptions and executable fills. Without them, label the scenario not computable. Do not substitute spot prices or multiply unlevered returns by ten.

Measure fees and executable spread/slippage for the intended venue and size, account for funding/borrow and avoid double-counting costs embedded in fills. Report baseline and adverse-cost sensitivity; an arbitrary basis-point default cannot justify PASS. EUR/quote-currency FX and cash-yield assumptions must be explicit. No venue, historical dataset or cost calibration has yet been frozen by this document.

## Evaluation contract to finish before any empirical run

- Freeze code hashes, data provenance, point-in-time universe, timestamp semantics, complete entry/exit/fill rules, variant IDs, control rules and costs in an immutable run manifest.
- Map every previously viewed Meridian period. Those observations remain development data. Use chronological development/validation splits and only one genuinely unseen final holdout. If no unseen history can be established, obtain prospective paper observations under the project's execution gate.
- Compare strategies and controls on common available windows; report missing history and delisted/unavailable assets. Do not select today's survivors retrospectively.
- Predeclare bull/bear/range diagnostics without tuning strategy selection on final-test labels. Report whole-period and regime results, both long and short contributions, major-asset/trade concentration, and block-based uncertainty estimates suitable for time dependence.
- Benchmark cash, passive BTC/ETH and an equal-weight same-universe portfolio, plus the H7/H5 controls above. Cash and passive references are context; matched exposure helps isolate signal value. Full control construction must be frozen before results.
- Show gross and net performance, maximum drawdown at the simulator's actual observation frequency, recovery duration, tail outcomes, turnover, exposure and sample size. Do not compare weekly sampled drawdown to intraday drawdown as if identical.
- Distinguish invalid runs (data/accounting/fill defects) from valid negative economic outcomes. Preserve both. Conclude promising, unsupported or inconclusive; do not force a winner.
- Stop after the registered budget. New ideas may enter a subsequent documented campaign, without making already seen data unseen again.

## Migration and Claude handoff for 2026-10-14

Prepared review questions; no scheduled delivery or reviewer response is implied:

1. Does the data-use ledger honestly distinguish development, genuinely unseen history and prospective evidence?
2. Does H7's control isolate ranking from cash, trend filter and market beta? Does H5's control distinguish the signal from generic rebound behavior?
3. Could measured costs, unavailable short inventory or plausible worse fills reverse the result?
4. Are margin leverage, portfolio exposure and liquidation mechanics separated correctly?
5. Have all historical and manually altered attempts been counted, including H5/H7 prototypes?
6. Which claims have evidence: arithmetic correctness, executable simulation, historical economic performance, or prospective confirmation?

Next implementation packet: version the research payoff policy so fixed-ratio, trailing, time-based and portfolio-rebalance exits have appropriate models; remove universal minimum-3 enforcement for new candidates; preserve the legacy calculator's explicit contract and frozen research. Add focused tests preventing a below-3 ratio from becoming a universal rejection or a high ratio from becoming execution authorization. H7 must not fabricate a finite take-profit to satisfy a single-trade schema.

Then complete and review the run manifest and offline execution model. Existing checkpoint research permissions and exact-head review gates apply to empirical execution; this draft does not authorize or claim a backtest, paper transition or live trading. The current synthetic tests establish code behavior only. Profitability remains unproven.

## Expanded mandate — owner instruction at 20:23 Vienna

The owner now delegates strategy, instrument, market and leverage choices to ChatGPT and its agents, explicitly including commodities and other markets. Profitability and risk management take precedence over a preferred trading style. Neither a 3:1 target nor 10x leverage is a design requirement. This is authority to develop the research direction; it does not claim an installed continuous optimizer or executed trades. Existing frozen results retain their original assumptions.

The lead's initial choice is to investigate unlevered implementations first and retain the 10,000 EUR comparison account. This is a research baseline, not a universal claim that leverage is irrational. Derivative leverage is chosen only after determining appropriate nominal exposure, plausible adverse moves, correlation, liquidity and collateral reserves. A smaller stop cannot justify unlimited position size. Margin settings are not a return objective; the earlier 1x/3x/10x comparison is optional, not a mandatory ladder or a recommendation to exceed any existing limit.

### Foundations before more variants

Broaden the market feasibility review before spending the empirical trial budget. This prospectively supersedes the earlier crypto-only priority order; H7 and H5 remain registered existing designs, not mandatory winners. The first cross-market hypothesis will be a simple slow trend strategy, compared with passive exposure and cash at matched risk where feasible. Source feasibility work does not count as a performed backtest. Adding or replacing an evaluated candidate requires an explicit manifest revision and preserves all prior trial counts; this addendum does not silently enlarge the four-candidate first tranche or the campaign total.

| Research priority | Market exposure | Implementation questions before selection |
| --- | --- | --- |
| First | Broad equity indices, government bonds, gold | Tradable unlevered fund/product, actual historical product returns, distributions, price gaps, FX, lot size and costs |
| First, alongside cross-market work | Liquid crypto spot | Venue history, custody/exchange risk, point-in-time universe and comparison with passive BTC/ETH; H7 remains one hypothesis |
| Second | Diversified commodity exposure including energy/metals/agriculture | Futures curve and roll economics, product tracking, concentration and collateral; commodity spot charts are not executable total returns |
| Later / instrument-dependent | FX and futures long/short across asset classes | Contract granularity, broker access, financing, expiry/delivery, historical margins and liquidation; 10,000 EUR may not support the desired risk distribution |
| Defer until simpler models justify extra complexity | Options, leveraged products, high-turnover intraday and event/whale strategies | Nonlinear/tail exposure, path dependence, execution/data quality and whether costs erase the proposed edge |

This table selects research areas, not securities to purchase. ETF/ETC/futures exposures are not interchangeable. Account availability, product structure, jurisdiction-specific accessibility and actual broker pricing remain to be verified before freezing an instrument universe. No assumption that a product called micro is small enough for this portfolio.

Proposed first cross-market baseline, still awaiting a complete instrument/data manifest: a single 12-month trend signal, monthly decisions on available closed total-return observations, Long/Cash, no fixed take-profit, and total nominal allocation at most 100% of equity. A nonpositive signal allocates that sleeve to cash. Define lagged risk scaling, lot rounding and cost assumptions before evaluation; no per-market lookback tuning. Compare with fixed-weight passive holdings of the same instruments and cash. This is a new candidate proposal, not an addition to the trial budget without registration. It is not a replication of the literature's long/short futures portfolio.

Additional primary literature: Hurst, Ooi and Pedersen, *A Century of Evidence on Trend-Following Investing* (2017), extends the historical cross-asset trend evidence. It motivates the research priority, not a promise that an unlevered fund implementation reproduces the historical long/short futures strategy. The authors' asset-management affiliation and historical simulation assumptions should be visible in source appraisal. https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing

### Proposed continual research and controlled adoption

1. Agents generate hypotheses with economic rationale, failure modes and required data. The lead selects a bounded batch; evaluated market selection and manual parameter changes enter a cumulative trial ledger.
2. Freeze a manifest, benchmark controls, risk limits and validation schedule before results. Development history is never recycled into an unseen holdout.
3. Evaluate challengers with complete instrument-specific accounting. Compare after costs and at comparable risk; assess uncertainty and concentration rather than selecting the highest historical return.
4. Qualifying challengers enter prospective shadow/paper comparison against an unchanged reference under the project's execution gates. Code tests, historical performance and prospective confirmation are separate evidence levels.
5. Promote only under the applicable review and deployment rules. New rules become new versions; increased capital or risk is a separate decision. The optimizer cannot loosen risk caps to improve its score.
6. Monitor data/accounting integrity, cost bands and predeclared loss limits. Technical defects block new entries while existing positions follow a defined protection procedure. Reassess economic deterioration at fixed review points rather than daily winner rotation. Roll back only if the previous version remains applicable; otherwise stay cash/no new positions.

This lifecycle is a proposed interface to the parallel autonomy lane. No scheduler, background agent service, broker connection or automatic live promotion is created by the document. Continuous improvement means successive reproducible campaigns with cumulative search accounting, not unlimited optimization of one holdout. Claude's review should challenge market feasibility, economic rationale, trial contamination and whether the proposed automation can alter its own risk constraints.
