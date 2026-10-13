# Shared spot bookkeeping primitive — source only

`spot-ledger.mjs` exports `applySpotFill(input)`. It applies one caller-supplied synthetic fill to an immutable EUR account snapshot. It does not select positions, fetch prices, submit orders, compute strategy PnL, run a backtest or persist an account. `executionAuthorized:false` and `researchOnly:true` are unconditional.

## Exact JSON contract

```json
{
  "account": {
    "currency": "EUR",
    "cashMicros": "10000000000",
    "positions": [],
    "processedFillIds": []
  },
  "fill": {
    "id": "example-1",
    "symbol": "BTC",
    "side": "BUY",
    "lots": "10",
    "priceMicrosPerLot": "100000000",
    "feeMicros": "1000000",
    "signalAvailableAtMs": 1000,
    "quoteAtMs": 1001,
    "quoteReceivedAtMs": 1002,
    "fillAtMs": 1003
  },
  "maxQuoteAgeMs": 10
}
```

The numbers are artificial test values. A micro is one millionth of a euro: this account starts with EUR10,000; the example buys ten lots at EUR100 per lot and pays EUR1 fee, leaving EUR8,999. A lot is an externally defined, immutable amount of the asset, not necessarily one coin or one share. Each holding is exactly `{symbol,lots}`. Amounts are canonical nonnegative decimal integer strings of at most30digits; fill lots and per-lot price must be positive. Symbols have the source's uppercase20-character maximum. IDs are nonempty ASCII strings of at most64characters. Input objects accept exactly their declared fields.

Internally all monetary/lot operations use BigInt. BUY subtracts `lots × price + fee`; SELL adds `lots × price − fee`. Insufficient cash, short sales, oversells, negative result cash, duplicate holdings/IDs and result overflow reject without a replacement account. Valid output contains a new account with alphabetically sorted nonzero holdings and the fill ID appended. The input is unchanged. Account capacity is50positions and10,000normal processed IDs, plus50close-only IDs. At or beyond10,000, only a full sale of an existing positive holding is accepted; BUY and partial SELL reject. State must retain at least one remaining slot per positive holding. Thus50positions at the normal cap can each close once, retaining all10,050IDs. No new asset can be added in reserve. Flat exhausted accounts cannot resume trading; replay history is never truncated. This bounded reserve does not bypass other validation, fee, cash or overflow failures and is not a durable replay system.

Prices must already be expressed as EUR micros per lot with conservative documented rounding. Fractions of a micro are unsupported; the adapter must use a compatible lot definition and record conversion/rounding assumptions. Reusing a symbol after changing lot size would corrupt holdings and is forbidden upstream. EUR schema validation does not verify the truth of a currency conversion. No implicit FX, spread, slippage or fee estimate is invented. If an executable price already includes spread/slippage, do not charge it twice.

The quote must be strictly later than signal availability; quote time must be no later than receipt, which must be no later than fill time. Quote age at fill is bounded by the explicitly supplied nonnegative safe-integer `maxQuoteAgeMs`. All times are nonnegative safe integers. This checks only the claimed event order within one fill, not the reliability of any timestamp. It does not enforce ordering across successive calls, trading calendars, actual fillability or a maximum age between signal and trade. An eventual engine must enforce those independently.

Replay protection is conditional on supplying the complete genuine history. This stateless function cannot detect removed IDs or stale account snapshots and is not durable idempotency. The caller must atomically persist an ordered ledger and validated account version before using it in a real simulator. Fees in another asset, distributions, splits, interest, funding, margin, liquidation and derivatives remain unsupported.

## Validation and remaining work

Synthetic tests cover exact fees, roundtrip cash accounting, integer precision above floating-point limits, insufficient funds, oversells, bad timestamps, duplicate fills, malformed strings/newlines and input immutability. Reserve regressions additionally close50holdings with the full ID history retained, reject partial reserve sales and new buys, and check close headroom. These establish narrow source behavior, not financial performance or a working portfolio simulation. No historical strategy run was performed.

Both research lanes may eventually use this primitive through instrument-specific adapters, but neither manifest is made executable by adding it. Position sizing, risk limits, rebalancing, corporate actions, EUR valuation, state persistence and portfolio performance calculation are still required. A separate hardening follow-up was noted for terminal-newline acceptance in older signal-parser regexes; this ledger uses strict end-of-input assertions.

## Data access probe — 2026-10-13

`data-probe-results-20261013.json` records three tiny official Binance daily archives for BTCUSDT, ETHUSDT and SOLUSDT on2024-01-01. All were downloaded directly, SHA256 checked against their companion CHECKSUM files, decompressed within size bounds and confirmed to contain one12-column row. Raw opening/closing timestamps were inspected; no prices were passed into strategy code and no strategy PnL was computed. Full histories remain unverified. The sampled date is recorded as inspected source material, not secretly reserved as unseen evidence. Archive bytes were not persisted as a canonical dataset; the saved record proves this bounded probe only.

Official data documentation: https://github.com/binance/binance-public-data . Spot timestamps change from milliseconds to microseconds from2025-01-01. Adapters must declare units from the dataset contract, check them and derive the exclusive close boundary from opening time plus interval; never blindly pass the inclusive archive close into the signal modules. Archive integrity hashes do not prove point-in-time availability, completeness or trading accuracy. USDT OHLCV does not provide EUR returns or futures execution mechanics.

The direct iShares equity export endpoint returned HTTP200 and `application/vnd.ms-excel`; the probe read only a capped2,000,000-byte prefix. It did not establish completeness, sheet contents, historical depth or NAV adjustment definitions. This is more than a documented link, but less than an inspected workbook. Gold/commodity workbook content and broker execution feeds remain unverified. No placeholder market returns are substituted for those missing data.

Observed issuer export URL:
https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v1/get-fund-document?appSubType=ISHARES&appType=PRODUCT_PAGE&component=fundDownloadV2&locale=en_GB&portfolioId=251882&targetSite=ishares-uk&userType=individual

Next: inspect a complete bounded issuer workbook, establish actual data schemas and revisions, implement receipt-aware market adapters and complete the risk/portfolio engine under the existing review and research gates. A successful source probe is not authorization to activate trading or claim robust profitability.
