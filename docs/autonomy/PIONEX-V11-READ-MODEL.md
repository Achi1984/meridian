# V11 Pionex read model — isolated preparation

`v11/bot-read-model.js` is a pure projection for a future authenticated consumer.
It is not imported by the B2 page and adds no network, storage, credentials,
refresh timer, decryption or trading action. B2 revision is unchanged because
there is no visible product change. No end-to-end live UI connection is claimed.

Call with an already authenticated/decrypted sanitized bridge snapshot and the
consumer's trusted current clock. Matching schema/flags do not authenticate data.
FRESH_SNAPSHOT means the supplied snapshot passes structural/freshness gates;
it does not mean verified exchange truth, safe trading or an active bot process.

The projection recomputes age from sourceSnapshotAt; caller sourceAgeMs cannot
extend freshness. It caps freshness at 15 minutes, rejects future timestamps,
requires complete/usable source flags, limits rows to 100 and rejects duplicate or
malformed references. Stale snapshots expose timing/source only, never bot rows.
Only bounded symbols, hashed references and explicit supported side/type/category
provenance cross the projection. Unknown enums stay null, with no inference from
symbol or reversal of economic side. Private keys/arbitrary fields are dropped.

Numerical PnL, margin, liquidation and break-even are deliberately excluded from
this initial seam: existing upstream number coercion can turn absent values into
zero, and break-even is not supplied. Their missing-value semantics need a separate
review before display. The next implementation step is an authenticated transport
contract and private rendering integration, not public account data in static HTML.

Validation: `node --test test/v11-bot-read-model.test.js` uses synthetic data.
An observed live mirror receipt at 2026-10-12T20:09 UTC reported wallet detail data
from 20:07:33.779 UTC with age 109006 ms. This is historical backend liveness evidence,
not proof of individual bot values, deployed provenance fields or this adapter.
