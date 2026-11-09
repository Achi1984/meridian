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

Illustrative host scheduling handoff with the #1317 runner and store. The host
must first create a new store or reopen it with an independently retained tip.
For every continuation, #1317 requires the exact persisted observation prefix
before the new suffix; a singleton-only call is not a valid incremental
continuation. Persist/retain each returned tip independently and stop on any
adapter/runner error. This is not a deployment recipe or evidence of a live
request:

```js
const feed = createKrakenUsdPublicFeed();
for (;;) {
  const scheduledAt = Date.now();
  const prefix = store.replay.entries.map(({event}) => ({
    id: event.id,
    observedAtMs: event.observedAtMs,
    quote: event.quote
  }));
  const observation = await feed.fetchObservation();
  const result = await runUsdOfflineStream({
    store, observations: [...prefix, observation], decide
  });
  await retainRestartTipIndependently(result.tip);
  await new Promise(resolve =>
    setTimeout(resolve, Math.max(0, 60_000 - (Date.now() - scheduledAt))));
}
```

The adapter admits only closed one-minute bars, preserves ticker decimal
strings, rejects wrong pair keys, stale/future timing, and malformed responses,
and bounds each response to 128 KiB, cumulative raw HTTP response bytes to
32 MiB per adapter instance, requests to 512, observations to 256, each request
to at most 5 seconds, and sampling to one observation per minute. The admitted
quote age is `PAPER_CAPITAL_CHALLENGE_POLICY.maxValuationAgeMs` (10,000 ms);
the adapter reads this policy value rather than maintaining a second age
setting. A deterministic 720-row OHLC fixture is 82,854 JSON bytes: it fits the individual
response limit, while 256 such OHLC responses would total 21,210,624 bytes
before ticker bodies. That fixture is synthetic and does not establish typical
provider history size or availability.

Feed transport budgets are distinct from persisted account limits. The
unchanged account/store remains bounded to 256 events, 512 KiB of canonical
checkpoint bytes, and a 24-hour maximum span. The adapter's 32 MiB raw-response
budget does not enlarge the journal byte bound. The 256-event cap sampled once
per minute covers only about 4 hours 16 minutes, not 24-hour minute-feed
readiness. Both components fail closed at their own limits; recreating an
adapter is not permission to extend a campaign, reset a store, or continue
past either bound. The runner receives the full persisted observation prefix
plus only the newly acquired suffix; the store replays the prior prefix without
calling the decision function again.

Tests use clearly synthetic provider-shaped responses only. No live request,
authentication, private endpoint, order method, deployment, or market-data
acquisition is performed or demonstrated. Host handoff still requires a
qualified native-USD quote source and timestamp/provenance validation,
independently retained account-store restart tip, explicit host authorization,
and separate operational review. The current USD policy remains disabled;
USD 1,000 initial capital, USD 100 high-water drawdown pause, and modeled costs
are unchanged. This adapter does not authorize or place trades.
