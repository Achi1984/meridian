import path from "node:path";
import {lstat, realpath} from "node:fs/promises";
import os from "node:os";
import {CheckpointStore} from "../../../scripts/memecoin-paper/checkpoint-store.mjs";
import {PaperCheckpointSession} from "../../../scripts/memecoin-paper/checkpoint-session.mjs";

const PREFIX = "meridian-paper-host-verification-";
const [requestedDirectory, phase, runId, startedAtText] = process.argv.slice(2);
const temporaryRoot = await realpath(os.tmpdir());
const directory = path.resolve(requestedDirectory ?? "");
const parsedStart = Number(startedAtText);
if (path.dirname(directory) !== temporaryRoot ||
    !path.basename(directory).startsWith(PREFIX) ||
    !Number.isSafeInteger(parsedStart) ||
    !/^[A-Za-z0-9._:-]{1,120}$/.test(runId ?? "")) {
  process.exit(64);
}
const info = await lstat(directory);
if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
  process.exit(64);
}

const initialStore = await CheckpointStore.open(directory);
const initialSession = await PaperCheckpointSession.open({
  store: initialStore,
  runId,
  startedAt: parsedStart
});
await initialSession.close();

const store = await CheckpointStore.open(directory, {
  onPhase(name, details) {
    if (name === phase && details.sequence === 1) process.exit(74);
  }
});
const session = await PaperCheckpointSession.open({store});
const result = await session.riskSnapshot("fixture-risk-snapshot", {
  now: parsedStart + 1_000,
  marks: []
});
if (result.status !== "PASS") process.exit(75);
await session.close();
