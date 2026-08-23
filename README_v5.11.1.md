# ACHI MERIDIAN v5.11.1 — SSOT Data Integrity Fix

Fixes:
- DEPOT → FUTURES & EXPOSURE no longer renders `$NaN` or `undefined`.
- Pionex summary is derived directly from `pionexRisk.bots` ACTIVE only.
- Bot capital, long capital, short hedge and 5x long capacity use one canonical source.
- P&L uses the current `totalProfit` field.
- Missing bot name falls back to bot ID.
- Global numeric formatter converts invalid values to `—`.
- GRID / CENTER / DEPOT now share the same active-bot SSOT.
- No nested/older ZIP packages are included in this release.

Expected current derived values from the stored snapshot:
- Bot capital: 1,280.46 USDT
- Long capital: 1,228.46 USDT
- Short hedge capital: 52.00 USDT
- 5x long capacity: 5,642.30 USDT
- Bias: NET LONG / BTC HEDGE
