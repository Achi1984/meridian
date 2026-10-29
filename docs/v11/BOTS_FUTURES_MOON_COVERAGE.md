# V11 Bots: Futures Moon coverage receipt

The official Pionex schemas document Futures Moon within the existing Futures
Grid product; they do not define a separate `buOrderType`:

- [Bot orders list](https://www.pionex.com/docs/api-docs/bot-api/bot-orders)
  maps `buOrderType=futures_grid` to `FuturesGridOrderData`. Omitting
  `buOrderTypes` requests all supported types. The response list is
  `data.results`, with `nextPageToken`/`previousPageToken`; the next request
  supplies `pageToken`.
- [Futures Grid detail](https://www.pionex.com/docs/api-docs/bot-api/futures-grid)
  documents `FuturesGridOrderData.cateType`, including `FUTURES_MOON` (“Futures
  moon order”), and the independent `movingTop`, `movingBottom`,
  `estimateLiquidationPriceUp`, and `estimateLiquidationPriceDown` fields.

Accordingly, `FUTURES_MOON` is preserved as the category of a
`futures_grid` list/detail row through normalization, wallet fallback,
sanitization, and V11 display. It is not treated as a new bot type, direction,
or identity. Bot identity remains the existing stable hash of the provider
order ID. The list adapter follows continuation tokens up to a bounded 20-page
limit; if a token remains at the limit, the observed rows are shown as partial
coverage and are not eligible to overwrite the shared snapshot.

These public schemas establish documented product/category and pagination
contracts, not whether any particular account currently has a Futures Moon
bot. No private account values, screenshots, authenticated calls, or live
provider verification are included. Coverage counts refer only to list rows
actually observed and details successfully represented.

Neutral liquidation bounds remain independent. Missing or invalid values stay
unavailable; inverse-asset prices are normalized before display. Bots reuse
the fresh canonical Depot total and its currency, source, timestamps, expiry,
and locked/stale state without issuing another request or adding bot capital
or P/L to the total.

Regression fixtures and browser checks use synthetic values only.
