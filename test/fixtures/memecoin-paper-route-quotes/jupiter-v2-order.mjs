import {
  SYNTHETIC_MINT,
  SYNTHETIC_POOL,
  SYNTHETIC_QUOTE
} from "../../../scripts/memecoin-paper/synthetic-fixtures.mjs";

export const SYNTHETIC_ORDER_FIXTURE = "SYNTHETIC_FIXTURE_ONLY";

export function syntheticOrderResponse({
  inputMint = SYNTHETIC_MINT,
  outputMint = SYNTHETIC_QUOTE,
  inAmount = "100000000",
  outAmount = "17057460",
  otherAmountThreshold = "16972172",
  slippageBps = 50,
  router = "metis",
  routePlan,
  expireAt,
  ...overrides
} = {}) {
  return {
    fixtureLabel: SYNTHETIC_ORDER_FIXTURE,
    schemaVersion: "2.0.0",
    body: {
      mode: "ultra",
      inputMint,
      outputMint,
      inAmount,
      outAmount,
      otherAmountThreshold,
      swapMode: "ExactIn",
      slippageBps,
      priceImpact: 0.02,
      feeBps: 2,
      feeMint: outputMint,
      platformFee: {amount: "100", feeBps: 2, feeMint: outputMint},
      signatureFeeLamports: 5000,
      prioritizationFeeLamports: 2500,
      rentFeeLamports: 0,
      router,
      transaction: null,
      requestId: "synthetic-order-1",
      ...(expireAt === undefined ? {} : {expireAt}),
      routePlan: routePlan ?? [{
        swapInfo: {
          ammKey: SYNTHETIC_POOL,
          label: "Synthetic AMM",
          inputMint,
          outputMint,
          inAmount,
          outAmount
        },
        percent: 100,
        bps: 10_000
      }],
      ...overrides
    }
  };
}
