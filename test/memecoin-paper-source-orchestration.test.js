import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {EvidenceWarmupStore} from "../scripts/memecoin-paper/evidence-warmup/index.mjs";
import {PaperLedger} from "../scripts/memecoin-paper/ledger.mjs";
import {createMarketQuoteAdapter} from "../scripts/memecoin-paper/market-quote-adapter.mjs";
import {createPaperProviderWarmupHandoff} from "../scripts/memecoin-paper/provider-warmup-handoff/index.mjs";
import {
  evaluationRequest,
  makeBirdeyeObservation,
  makeHandoffFixture,
  makeSyntheticHistoryPipeline
} from "./fixtures/memecoin-paper-provider-warmup-handoff/synthetic.mjs";
import {syntheticOrderResponse} from "./fixtures/memecoin-paper-route-quotes/jupiter-v2-order.mjs";

test("generated provider data through warmup, evaluation, quote and ledger remains no-entry", async t => {
  const fixture = makeHandoffFixture();
  const parent = await mkdtemp(path.join(os.tmpdir(), "paper-source-orchestration-"));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const store = new EvidenceWarmupStore(path.join(parent, "store"), {enabled: true});
  const handoff = createPaperProviderWarmupHandoff({
    enabled: true,
    store,
    datasetId: "orchestration-test",
    runId: "synthetic-only",
    identity: fixture.identity,
    clock: () => fixture.assembledAt
  });
  const {observation, request, calls} = await makeBirdeyeObservation(fixture);
  assert.equal(calls.length, 1);
  assert.equal(observation.status, "SOURCE_BOUND");
  const result = await handoff.runOffline({
    observation,
    request,
    pipeline: makeSyntheticHistoryPipeline(fixture),
    evaluationRequest: evaluationRequest(fixture),
    priceEndpoints: [{mint: fixture.identity.mint, atMs: fixture.candidateT, denomination: "USD"}]
  });
  assert.equal(result.status, "OFFLINE_EVALUATED");
  assert.equal(result.trust, "UNKNOWN");
  assert.equal(result.completeness, "UNKNOWN");
  assert.equal(result.coverage.exactAvailable.prices.length, 0);
  assert.match(result.datasetDigest, /^[a-f0-9]{64}$/);
  const persisted = await store.read("orchestration-test");
  assert.equal(persisted.digest, result.datasetDigest);
  assert.equal(persisted.document.records[0].payload.receipt.payloadSha256,
    observation.receipt.payloadSha256);
  assert.equal(result.evaluation.analysis.status, "BLOCKED");
  assert.equal(result.evaluation.executionAuthorized, false);
  assert.equal(result.evaluation.realDataEntryEligible, false);

  const identity = {...fixture.identity, decimals: fixture.candidate.decimals};
  const body = syntheticOrderResponse({
    inputMint: identity.quote,
    outputMint: identity.mint,
    routePlan: [{
      swapInfo: {
        ammKey: identity.pool,
        label: "Synthetic AMM",
        inputMint: identity.quote,
        outputMint: identity.mint,
        inAmount: "100000000",
        outAmount: "17057460"
      },
      percent: 100,
      bps: 10_000
    }]
  }).body;
  let quoteCalls = 0;
  const quoteAdapter = createMarketQuoteAdapter({
    enabled: true,
    clock: () => fixture.decisionAt + 1,
    transport: async () => {
      quoteCalls += 1;
      return new Response(JSON.stringify(body), {headers: {"content-type": "application/json"}});
    }
  });
  const quote = await quoteAdapter.getPaperQuote({
    identity,
    side: "ENTRY",
    amountAtoms: "100000000",
    quoteDecimals: 6,
    candidateSampledAt: fixture.candidateT,
    authorizedAt: fixture.decisionAt,
    slippageBps: 50
  });
  assert.equal(quoteCalls, 1);
  assert.equal(quote.authorizationEligible, false);
  assert.equal(quote.quoteCandidate.route.binding.status, "SINGLE_POOL_MATCH");
  assert.equal(quote.quoteCandidate.priceMicros, null);
  assert.equal(quote.quoteCandidate.executable, false);
  for (const component of Object.values(quote.costEvidence.components)) {
    assert.equal(component.status, "UNKNOWN");
    assert.equal(component.amount, null);
  }

  const ledger = new PaperLedger({now: fixture.decisionAt});
  const authorization = ledger.authorizeEntry({
    authorizationId: "source-orchestration-test",
    candidate: result.evaluation.candidate,
    filterResult: result.evaluation.filters,
    scoreResult: result.evaluation.analysis,
    tickId: "synthetic-tick",
    now: fixture.decisionAt
  });
  assert.equal(authorization.status, "REJECT");
  assert.equal(ledger.summary().openPositions.length, 0);
});

test("forged provider receipt cannot publish or reach the evaluation", async () => {
  const fixture = makeHandoffFixture();
  const {observation, request} = await makeBirdeyeObservation(fixture);
  observation.receipt.payloadSha256 = "0".repeat(64);
  let calls = 0;
  const store = {
    async publish() { calls += 1; },
    async read() { calls += 1; }
  };
  const handoff = createPaperProviderWarmupHandoff({
    enabled: true,
    store,
    datasetId: "forged-test",
    runId: "synthetic-only",
    identity: fixture.identity,
    clock: () => fixture.assembledAt
  });
  const result = await handoff.runOffline({
    observation,
    request,
    pipeline: makeSyntheticHistoryPipeline(fixture),
    evaluationRequest: evaluationRequest(fixture)
  });
  assert.equal(result.reason, "PROVIDER_OBSERVATION_UNBOUND");
  assert.equal(calls, 0);
});
