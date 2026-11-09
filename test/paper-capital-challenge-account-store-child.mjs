import {UsdAccountJournalStore} from
  "../scripts/paper-capital-challenge/account-store.mjs";

const [directory, mode, bindingJson, tipJson, eventJson, crashPhase] = process.argv.slice(2);
const store = await UsdAccountJournalStore.reopenExisting(directory, {
  binding: JSON.parse(bindingJson),
  expectedTip: JSON.parse(tipJson),
  onPhase(phase) {
    if (mode === "crash" && phase === crashPhase) process.exit(74);
  }
});
if (mode === "append" || mode === "crash") {
  const result = await store.append(JSON.parse(eventJson));
  process.stdout.write(JSON.stringify({tip: result.tip, replay: result.replay}) + "\n");
  await store.close();
} else {
  throw new Error("unknown child mode");
}
