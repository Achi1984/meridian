# Raydium CPMM LP protection source

This source measures a bounded, selected-pool LP-account snapshot. It is
disabled by default, accepts only the fixed Raydium CPMM source model, and
requires an injected transport and clock when explicitly enabled. It does not
perform live acquisition in tests, change the run manifest, authorize a
candidate, or enable real-data entry or execution.

The collector consumes the `DECODED_UNVERIFIED` pool proof from the separate
pool-evidence source without importing that branch's implementation. It binds
the proof's chain, mint, selected pool, quote, CPMM program ID, source/decoder
revision, LP mint, LP mint supply, pool-state counter, source slot, receipt
time, pool-state digest, and response digest. It then makes only two fixed
origin JSON-RPC reads:

1. `getTokenSupply` for that LP mint.
2. `getProgramAccounts` for the classic SPL Token program with an exact LP-mint
   filter.

Both reads require `finalized` commitment and must match the pool proof's exact
slot; the account balances must sum exactly to the current mint supply. Each
raw response is SHA-256-bound. The collector allows at most two requests,
1 MiB per response, 2 MiB total, 10,000 accounts, five seconds per request,
and 15 seconds elapsed. It uses no retries, caller-provided origin, credentials,
or mutable provider configuration. Cancellation is honored.

Amounts are raw integer LP base units. The output reports exact
`potentiallyUnprotectedAtoms` for initialized accounts with signer-address
authorities and `unknownProtectionAtoms` for the residual pool-counter
denominator. It also separates program-derived-address custody candidates,
frozen-account balances, and the difference between the pool state's LP
counter and current LP mint supply. These categories are diagnostic and do not
assert that a key is controlled, a PDA is unrecoverable, or a frozen account
cannot be thawed. Without transaction-bound SPL burn evidence,
`protectedAtoms`/`protectionDenominatorAtoms` stay null. The pool-counter
difference is not itself classified as burned supply: it includes the
100-raw-unit initialization reserve described by the pinned CPMM source.
Historical burn annotations remain diagnostic only and are never added to
current mint supply.

## Supported mechanism: standalone SPL Token burns

The supported source-level mechanism is SPL Token `Burn`/`BurnChecked`, not
Raydium Burn & Earn. The pinned Token Program processor burns the amount from
the source account and subtracts it from mint supply. A burned unit cannot be
transferred, unlocked, or withdrawn later. A burn that occurs in a transaction
which invokes the pinned Raydium CPMM program is rejected: CPMM's normal
`withdraw` burns LP while returning pool assets, so that burn is not protection.

The collector does not fetch transactions. Callers may supply bounded
`burnTransactions` records containing the selected pool and LP mint, a
finalized commitment claim, signature, source slot, exact `claimedBurnAtoms`,
the exact `denominatorAtoms`, requested `holdUntil`, raw JSON-RPC `responseJson`,
and its SHA-256 digest. The decoder verifies the digest and transaction
signature/slot/success fields, requires a complete `innerInstructions` array,
decodes parsed classic SPL Token burns for this exact LP mint, rejects any
transaction invoking CPMM, and verifies each claim amount against its burn
instructions. Repeated signatures, failed transactions, mismatched mint,
amount, denominator, or digest fail closed.

For this pinned CPMM model, the protection denominator is
`PoolState.lp_supply - 100`: initialization sets the counter to total liquidity
while minting 100 fewer raw units, and deposit/withdraw instructions adjust the
counter by the LP amount minted/burned. A complete burn history must reconcile
`currentMintSupply + eligibleBurns == protectionDenominator`; otherwise the
history is incomplete and no protected amount is asserted. Full source-semantic
coverage requires a zero current supply and eligible burns equal to the exact
denominator. Partial coverage is measured exactly when history reconciles but
remains `UNKNOWN`; no partial threshold is accepted.

Passing `LP_BURN_FIXTURE_TRUST_POLICY` explicitly allows the decoder to report a
`PASS` only in its `burnAssessment` fixture-only field for a coherent synthetic
full-burn case. This does not change `lpProtection.status` from `UNKNOWN`,
does not set `verified`, and does not make adapter evidence acceptable.
Burned units have no release/admin recovery path; the mint authority may issue
new units, which is a separate, unverified deployment and policy question.

## Semantic result and blockers

The output always leaves `lpProtection.status` as `UNKNOWN`, `verified: false`,
and `review: null`. Exact, digest-bound burn quantities may populate
`protectedAtoms` and `protectionDenominatorAtoms` when the entire burn history
reconciles, but this remains unverified source evidence. A claimed lock is
recorded as either early-unlocked or unsupported; duplicate lock accounts and
duplicate burn signatures fail closed. No partial-coverage threshold is
accepted.

