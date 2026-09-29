# Paper Runtime Observer Snapshot r68

Status: **READ-ONLY RUNTIME EVIDENCE**  
Execution impact: **false**  
Trading/Paper parameters changed: **false**

## Purpose

The current server already exposes a public, read-only `/api/bot-observer` endpoint. This audit captures that endpoint from the deployed gateway so the Paper-bot deep audit can distinguish repository rules/historical evidence from fresh runtime telemetry.

## Safety contract

The capture fails unless:
- schema is `8.0-BOT-OBSERVER-V2`;
- `publicReadOnly=true`;
- `executionImpact=false`;
- `paperTrading=true`;
- `liveTrading=false`;
- `generatedAt` is valid and no older than the frozen freshness window.

No authenticated/private endpoint is used. No signal is submitted. No state is written to the runtime.

## Interpretation

The artifact may report current closed/open counts, PnL, drawdown, PF/win rate where exposed, learning-phase fields, freshness, and lifecycle state.

It does **not** by itself authorize:
- ranking unlike bot lineages as a single leaderboard;
- promotion;
- parameter changes;
- Paper/live execution changes.

Any performance comparison must normalize for lifecycle, sample size and ruleset before drawing conclusions.
