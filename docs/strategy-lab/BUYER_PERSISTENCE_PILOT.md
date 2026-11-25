# Solana buyer persistence and immediate exit costs

Run buyer_persistence_pilot.py with an output JSON path and one or more preselected Solana pool addresses. This standalone observer uses public pool data and Jupiter indicative quotes. It never submits a transaction.

All four arms start with new_pool_watch.qualifies over two snapshots about 75 seconds apart. This reproduces the numerical entry conditions. The pilot uses a fixed convenience sample and does not reproduce live discovery, launchpad restrictions, position sizing across simultaneous positions, or portfolio exits.

At the second snapshot, count distinct provider-reported sender addresses buying the target mint in each of two adjacent five-minute windows. Exclude anomalous swaps. Each sender counts once per window even if routed swaps generate multiple rows. Require at least three earlier buyers and three later buyers absent from the first window. Wallets are a per-pool proxy. 'New' means absent in the preceding five minutes. A response whose earliest record does not precede both windows yields unknown. A fresh HTTP response is not proof of complete or timely indexing.

Independently, request a 20 USDC immediate purchase and resale quote. The cost filter requires a conservative round-trip loss of at most 3%, including the existing 0.10 USDC combined fee assumption. Both cutoffs were fixed before sampling. Compare baseline alone, baseline plus buyers, baseline plus costs, and baseline plus both.

After observing both filters, quote the same hypothetical purchase for every measured pool. Approximately three minutes later, quote a sale of the minimum bought quantity; use the minimum resale and deduct both modeled fees. Record actual request times. Prices remain indicative. Measure even when the baseline declines entry so a diagnostic outcome can be separated from a strategy trade. An arm with zero entries gets an undefined return. Missing quotes produce an unavailable outcome; report coverage before comparing arms.
