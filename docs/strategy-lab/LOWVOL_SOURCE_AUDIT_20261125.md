# LowVol weekly source audit, 2026-11-25

Canonical evidence branch head b6b72a1bbf7696abde326793c80270fa77d12f26 contains the September 26, October 3 and October 10 snapshots. October 10 is the start boundary with zero completed weeks. The six expected weekly cutoffs from October 17 through November 21 have no JSON receipts on that branch.

The scheduled November 22 run 45008807599 passed invariants. Its snapshot job 137166319614 failed collecting the BTCUSDT 2026-11-01 daily fundingRate ZIP (HTTP 404). This identifies one observed failure, not the cause of every missing week. The archived holdout return and forward completeness are separate.

The supplemental probe fetches official Binance USD-M realized funding events and records exchange timestamps and rates, retrieval time, hashes and gaps per asset. The November 21 sample was obtained November 25. Do not promote it to an on-time observation. The API does not provide the historical interval field used by the canonical archive reader. Substitution needs interval/gap and timestamp parity validation against overlapping official monthly data, plus an admissible collection location for the runtime. Keep existing coverage gaps visible.

Run python scripts/research/lowvol_funding_probe.py output.json --cutoff 2026-11-28T00:00:00+00:00 after that cutoff for an independently timestamped supplementary source check.

For a separate October 17–24 overlap, lowvol_funding_parity.py verified SHA256 on 12 official monthly ZIPs and compared their funding records to the USD-M API. All 252 timestamps and decimal rates matched (21 per symbol). This checks event-time and rate fidelity in that week only.
