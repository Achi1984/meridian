# Quarter-Hour Boundary Imbalance — Individual Trades Data V1.1 Full-Run Authorization

Status: **AUTHORIZED AFTER FROZEN CANARY PASS**  
Execution impact: **false**  
Signal/returns/positions/PnL allowed: **false**

## Authorization basis

The frozen strategy-neutral Data V1.1 protocol on current main passed its mandatory pre-full-run gate without protocol changes after evidence:

- parser invariants: PASS;
- BTCUSDT / 2025-01 canary: PASS;
- SOLUSDT / 2025-07 canary: PASS;
- Release Safety: PASS.

The successful canary artifacts are tied to protocol head `d004e7e8297745516eeefa44d02040a40687aaa2`, merged to current main by merge commit `546ce0b3528d513adfe9858ad8248846f2290b6f`.

## Authorized execution

Run the already-frozen Data V1.1 workflow over exactly the preregistered 120 asset-month shards: six assets (BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT, DOGEUSDT, ADAUSDT) for 2025-01 through 2026-08 inclusive.

The aggregate gate must fail closed unless exactly 120/120 expected unique shards PASS all frozen hard gates.

This authorization changes no parser, workflow, test, threshold, source semantic, or gate logic. It authorizes only strategy-neutral data-quality execution. It does not authorize directional imbalance, forward returns, signal-return analysis, positions, PnL, Paper execution, or live execution.
