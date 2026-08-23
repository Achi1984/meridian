# ACHI MERIDIAN v5.10.5 — Bot Queue Integrity Fix

Fixes:
- Canonical active Pionex bot set: BTC-S30, BTC-L20, HBAR-L5, XRP-L5
- Correct risk distribution: 1 CRITICAL / 1 DANGER / 1 TIGHT / 1 SAFE
- ETH-S30 and legacy/closed BTC short are excluded from the canonical active set
- Missing liquidation buffers must be shown as N/A / SNAPSHOT MISSING, never 0.0% CRITICAL
- CENTER and GRID receive the same canonical bot source
- FIB data-state helper distinguishes LIVE / STALE / RELOAD REQUIRED

Verified snapshot basis: screenshots supplied 23.08.2026 around 12:38–12:39 CEST.
