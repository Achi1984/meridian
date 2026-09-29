# Paper Bot r69 Parallel Research — Handoff

Status: preserved evidence, **not integrated as canonical code**  
Date: 2026-09-29  
Execution impact: false

## Why this handoff exists

The parallel branch `fix/v10-r69-profit-agent-v2` contains useful V2/V3 research, but it diverged from current main and re-used module paths already occupied by the canonical V2 research merged through PR #247.

Two attempted full integrations were intentionally abandoned:
- PR #255: branch was 44 commits behind current main and merge state was dirty.
- PR #256: clean-base integration review showed it would overwrite newer canonical main files.

No failed/abandoned PR was merged.

## Preserved branch

`fix/v10-r69-profit-agent-v2`

The branch remains the authoritative detailed implementation/evidence source for this parallel lane until a future namespaced archival integration is explicitly justified.

## Frozen results from the parallel lane

### UP-Regime Donchian V2 discovery
- net return: +11.93%
- Profit Factor: 2.334
- max drawdown: 2.80%
- positive windows: 4/5
- positive assets: 6
- decision: discovery pass only

### Independent V2 transfer-universe holdout
- net return: +5.84%
- Profit Factor: 2.231
- max drawdown: 1.53%
- positive windows: 2/5
- periods: 16
- decision: fail because periods < 24 and positive windows < 3

The gate is not relaxed.

### Adaptive Up-Trend 6h V3 discovery
- net return: +19.40%
- Profit Factor: 1.175
- max drawdown: 7.85%
- positive windows: 3/5
- positive assets: 7
- decision: fail because PF < 1.20 and positive windows < 4

The gate is not relaxed.

## Canonical status

There is still **no validated strategy promotion** from this parallel lane. None of these results authorizes Paper shadow or live execution.

Current main keeps its existing V2 module path and ruleset. The parallel Donchian/6h lane must never overwrite that path.

## Next research rule

The next active hypothesis must:
- start from current main;
- use a unique V4 ruleset/module name;
- freeze protocol before seeing results;
- avoid tuning V1/V2/V3 on their discovery samples;
- remain research-only with `executionImpact=false`;
- use a genuinely different or independently validated data slice before any promotion consideration.
