# MERIDIAN v8 — Customer Dashboard Foundation

Status: NEW MAJOR UI LINE
Frozen source snapshot: `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`
Frozen legacy branch: `archive/v7.65-dashboard-frozen-20260905`

## Goal
MERIDIAN v8 is customer-centered rather than feature-centered. Every primary screen answers one question with the minimum necessary information.

## Primary navigation target
1. CENTER — What do I need to know now?
2. DEPOT — How is my portfolio developing?
3. TRADE — Do I need to act or reduce risk?
4. PAPER — Which model is actually working?
5. MORE — Market detail, forecast, scanner, research, diagnostics and advanced tools.

MARKT and FCST leave the permanent primary navigation and remain available as contextual / MORE drill-downs.

## Information hierarchy
- Level 1: answer / action / state
- Level 2: why
- Level 3: research and diagnostics

Level 1 should fit into the first mobile viewport wherever practical.

## Screen contracts
### CENTER
Portfolio total + 1D, market regime, overall risk state, next action, strongest current opportunity.

### DEPOT
Total value, performance chart, selected-range performance, spot vs bots, top holdings. Exchange-level and data-health detail are secondary.

### TRADE
Risk state, highest-priority active bot/position, liquidation buffer or relevant risk metric, one next action, compact active positions. FIB/VWAP/funding/simulator/what-if/lifecycle move to Advanced.

### PAPER
Overall verdict, current leader or `NO MODEL QUALIFIES`, compact ranking with Trades / P&L / PF / DD / OOS-forward status. Journals, matrices, walk-forward, counterfactual and opportunity-cost detail move into Research Details.

### MORE
Forecast, market internals, scanner detail, research labs, diagnostics, advanced risk tools, data/admin tools.

## Color semantics
- Green = verified positive / safe / qualifies
- Amber = watch / incomplete evidence
- Red = negative / blocked / failed
- Blue = neutral information / navigation
- Violet = research accent only; never a positive-performance signal

## Safety / architecture
- Baseline 6.2 execution stays frozen.
- v8 starts as presentation/navigation only.
- No Paper/live execution changes from the v8 migration.
- `server.js` remains untouched.
- Existing v7 APIs/data contracts remain source of truth until deliberate backend approval.
- No v7 dashboard file is deleted during the first v8 migration phase.
- The full v7.65 dashboard can always be recovered from the frozen branch above.

## Build order
1. v8 shell and release identity
2. PAPER summary redesign
3. TRADE priority view
4. CENTER command view
5. DEPOT simplification
6. MORE consolidation + primary nav reduction
7. mobile polish and regression checks
