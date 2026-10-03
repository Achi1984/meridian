# Low-Volatility Rank-Weighted V2 — Prospective Archive Publication Retry Correction

Status: **PRE-START OPERABILITY HARDENING / SCIENTIFIC RULES UNCHANGED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Execution impact: **false**

## Purpose

The prospective shadow source now depends on completed official Binance Vision daily archives.

The primary canonical collection remains Sunday **02:15 UTC**, inside the frozen 36-hour timeliness window for the preceding Saturday 00:00 UTC cutoff.

To protect the evidence ledger against delayed archive publication or transient archive/network availability, two same-day retry schedules are added:

- Sunday **08:15 UTC**;
- Sunday **11:15 UTC**.

All three attempts remain within the frozen 36-hour timeliness window.

## Immutability behavior

The evidence ledger is first-write immutable per cutoff.

If the 02:15 run successfully persists the canonical dated snapshot:

- later retry runs may independently collect and evaluate the same cutoff;
- they cannot overwrite the existing dated JSON/Markdown snapshot;
- the original first canonical snapshot remains authoritative.

If an earlier run fails before persistence because an archive is not yet available, a later retry can create the canonical snapshot while the timeliness window is still open.

## Unchanged scientific contract

This correction does not change:

- prospective start: **2026-10-10T00:00:00Z**;
- first eligible weekly outcome;
- fixed 12-week gate endpoint: **2027-01-02T00:00:00Z**;
- strategy, assets, feature, rank weights, funding formula;
- baseline/stress costs;
- gate thresholds;
- source family;
- 36-hour canonical timeliness requirement;
- Paper/live authorization.

It changes scheduling redundancy only.
