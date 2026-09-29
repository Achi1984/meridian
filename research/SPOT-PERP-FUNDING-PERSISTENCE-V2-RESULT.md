# Spot-Perp Funding Persistence V2 — Frozen Independent Validation Result

Workflow run: **36593432549**  
Artifact: **11044843036**  
Artifact ZIP SHA-256: `15dd23dd282a436fcd92662b9c881e23b9ca60ac40774824ba5c03f1d303802e`  
Summary JSON SHA-256: `402e33d919e9cae4c4bfb64aaaab459ff3d89557eb03d76f0bfd153f36ce7ccf`  
Full evidence SHA-256: `e24bcde0b172a34b7ed210a3b9df74280565db15946d118a8914d433f15fd094`  
Markdown SHA-256: `0da63b1cec05e11b9638d9e5b0aaec303dbf6a7f53168fb5be2a1928b3d29210`

This records the first untouched independent validation of `SPOT-PERP-FUNDING-PERSISTENCE-V2-FROZEN`.

## Frozen independent window

Signal warm-up:
- 2025-08 only

Validation:
- 2025-09 through 2026-08
- 12 completed calendar months
- OP / INJ / WLD / SEI / TIA / PENDLE / RUNE / ICP

Initial state:
- all assets INACTIVE

Entry:
- unchanged V1 threshold: prior-month cumulative funding >= 0.00775

Continuation:
- if already ACTIVE, continue while prior-month cumulative funding > 0

## Data integrity

- state slots: **96/96**
- rejected slots: **0**
- data-integrity failure: **false**

Collected public Binance Vision data were complete for the validation path.

## State result

- active state-months: **0**
- inactive state-months: **96**
- entry transitions: **0**
- exit transitions: **0**
- continuation months: **0**
- forced terminal exits: **0**

No asset ever crossed the unchanged 77.5 bps V1 entry threshold during the independent 2025-09 through 2026-08 period.

## Economic result

Because there were no valid entries:

- net return: **0.0000%**
- net PnL: **$0.00**
- funding PnL: **$0.00**
- basis PnL: **$0.00**
- costs: **$0.00**
- stress return: **0.0000%**
- Profit Factor: **0**
- max drawdown: **0%**
- positive windows: **0/5**
- positive assets: **0/8**

These zero economics are an inactivity result, not evidence of profitable risk control.

## Frozen gate result

**FAIL**

Reasons:
- `ACTIVE_STATE_MONTHS_LT_32`
- `ACTIVE_ASSET_BREADTH_LT_6`
- `ENTRY_TRANSITIONS_LT_6`
- `CONTINUATION_MONTHS_LT_12`
- `CONTINUATION_ASSET_BREADTH_LT_4`
- `RETURN_NOT_POSITIVE`
- `NET_PNL_NOT_POSITIVE`
- `PF_LT_1.1`
- `POSITIVE_WINDOWS_LT_3`
- `STRESS_RETURN_NOT_POSITIVE`
- `FUNDING_NOT_ABOVE_COSTS`
- `FUNDING_COST_RATIO_LT_1.15`
- `POSITIVE_ASSETS_LT_5`

## Decision

**VALIDATION_FAIL_RESEARCH_REDESIGN**

No Paper shadow and no live promotion are authorized.

## Interpretation

The stateful persistence mechanism was never activated because the V1 77.5 bps entry regime did not recur in the independent validation window.

This is strong evidence that the high-funding regime seen in V1 was not stable enough across time for this unchanged-threshold strategy family.

V2 therefore does not justify:
- lowering the entry threshold after seeing the holdout;
- carrying V1 discovery positions into the validation period;
- relaxing activity gates;
- reclassifying inactivity as low-risk success.

## Anti-overfitting decision

- no threshold reduction;
- no continuation-threshold change;
- no state initialization from the seen V1 discovery period;
- no asset substitution;
- no date movement;
- no gate relaxation;
- no Paper/live promotion.

Any successor must be a genuinely different signal family rather than a rescue of the same 77.5 bps funding trigger.
