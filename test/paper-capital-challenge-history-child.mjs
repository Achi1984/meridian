import {ChallengeHistoryStore} from
  "../scripts/paper-capital-challenge/history-store.mjs";
import {once} from "node:events";

const [directory, action, tipJson, observationJson] = process.argv.slice(2);
const expectedTip = JSON.parse(tipJson);
const observation = observationJson ? JSON.parse(observationJson) : null;

const store = await ChallengeHistoryStore.reopenExisting(directory, {
  expectedTip,
  onPhase(phase) {
    if (action === "crash-after-rename" && phase === "after-rename") {
      process.exit(74);
    }
  }
});

if (action === "append" || action === "crash-after-rename") {
  await store.append(observation);
}
console.log(JSON.stringify({tip: store.tip, state: store.state}));
if (action === "hold") {
  process.stdin.resume();
  await once(process.stdin, "end");
  await store.close();
} else if (action !== "crash-after-rename") {
  await store.close();
}
