# Offline mint safety evidence contract

This package decodes caller-injected Solana mint-account data for offline paper
research. It performs no RPC, filesystem, or network access and imports no
provider, ledger, stage, runner, UI, or quote module. Its result is caller-supplied
evidence normalized as `DECODED_UNVERIFIED`, or `UNAVAILABLE`; it never authorizes
an action, produces a safety `PASS`, or widens an existing filter.

## Input binding and limits

`decodeMintSafetyEvidence()` accepts:

- `chainId: "solana"`.
- `expectedMint`, `requestedMint`, and `accountPubkey`, which must be valid
  32-byte base58 addresses and exactly equal.
- `rpcResult.context.slot`, a nonnegative slot, and `observedAt`, a valid
  millisecond timestamp or parseable date string. Both are required and retained
  in the result.
- `rpcResult.value.owner` and `rpcResult.value.data`, where data must be the
  canonical RPC `[base64String, "base64"]` tuple. The account owner must be the
  classic SPL Token or Token-2022 program ID.

Data is capped at 10,240 bytes and 64 TLV entries. Classic mints must be exactly
82 bytes. Token-2022 extended mints must have zero padding through byte 164, the
Mint account-type marker at byte 165, and well-formed TLV entries beginning at
byte 166. Truncated, oversized, noncanonical, incorrectly bound, uninitialized,
duplicate, unknown, or malformed data produces `UNAVAILABLE` with explicit
`reasonCodes`; all authority and extension states then remain `UNAVAILABLE`.
No missing or invalid field is treated as a revoked authority or absent extension.

The RPC response does not echo the requested address. Therefore
`requestedMint` and `accountPubkey` are caller-provided binding assertions, not
proof that a provider returned authentic bytes for that address. Slot and time
are likewise caller assertions: this package does not authenticate RPC,
establish finality, validate freshness policy, or prove that the data is current.

## Decoded facts

The 82-byte Mint base reports the raw supply as an integer string, decimals, and
initialized state. Each authority is separately `ABSENT`, `PRESENT`, or
`UNAVAILABLE`; only a fully decoded canonical `None` option is reported absent.
The decoder requires the unused key bytes in a `None` option to be zero, a
strictness beyond SPL's unpacker, and rejects other option tags.

Token-2022 TLV interpretation is intentionally limited to the following
verified mint extensions:

| Extension | Reported fields |
| --- | --- |
| `TransferFeeConfig` | Config and withdraw authorities, withheld amount, and both epoch fee schedules. It does not select a schedule without the current epoch or calculate a transfer's fee. |
| `TransferHook` | Optional authority and hook program ID. A configured hook's behavior is not analyzed. |
| `PermanentDelegate` | Whether an optional permanent transfer/burn delegate is present and its address. |
| `DefaultAccountState` | Whether new token accounts default to initialized or frozen; this does not describe existing token-account state. |

Any other extension type fails closed as unsupported. An extension's presence is
reported as evidence, not automatically characterized as harmful or safe. No
extension claim proves runtime behavior or excludes behavior outside this
decoder's supported set.

Mint bytes do not establish LP burn/lock or lock duration, complete
owner-aggregated concentration, developer attribution, bundled supply, or
smart-wallet provenance. Those facts are always `UNKNOWN`. In particular,
top-20 token accounts are not unique owners and do not establish the full owner
distribution.

## Pinned primary references

The format table was checked against immutable official SPL source snapshots:

- Classic SPL Token, commit
  [`737788ff5bcc3f1f44cfb222f25483187650be76`](https://github.com/solana-program/token/tree/737788ff5bcc3f1f44cfb222f25483187650be76):
  [`interface/src/state.rs`](https://github.com/solana-program/token/blob/737788ff5bcc3f1f44cfb222f25483187650be76/interface/src/state.rs)
  defines the 82-byte mint, field offsets, little-endian supply, initialized
  byte, and `COption<Pubkey>` tags.
- Token-2022, commit
  [`986b3aa58cbcc40dea12b369912017a4066804e7`](https://github.com/solana-program/token-2022/tree/986b3aa58cbcc40dea12b369912017a4066804e7):
  [`interface/src/state.rs`](https://github.com/solana-program/token-2022/blob/986b3aa58cbcc40dea12b369912017a4066804e7/interface/src/state.rs)
  defines the base mint state;
  [`interface/src/extension/mod.rs`](https://github.com/solana-program/token-2022/blob/986b3aa58cbcc40dea12b369912017a4066804e7/interface/src/extension/mod.rs)
  defines account types, extension IDs, and bounded TLV framing;
  [`interface/src/extension/transfer_fee/mod.rs`](https://github.com/solana-program/token-2022/blob/986b3aa58cbcc40dea12b369912017a4066804e7/interface/src/extension/transfer_fee/mod.rs),
  [`interface/src/extension/transfer_hook/mod.rs`](https://github.com/solana-program/token-2022/blob/986b3aa58cbcc40dea12b369912017a4066804e7/interface/src/extension/transfer_hook/mod.rs),
  [`interface/src/extension/permanent_delegate.rs`](https://github.com/solana-program/token-2022/blob/986b3aa58cbcc40dea12b369912017a4066804e7/interface/src/extension/permanent_delegate.rs),
  and
  [`interface/src/extension/default_account_state/mod.rs`](https://github.com/solana-program/token-2022/blob/986b3aa58cbcc40dea12b369912017a4066804e7/interface/src/extension/default_account_state/mod.rs)
  define the supported extension fields and meanings.

Supplementary official semantics:

- [Solana Token Extensions](https://solana.com/docs/tokens/extensions)
- [SPL Token-2022 Extensions](https://spl.solana.com/token-2022/extensions)

The pinned implementation source, not a mutable documentation page, is the
reference for byte layouts and extension IDs. This package was checked on
2026-11-01. Any extension added after the pinned snapshot remains unsupported
until its semantics and layout are reviewed.

## Synthetic-only tests

All generated account bytes are labelled
`SYNTHETIC_ONLY_NOT_CHAIN_DATA`; they are not RPC captures or mint evidence.
Run the focused offline test suite with:

```sh
node --test test/memecoin-paper-token-safety.test.js
```
