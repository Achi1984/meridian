# Evidence-led strategy benchmark plan — 2026-10-13

Status: DRAFT / source design only. Owner: ChatGPT paper-strategy lane.
Base: c6153102f6aeeca28cfeb7fa3c32a17f71479bfd. Related: PRs 752, 755, 757.

## Owner decision and implementation status

On 2026-10-13 the owner withdrew the mandatory 3:1 reward/risk constraint and delegated research assumptions to ChatGPT and its agents. For new research, 3:1 is an optional hypothesis, not a universal acceptance gate. This supersedes the earlier user preference prospectively; it does not rewrite frozen experiments or turn failed strategies into successes.

This document records the decision and proposed benchmark contract. It does NOT yet migrate `campaign-20261013.json`, its validator, or `evaluate-trade-plan.mjs`: those still implement the legacy 3:1 contract. In particular, `qualifiesPlannedCRV` means only compliance with that old mathematical threshold. It must not be consumed as a profitability or strategy-readiness verdict. All execution permissions remain unchanged. No research runner, recurring agent dispatcher or live activation is installed by this packet.

The platform/autonomy lane retains ownership of runtime integration, CI/CD, scheduling and production behavior. This isolated document does not modify those paths. The known main postcheck blocker is Release Safety 38440715254 attempt 2 (Chrome startup timeout); its retry budget is exhausted. PR 745 owns the related helper work. Integration waits for the existing postcheck gate; independent source preparation can continue.

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
