# R31 bot review and next Paper execution phase

Evidence basis: repository reports dated 2026-09-02 to 2026-09-08 and user screenshots from 2026-09-09. These are not a fresh authenticated full-ledger audit. Profitability cannot be ruled out forever from these samples.

| Strategy | Evidence | Decision |
|---|---|---|
| Shadow V1 | PF 0.44, 23 closed, retired with no open positions | Keep retired; preserve ledger |
| Regime V1 | PF 0.32, 29 closed, retired with no open positions | Keep retired; no restart |
| Baseline 6.2 | PF 0.63, 30 closed; frozen control | Keep reference, no strategy tuning or reset |
| Challenger V2 | PF 0.98, 23 closed, DD stop | Keep sealed parent |
| Current Challenger V3 / R27 | Two reported stop losses, one reported open ETH position; no adequate edge sample | Cost-aware next-entry phase after flat account; keep cumulative history and limits |
| Historical research Challenger V3 / V3.1, v7.52/v7.53 | Poor walk-forward results; different strategies from current runtime V3 | Do not revive these older variants |
| Elliott Wave 3 | Frozen candidate; 7/8 gates, sample 101/120 in board | Continue existing validation, no promotion |
| FIB V3 | Prospective holdout; earliest eligibility 2027-03-05 and >=100 closed baskets | Preserve holdout and parameters |
| Elliott Wave 5 | Rejected; low sample and negative follow-up years | Keep closed |
| Portfolio allocators v7.101/v7.102 | Rejected; expectancy loss | Keep closed |
| Hybrid v7.97 | Completed reference series | Keep reference; no further threshold search |

## Concrete change

New V3 entries allocate equity × risk percent to the expected net stop loss: price loss to the slippage-adjusted stop fill plus entry and exit fees. Entry is already slippage-adjusted by the runtime. Size is budget / cost-inclusive loss per unit. Net-negative TP1 targets are rejected. Full/reduced budgets remain 0.50%/0.25%; score, stop level, exit policy and cooldown stay as observed because old calibration reports do not establish that raising scores improves edge.

The R31 execution policy activates once the existing V3 account is flat. It records its activation time, equity, closed-trade count and cost settings. Existing positions keep their quantity and exits; balances, peak equity, daily drawdown, closed trades and safety stops are never reset. A latched STOPPED_REVIEW remains stopped. The same ledger continues with per-trade executionPolicyVersion metadata: this is a new execution phase, not a fresh account that hides earlier losses.

Costs are assumptions from the existing simulator, not exchange fee verification. Gaps or delayed detection can exceed the budget. Cost-inclusive sizing corrects risk allocation; it does not turn negative expectancy positive. R29 replay corrections remain a separate unmerged research draft. No current bot is promoted to Live, and no Pionex action occurs.

## Remaining validation

Confirm protected /api/challenger-v3 lifecycle.executionPolicy after deployment (or wait for the existing position to close). Compare matched trade quantities and realized results by executionPolicyVersion, retain aggregate losses, and obtain quote-level evidence to diagnose stop delay separately. No closed-trade history was freshly obtained for this release.
