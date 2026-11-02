# Solana mint-safety evidence bridge

The offline provider normalizer may bind supplied `getAccountInfo` and
`getTokenSupply` responses to mint-safety facts only when both fixed RPC requests
match the candidate, the mint account decodes under its reported token program,
mint supply and decimals match the supply response exactly, slots agree, and
receipt timestamps are present and within the configured acquisition window.
Token amounts remain canonical integer strings; comparisons do not pass through
JavaScript `Number`.

The decoder result remains `DECODED_UNVERIFIED`. The normalizer separately
records `SOURCE_BOUND` evidence, and only then marks the supported authority,
extension, and decimal facts usable by the existing filter. `verified` in those
filter records means the supplied response passed this local request, identity,
consistency, and freshness contract; it does not mean the RPC response is
cryptographically authenticated or trustworthy beyond the injected transport.
No caller label or hash establishes authenticity.

Missing, stale, malformed, contradictory, or unsupported evidence remains
`UNKNOWN` with reason codes. Active authorities and configured supported
Token-2022 restrictions remain explicit facts for the existing filter to reject.
A live transfer-fee configuration or transfer-hook authority is itself a
restriction, even when the current fee is zero or no hook program is configured.
Any source-binding failure also invalidates the supply-only decimal record.
LP protection, owner concentration, developer attribution, bundle analysis,
smart-wallet provenance, and other non-mint facts remain unknown. The bridge
never enables authorization or hard-gate eligibility.
