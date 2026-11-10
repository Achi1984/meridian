import { UsdCampaignBudget } from "../scripts/usd-paper-feed/campaign-budget.mjs";
import { createKrakenUsdPublicFeed } from "../scripts/usd-paper-feed/kraken-public.mjs";

const [directory, configJson, tipJson, mode, crashPhase] = process.argv.slice(2);
const configuration = JSON.parse(configJson);
globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN"); };
const store = await UsdCampaignBudget.reopenExisting(directory, {
  configuration, expectedTip: JSON.parse(tipJson),
  onPhase(phase, details) {
    if (mode === "write-crash" && details.sequence === 2 && phase === crashPhase) {
      process.exit(74);
    }
    if (mode === "finalize-crash" && details.sequence === 3 && phase === crashPhase) {
      process.exit(74);
    }
  }
});
if (mode === "continue") {
  const sample = await store.beginSample(125_000);
  const reservation = await store.reserveRequest(sample, "Ticker", 125_000);
  await store.finalizeRequest(reservation, 7, "SUCCESS");
  const second = await store.reserveRequest(sample, "OHLC", 125_000);
  await store.finalizeRequest(second, 9, "SUCCESS");
  await store.completeSample(sample, 125_000, 125_000);
  process.stdout.write(JSON.stringify(store.snapshot()));
  await store.close();
} else {
  const feed = createKrakenUsdPublicFeed({
    now: () => 125_000, monotonicNow: () => 1,
    campaignBudget: { store, configuration, retainRestartTip() {} },
    fetchImpl: async () => {
      if (mode === "before-transport" || mode === "write-crash") process.exit(74);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("partial"));
        },
        pull() {
          if (mode === "partial-body") process.exit(74);
          throw new Error("FIXTURE_BODY_FAILURE");
        }
      }), { headers: { "content-type": "application/json" } });
    }
  });
  await feed.fetchObservation();
}