The pinned official Raydium CPMM source is
[`raydium-cp-swap@3d69122790e97cd6aff24e8ba95940793773f58c`](https://github.com/raydium-io/raydium-cp-swap/tree/3d69122790e97cd6aff24e8ba95940793773f58c).
The mainnet program address is
`CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`. The matching official IDL is
pinned at
[`raydium-idl@e7e0c96fe77bcf6a020b84a44c47a722aac8e359`](https://github.com/raydium-io/raydium-idl/blob/e7e0c96fe77bcf6a020b84a44c47a722aac8e359/raydium_cpmm/raydium_cp_swap.json).

The reviewed CPMM implementation does **not** make LP holders' tokens
withdraw-proof. The normal `withdraw` instruction requires the LP-account owner
to sign, checks the pool's current withdraw status, burns LP from that owner's
account, and transfers the proportional vault assets to that owner. The admin
can change pool status, including disabling withdrawals; a temporary disabled
withdraw bit is not an irreversible lock. Pool-fee collection is a separate
fee-balance operation, not evidence that LP principal is permanently
inaccessible.

Initialization sets `lock_lp_amount = 100`, mints `liquidity - 100` to the
creator, and records the full `liquidity` in `PoolState.lp_supply`. This is a
100-raw-unit initial supply difference, not custody of the creator's remaining
LP. The pool state and LP mint therefore cannot, by themselves, establish the
amount of genuinely burned supply or an LP-lock numerator.

No positive live-deployment claim is supported until all of these are
independently established:

- The deployed mainnet program-data account, loader state, upgrade authority,
  and executable bytes for both CPMM and classic SPL Token match their reviewed
  source semantics; source commit hashes are not deployed-binary hashes.
- A selected pool's full, same-context LP account census is authentic and
  complete beyond the injected RPC response claim.
- Any alleged custodian/lock program's deployed code and account semantics
  prove that the exact LP amount cannot be transferred, unlocked, or withdrawn
  by an administrator or owner before the requested hold ends. The official
  Burn & Earn program address reference notes that its implementation source
  is not public; no such lock model is accepted here.
- The complete standalone SPL burn history through the selected snapshot is
  independently tied to unique finalized transactions and reconciles exactly
  to the current mint supply and pool counter. Current supply already reflects
  completed burns and must not be reduced by those burns again.

Consequently, a synthetic zero-supply scenario can reconcile the complete
account census and measure the pool-counter gap, but remains `UNKNOWN`; it is
not a fabricated `PASS`. The source emits an adapter-shaped record for review,
but its missing review and `verified: false` keep both the current filter and
the separate market-evidence adapter fail-closed. No numeric partial-protection
threshold is introduced.

## Pinned primary references

- [Official Raydium program addresses at pinned docs revision](https://github.com/raydium-io/raydium-docs-v1/blob/3699439bcad7ebdb7d65ba62cb896e93ecd3a204/reference/program-addresses.mdx#L1-L44):
  CPMM deployment address, program admin distinction, and Burn & Earn source
  availability.
- [CPMM `lib.rs` at pinned source revision](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/lib.rs#L20-L24):
  mainnet program ID and admin identity.
- [CPMM initializer](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/instructions/initialize.rs#L48-L100)
  and [initial liquidity calculation](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/instructions/initialize.rs#L330-L410):
  LP mint authority, creator LP account, the 100-unit withheld amount, and
  `PoolState.lp_supply` initialization.
- [CPMM `PoolState`](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/states/pool.rs#L65-L115):
  layout and LP supply counter meaning.
- [CPMM `withdraw`](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/instructions/withdraw.rs#L12-L220)
  and [pool status update](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/instructions/admin/update_pool_status.rs#L1-L22):
  signer-bound withdrawal, LP burn plus asset transfers, state-counter decrement,
  and reversible status control.
- [CPMM deposit](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/instructions/deposit.rs):
  LP minting and matching state-counter increment.
- [Solana `getTokenSupply`](https://solana.com/docs/rpc/http/gettokensupply)
  and [Solana `getProgramAccounts`](https://solana.com/docs/rpc/http/getprogramaccounts):
  finalized account response and context-slot semantics.
- [SPL Token processor at pinned commit](https://github.com/solana-program/token/blob/737788ff5bcc3f1f44cfb222f25483187650be76/program/src/processor.rs):
  official `Burn`/`BurnChecked` implementation; finalized burns reduce current
  mint supply and cannot be reversed. The exact deployed Token Program bytes
  remain unverified.

The official source and IDL references describe reviewed source interfaces and
logic only. The live mainnet deployment, lock contract, RPC authenticity, and
reviewer identity are not verified by this packet.

## Offline verification

Run the focused synthetic-only suite:

```sh
node --test test/memecoin-paper-lp-protection-source.test.js
```

Fixtures exercise source-shaped pool proofs, same-slot supply/census
reconciliation, exact integer classification, identity/program mismatches,
early unlock, duplicate lock/burn claims, finalized SPL burn decoding,
full/partial coverage, CPMM withdrawal-path exclusion, digest and amount
binding, supply/context changes, and unsupported admin/lock assertions. The
fixtures contain no captured chain data and perform no network request.
