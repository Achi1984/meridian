# Solana transaction-history evidence source

This module is a bounded, read-only source for a narrow Raydium CPMM swap
observation path. It is disabled by default, uses only injected transport, and
never creates orders, mutates a ledger, enables a runner, or authorizes entries.

It calls only Solana JSON-RPC `getSignaturesForAddress` and `getTransaction`
at the fixed mainnet origin. Responses are bounded by request, byte, duration
and cancellation limits. Each response records request metadata and a SHA-256
digest. The injected transport and local clock are not authenticated.

Only transactions with a pool account, Raydium/swap log marker, finalized slot,
bounded block time, and unambiguous selected-mint vault delta are emitted.
Unsupported, malformed, stale, redirected or cancelled inputs fail closed or
remain excluded. The output is observational evidence only:
`executionAuthorized:false`, `complete:false`, and no profitability or
entry claim.

Bundle/launch-window semantics and qualified-smart-wallet criteria remain
explicit product decisions; this source does not infer them.
