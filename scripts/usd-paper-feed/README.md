# Isolated Kraken BTC/USD public feed

`kraken-public.mjs` is an inert, unauthenticated adapter for Kraken's public
`Ticker` and one-minute `OHLC` endpoints. `fetchObservation()` returns the exact
`{ id, observedAtMs, quote }` input accepted by `runUsdOfflineStream` at
`Achi1984/meridian#1317` head
`6dec5b4a9b9f505a1167cbb8fe21a681a9f9c8eb`. The quote uses the account's
`NATIVE_BTC_USD_QUOTE_V1` schema and is admitted by the unchanged account and
valuation modules.

The existing spot-pilot provider hard-codes `XBTEUR`; its ticker and OHLC
parsers accept only EUR pair keys. Reusing them would request or admit EUR data,
so this lane keeps the USD request and strict `XXBTZUSD` response-key parsers
isolated. The adapter never converts EUR prices. Kraken ticker responses have no
exchange event timestamp: `quotedAtMs` and `receivedAtMs` are the local
response-receipt time, not an asserted exchange timestamp. The account schema
only accepts `OFFLINE_CALLER_ASSERTION`, which is not provider authentication
or independent quote verification.

Example composition with the #1317 runner and store; the caller supplies its
own deterministic, stateless decision function:

```js
const feed = createKrakenUsdPublicFeed();
const observations = [];
for (let index = 0; index < count; index++) {
  observations.push(await feed.fetchObservation());
}
const result = await runUsdOfflineStream({ store, observations, decide });
```

The adapter admits only closed one-minute bars, preserves ticker decimal
strings, rejects wrong pair keys, stale/future timing, and malformed responses,
and bounds each response to 64 KiB, total received bytes to 512 KiB, requests to
512, observations to 256, each request to at most 5 seconds, and sampling to
one observation per minute. Its maximum elapsed span is 24 hours, matching the
account/store ceiling; 256 observations at the minimum interval cover only
about 4 hours 16 minutes. These ceilings do not establish 24-hour minute-feed
readiness. Counters are per adapter instance; recreating it is not permission to
extend a campaign or reset account/store limits. No continuation beyond those
limits is implemented.

Tests use clearly synthetic provider-shaped responses only. No live request,
authentication, private endpoint, order method, deployment, or market-data
acquisition is performed or demonstrated. Host handoff still requires a
qualified native-USD quote source and timestamp/provenance validation,
independently retained account-store restart tip, explicit host authorization,
and separate operational review. The current USD policy remains disabled;
USD 1,000 initial capital, USD 100 high-water drawdown pause, and modeled costs
are unchanged. This adapter does not authorize or place trades.
