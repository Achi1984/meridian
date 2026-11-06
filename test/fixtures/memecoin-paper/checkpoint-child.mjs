import {PaperCheckpointSession} from "../../../scripts/memecoin-paper/checkpoint-session.mjs";
import {CheckpointStore} from "../../../scripts/memecoin-paper/checkpoint-store.mjs";

const [directory, crashPhase, payloadText] = process.argv.slice(2);
const startedAt = Date.parse("2026-01-01T10:00:00Z");
if (!directory || !crashPhase) process.exit(2);

if (crashPhase === "hold") {
  if (!process.send) throw new Error("hold fixture requires an IPC parent");
  await CheckpointStore.open(directory);
  // A pending Promise alone does not keep Node alive. The message listener
  // references the IPC channel until the parent terminates the lock holder.
  process.on("message", message => {
    if (message === "ping") process.send("holding");
  });
  process.once("disconnect", () => process.exit(75));
  process.send("ready");
  await new Promise(() => {});
}

if (crashPhase === "execute-and-hold" || crashPhase === "execute-before-ack") {
  const {runId, startedAt: runStartedAt, authorization, fill} = JSON.parse(payloadText);
  const initialStore = await CheckpointStore.open(directory);
  const initialSession = await PaperCheckpointSession.open({
    store: initialStore,
    runId,
    startedAt: runStartedAt
  });
  const authorizationResult = await initialSession.authorizeEntry("authorize-1", authorization);
  if (authorizationResult.status !== "AUTHORIZED") process.exit(3);
  await initialSession.close();

  const store = await CheckpointStore.open(directory, {
    onPhase(phase) {
      if (crashPhase === "execute-before-ack" && phase === "before-ack") process.exit(74);
    }
  });
  const session = await PaperCheckpointSession.open({store});
  const fillResult = await session.executeEntry("fill-1", fill);
  if (crashPhase === "execute-before-ack") process.exit(4);
  if (!process.send) throw new Error("execute-and-hold fixture requires an IPC parent");
  process.send({authorizationStatus: authorizationResult.status, fillResult});
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
