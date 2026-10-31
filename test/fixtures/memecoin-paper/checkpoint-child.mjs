import {PaperCheckpointSession} from "../../../scripts/memecoin-paper/checkpoint-session.mjs";
import {CheckpointStore} from "../../../scripts/memecoin-paper/checkpoint-store.mjs";

const [directory, crashPhase] = process.argv.slice(2);
const startedAt = Date.parse("2026-01-01T10:00:00Z");
if (!directory || !crashPhase) process.exit(2);

if (crashPhase === "hold") {
  await CheckpointStore.open(directory);
  process.stdout.write("ready\n");
  await new Promise(() => {});
}

const initialStore = await CheckpointStore.open(directory);
const initialSession = await PaperCheckpointSession.open({
  store: initialStore,
  runId: "checkpoint-child",
  startedAt
});
await initialSession.close();

const store = await CheckpointStore.open(directory, {
  onPhase(phase) {
    if (phase === crashPhase) process.exit(74);
  }
});
const session = await PaperCheckpointSession.open({store});
await session.riskSnapshot("child-risk", {now: startedAt + 1000, marks: []});
await session.close();
process.exit(0);
