# Source capability and run blockers

Capability assessment for the isolated adapter boundary, checked for this packet
on 2026-10-29. The parsers are offline-only; they do not make HTTP/RPC calls.
They accept provider response values and produce partial evidence or explicit
unknowns. No provider response is treated as complete merely because it parsed.

| Source | Supported fields / method | Cannot establish alone | Prototype disposition |
| --- | --- | --- | --- |
| DexScreener public API (`api.dexscreener.com`) | Pair response `chainId`, `pairAddress`, base/quote token addresses, `pairCreatedAt`, actual `marketCap`, `fdv`, `liquidity.usd`, `volume.h1`, `txns.h1`, `priceChange.h1` | Complete new-pair discovery; authority/extension state; pool LP lock/burn; owner-aggregated complete holder distribution; dev-associated holdings/history; bundle supply; smart-wallet provenance; executable depth/fills/costs | Parser preserves actual `marketCap` as null if absent and never substitutes `fdv`. Reports other required evidence unsupported. Profiles/boosts are not exhaustive discovery. Network disabled. |
| Solana mainnet public JSON-RPC | Strict read-only method names `getAccountInfo`, `getTokenLargestAccounts`, `getTokenSupply` | The current parser does not verify account layouts/extension state or complete owner distribution. `getTokenLargestAccounts` supplies up to 20 token accounts, not unique owners or all supply ownership. | Method allowlist rejects unlisted methods, including transaction submission. Largest-account parser always reports incomplete coverage. Network disabled. |
| Local synthetic fixture | Explicitly labeled generated identity, filter and analyst evidence | Any statement about real markets, token safety, strategy efficacy, provider coverage or execution | Used only by the synthetic replay and offline tests; never mixed with real scans. |

Primary references:

- [DexScreener API reference](https://docs.dexscreener.com/api/reference)
- [Solana token documentation](https://solana.com/docs/tokens)
- [Solana token authority basics](https://solana.com/docs/tokens/basics/set-authority)
- [Solana `getTokenLargestAccounts`](https://solana.com/docs/rpc/http/gettokenlargestaccounts)

## Prepared but disabled eight-hour manifest

`scripts/memecoin-paper/run-manifest.json` is a plan, not an activation. It
pins only the two named public provider hosts, lists only three read RPC
methods, denies redirects, credentials, arbitrary URLs, and token-provided
URLs, and declares finite request/response/run/event/candidate limits. It
specifies one eight-hour Europe/Vienna window, 30-second minimum poll interval,
fixed mint/pool lists (currently empty), and an engaged stop switch. Start/end
times and run ID remain unset. No recurring scheduler or workflow is present.

No downloader or network adapter is implemented. Importing the source or
running tests cannot access the network. The adapter interface always throws
on `request()`. Even a later bounded request implementation would require
strict host/path/method allowlists, no redirects, response byte/time limits,
and read-method enforcement before it could be considered.

## Operational blockers (not waived by preparation consent)

1. Empty fixed mint/pool allowlists and unset start/end/run identity require
   explicit owner choices and approval of the exact one-shot manifest.
2. The public snapshot parsers cannot furnish the hard gates' complete,
   pool-bound and attributable evidence. Unknown developer history, owner
   coverage, extensions, LP state, bundle supply, or wallet qualification
   blocks entry.
3. There is no validated executable quote/depth source or actual fee/slippage/
   impact/network-cost semantics. Cost scenarios would be hypothetical
   sensitivity analysis only; no execution-realistic result is supported.
4. Restart state, daily gate state, reservations and event deduplication are
   in-memory only. Interrupted runs are unrecoverable and must fail closed;
   durable journal design/review is a prerequisite for any real-data run.
5. Independent full-source, security and accounting review is required. This
   packet does not launch a run, authorize recurring work, spend money, use
   credentials, access a wallet, send orders, or alter canonical Paper
   admission.

The acceptable outcome of a later evidence-bounded scan may be zero entries.
Do not weaken a filter to create a trade.
