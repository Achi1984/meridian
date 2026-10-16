# Historical universe source audit — snapshot 2024-10-13

This bounded follow-up investigates rank depth and the possibility of joining historical coin identities to price archives. It is not a selection backtest, trading authorization or a certified point-in-time universe.

## Newly verified source depth

A direct GET of https://coinmarketcap.com/historical/20241013/ returned public HTML containing `__NEXT_DATA__`. Its `props.initialState` JSON includes `cryptocurrency.listingHistorical.data`:200 full records, not merely the20 rows visible in the web-text extraction. All200 ranks form the sequence1–200 and provider IDs are unique. The first40 records are preserved in reduced form with provider ID, symbol, rank, USD market cap, snapshot label and provisional exclusion flag. The HTML hash and actual retrieval time accompany the probe.

All200 market caps are finite and positive. Published rank order is consistent with descending cap in the retained first40, but13 adjacent inversions appear deeper in the200-record source. We do not silently re-sort, explain away or certify the full ranking. Possible timestamp/revision/provider-methodology differences need investigation before production use. The source's date label is not its original publication or receipt timestamp.

This resolves the narrow question of deeper public rank data for this one date. It does not establish a complete historical time series, immutable old versions or accurate historical classifications. Tags are treated as potentially revised metadata. A provisional tag filter is not proof of a coin's category as known in2024.

## Predeclared archive probe

Before testing archive access, take the first40 published ranks, apply a provisional stablecoin/wrapped/staked-tag exclusion, and freeze the first25 remaining records as the probe list. Do not continue deeper to replace failed downloads. Keep every failure in the report.

For each, attempt the obvious symbol-plus-USDT Binance daily archive for2024-10-13 and its CHECKSUM. The concatenation is an unverified mapping hint, not identity resolution. Retain the CMC ID; later mapping requires provider/chain/contract/migration evidence and historical pair metadata.

A successful result means only that a ZIP checksum matched and its single12-column candle had the expected opening and inclusive daily closing timestamps. It does not prove sufficient liquidity,201daily observations, availability at a past decision time, spot market access for the user, uninterrupted listing, reliable fills or a correct identity mapping. Failed or absent archives do not by themselves prove the coin was unlisted; pair names, migrations and archive coverage can differ.

The25 frozen probes produced23 checksum-and-daily-shape successes and twoHTTP404 results (LEOUSDT and KASUSDT). Neither failed attempt was replaced. The saved `universe-join-probe-20241013.json` carries exact successes/failures. It deliberately leaves `classificationAsKnown`, `originalPublicationTimeVerified`, `canonicalUniverseApproved` and `executionAuthorized` false. No resulting20-coin list is approved for evaluation. This inspected snapshot and candle date are logged as seen material and cannot later be represented as an untouched test.

## Next data gates

Resolve historical classifications and venue pair identities, determine publication lag/revisions and define an eligible snapshot schedule. Verify warmup/history and the predeclared liquidity criterion before selecting Top20 and its nested Top10 control. Capture outages/delistings and EUR conversion. If reliable old publication evidence is unavailable, distinguish assumption-based exploratory history from prospective evidence collected with actual receipt times. No source substitution should conceal that distinction.

The parallel platform lane advanced main to b26a10b31d2929f8c44d227358312726085209b9; its mailbox reports successful postchecks. This strategy draft has not integrated that new base yet. Exact-current-base review/CI remain necessary before integration. No runtime/platform files are changed by this audit.
