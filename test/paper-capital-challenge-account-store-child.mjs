import {UsdAccountJournalStore} from
  "../scripts/paper-capital-challenge/account-store.mjs";
import {runUsdOfflineStream} from
  "../scripts/paper-capital-challenge/offline-runner.mjs";

const [directory, mode, bindingJson, tipJson, eventJson, crashPhase] = process.argv.slice(2);
const store = await UsdAccountJournalStore.reopenExisting(directory, {
  binding: JSON.parse(bindingJson),
  expectedTip: JSON.parse(tipJson),
  onPhase(phase) {
    if (mode === "crash" && phase === crashPhase) process.exit(74);
  }
});
if (mode === "runner-retry") {
  const result = await runUsdOfflineStream({
    store,
    observations: JSON.parse(eventJson),
    decide() {
      throw new Error("strategy callback must not run for persisted retry input");
    }
  });
  process.stdout.write(JSON.stringify(result) + "\n");
  await store.close();
} else if (mode === "append" || mode === "crash") {
  const result = await store.append(JSON.parse(eventJson));
  process.stdout.write(JSON.stringify({tip: result.tip, replay: result.replay}) + "\n");
  await store.close();
} else {
  throw new Error("unknown child mode");
}
