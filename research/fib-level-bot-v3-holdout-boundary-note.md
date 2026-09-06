# FIB V3 Holdout Boundary Rule

Locked before the first post-cutoff setup or closed basket was observed.

The initial integrity snapshot found six baskets that were already open at the prospective cutoff. They are warm-up carry-over, not prospective observations.

- A counted basket must have both `createdAt >= holdoutStart` and `firstFillAt >= holdoutStart`.
- Pre-cutoff carry-over baskets are excluded from performance, trade count, fill rate, cohorts and every decision gate.
- They are reported only as `carryoverOpenExcluded` while still open.
- The runner does not force-close them and does not rewrite the frozen strategy engine.
- Any conservative opportunity displacement caused by a carry-over remains part of the real chronological path; it cannot manufacture a favorable trade.

Initial snapshot cutoff: `2026-09-06T16:00:00Z`.
Prospective setups observed at that point: `0`.
Prospective closed baskets observed at that point: `0`.

Therefore this boundary clarification uses no prospective performance outcome.
