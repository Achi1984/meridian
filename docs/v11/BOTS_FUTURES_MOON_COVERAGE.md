# V11 Bots: Futures Moon coverage receipt

The checked-in provider evidence supports only `futures_grid` and
`future_hedge_grid`. The documented detail path is
`GET /api/v1/bot/orders/futuresGrid/order`; the repository does not contain an
authoritative Futures Moon list enum, detail endpoint, or detail payload fixture.
Futures Moon is therefore not presented as a verified bot type and no record is
fabricated or aliased to another product.

Bot snapshots now report observed list counts and partial/unverified coverage
separately from the validated bot rows. The display explicitly leaves the
provider contract unverified. A support claim is blocked until evidence supplies
the exact list type value, list inclusion/pagination contract, detail endpoint
and response envelope, stable bot identity, status/direction fields, and price
units/normalization rules.

Neutral liquidation estimates retain separate normalized lower and upper bounds;
missing or invalid bounds remain unavailable. Bots reuse only the fresh
canonical Depot total already projected by the Depot reader, including its
currency, source, timestamps, expiry, and locked/stale state. The projection
does not issue another request or add bot capital/P&L to the total.

Regression fixtures and browser checks use synthetic values only. They are not
live-provider verification.
