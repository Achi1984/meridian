# MERIDIAN v7.67 — Customer-Focused Dashboard Simplification

Status: DESIGN ONLY · no execution impact · no server.js changes

## Goal
Reduce MERIDIAN to the fewest screens and metrics needed for fast decisions on mobile. The product should answer four user questions immediately:
1. What is my overall situation?
2. Where is my money / performance?
3. Is there something I should act on now?
4. How are the bots/research models performing?

Everything else becomes drill-down, secondary tools, or research-only detail.

## Product principle
- One screen = one user question.
- First viewport must show the decision, not diagnostics.
- Details are collapsed by default.
- Never repeat the same metric on multiple cards in the same screen.
- Do not show research plumbing, version history, event-ledger internals or coverage diagnostics unless explicitly opened.
- Status words must be action-oriented and unambiguous: OK / WATCH / ACTION / LOCKED / RESEARCH.
- Colors express state, not bot identity.

## Proposed primary navigation — 4 customer-facing areas

### 1. CENTER — "Was muss ich jetzt wissen?"
Keep only:
- Total portfolio value + 1D change
- Market state/regime: Bull / Bear / Range / Transition
- Risk status: SAFE / WATCH / DANGER
- Top Action: one sentence / one card
- Active bots summary: count + highest-risk bot
- One Opportunity card: strongest current signal if actionable

Move out of Center:
- detailed data-health information
- multiple scanner cards
- detailed FIB tables
- full indicator stacks
- repeated exchange breakdowns
- research diagnostics

Target first viewport:
`Portfolio | 1D | Market Regime | Risk | Next Action`

### 2. DEPOT — "Wie entwickelt sich mein Vermögen?"
Keep only:
- Total portfolio value
- 1D / 1W / 1M / 6M / 1Y chart
- period P&L and %
- Spot vs Trading/Bots split
- Exchange allocation summary
- Top 5 holdings by value

Secondary drill-down:
- full asset list
- full exchange list
- historical source/coverage status
- cashflow-adjusted/raw diagnostics

Do not show:
- duplicate headline/chart totals
- technical portfolio-history diagnostics in normal mode

### 3. TRADE — "Muss ich handeln oder Risiko reduzieren?"
Keep only:
- Global Trade state: SAFE / WATCH / DANGER
- Priority bot / position
- Liquidation buffer
- One recommended action
- Active positions/bots compact list
- Setup & Entry only when there is a valid candidate

Collapsed tools:
- Risk Simulator
- What-If
- Bot Lifecycle
- advanced risk models
- FIB details
- raw funding/VWAP metrics

Rule: no more than one red primary warning and one primary action per screen.

### 4. PAPER / RESEARCH — "Welcher Bot funktioniert wirklich?"
Customer-facing overview only:
- one ranked bot table/card stack
- Model
- Trades
- P&L
- PF
- DD
- OOS/Forward status
- Verdict

Suggested verdicts:
- QUALIFIES
- WATCH
- RESEARCH
- REJECT
- INSUFFICIENT SAMPLE

Top line:
`CURRENT LEADER: <model>` or `NO MODEL QUALIFIES`

Everything below becomes one expandable `RESEARCH DETAILS` area:
- Train / Validation / OOS
- chronology folds
- regime x direction
- counterfactual labs
- Decision Journal
- Kelly shadows
- opportunity-cost internals
- coverage diagnostics
- evidence matrices

No green card border merely because a bot is "Shadow"; green means validated positive state only.

## Secondary navigation
Remove MARKET and FCST from the permanent bottom navigation as full primary destinations.

Recommended replacement:
- MARKET becomes a compact expandable panel from CENTER (price, regime, breadth, BTC dominance, funding if relevant).
- FCST becomes a compact `OUTLOOK` panel from CENTER or DEPOT (forecast range / key levels / confidence) instead of a full navigation destination.

If a fifth bottom item is wanted, use `MORE` instead of separate MARKET + FCST.

## Proposed bottom navigation
`CENTER | DEPOT | TRADE | PAPER | MORE`

MORE contains:
- Market Detail
- Forecast / Outlook
- Scanner Detail
- Advanced Tools
- Settings / Diagnostics

## Information hierarchy
### Level 1 — Customer view
Only decisions and current state.

### Level 2 — Details
Tap to inspect supporting metrics.

### Level 3 — Research / Diagnostics
Developer/research data; hidden by default.

## Mobile design rules
- Maximum 4–6 key cards before scrolling.
- Maximum 2 columns on mobile; single column for decision cards.
- One status badge per card.
- One main number per card.
- No long explanatory paragraphs in normal mode.
- Sticky bottom nav remains.
- Collapsible detail sections start closed.

## Current-screen consolidation
### CENTER
Current Dashboard / Scanner / Market snippets / Forecast snippets -> one command screen.

### DEPOT
Portfolio headline / chart / allocation / holdings -> one wealth screen.

### TRADE
Grid Commander / Next Action / active bots / setup -> one action screen. Advanced tools collapsed.

### PAPER
Overview / Baseline / Shadow / Challenger / Regime / Activity / Research Labs -> one ranking screen + one collapsed research-details section.

## Recommended implementation order
1. PAPER simplification first — largest current information overload and duplication.
2. TRADE simplification — strongest decision-value improvement.
3. CENTER consolidation — create true command center.
4. DEPOT simplification — keep canonical history, simplify presentation.
5. Move MARKET + FCST into MORE / contextual drill-down.

## Non-goals
- no change to Baseline 6.2 execution
- no change to Paper execution
- no research promotion
- no change to risk logic
- no removal of data from backend; only information architecture / presentation changes
