# HOLD_NO_MERGE — Pionex history source preparation

This draft has executable integration hooks. Merging/deploying it activates persistence; it is not inert behind a feature flag. Do not merge or deploy until the owner approves the following concrete effects and the lead completes release checks.

## Effects after approved deployment

The existing five-minute portfolio capture loop (same scheduler and settings) creates `meridian_pionex_history` and its captured-time index with CREATE IF NOT EXISTS. It stores one observation per `(source_at, source)` from the already loaded private dashboard state before the existing public-price fetch. No new provider request, credential, scheduler, workflow, trading action, or private-state mutation is introduced. The existing aggregate table and its full-authority gate remain unchanged. Failure of the new write does not suppress the existing aggregate attempt.

Each row has capture time, source time, Pionex value, source identity, authority version, and optional private revision. No aggregate values or old historical rows are copied. Null, malformed, stale (>15 minutes), and future source observations are rejected; exact zero is accepted. Same-source-time conflicts retain the first stored observation rather than adding apparent measurements. A newer source observation with an unchanged value remains a real point. No retention/deletion job is added.

The new GET `/api/private/pionex-history?range=1w` is behind the existing private bearer gate. It only reads the new table; GET cannot capture or create schema. Without the table, the endpoint fails and the UI shows unavailable history while preserving independent current valuation. It returns at most 2,200 records over at most seven days.

Manual Depot refresh makes two authenticated private reads: current dashboard and separate Pionex history. No aggregate history or public prices are requested in Pionex-only mode. Lock clears chart and valuation. History is never a fallback for the current Pionex valuation. OKX remains deferred; Ledger remains hidden.

The reused SVG chart uses source time (capture time remains separate in the projection), USD/USDT, and the explicit Pionex scope. It shows observed points only, breaks gaps above 15 minutes, does not connect around invalid/excluded points, and never interpolates outside the observed extent. Empty windows remain empty; a single observation is a marker. No P/L, return, or cashflow-adjusted claim is made.

## Release and rollback

1. Review the additive SQL, authentication placement, capture independence, synthetic tests, and UI. Lead runs full CI and mobile browser inspection.
2. Obtain the concrete owner approval for this table creation, continuous capture from existing state, and read route/UI activation; only then merge and deploy through the existing release procedure.
3. Verify the deployed revision and authorized runtime health; do not invent historical values if there are initially no rows. No private DB inspection was performed during preparation.
4. Roll back the deployment to stop the new writes and remove the new read/UI flow. Keep the additive table intact; do not drop private observations. Aggregate-history behavior is unchanged in either revision.

## Validation during preparation

Synthetic store/model/runtime/client tests cover missing/stale/future/invalid/zero authority, deduplication, provenance rejection, gaps, independent capture despite aggregate failure, read failure isolation, and lock clearing. Existing Depot read/access/Pionex-scope tests are run with the focused suite. No live database, provider, workflow or schema action was executed.
