import {createHash} from "node:crypto";
import {lstat, mkdir, realpath} from "node:fs/promises";
import path from "node:path";
import {
  canonicalCheckpointBytes, CheckpointStore
} from "../memecoin-paper/checkpoint-store.mjs";
import {advanceChallengeState, replayChallengeState} from "./guard.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from "./policy.mjs";

const FORMAT_VERSION = 1;
const TIP_SCHEMA = "PAPER_CAPITAL_CHALLENGE_TIP_V1";
const MAX_HISTORY_BYTES = 512 * 1024;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) {
    throw new Error(`INVALID_${label}`);
  }
}

function makeTip(revision, digest) {
  return Object.freeze({
    schemaVersion: TIP_SCHEMA,
    campaignId: POLICY.campaignId,
    currency: POLICY.currency,
    policyVersion: POLICY.version,
    revision,
    digest
  });
}

function validateTip(tip) {
  exactKeys(tip, [
    "schemaVersion", "campaignId", "currency", "policyVersion", "revision", "digest"
  ], "EXPECTED_TIP");
  if (tip.schemaVersion !== TIP_SCHEMA ||
      tip.campaignId !== POLICY.campaignId ||
      tip.currency !== POLICY.currency ||
      tip.policyVersion !== POLICY.version ||
      !Number.isSafeInteger(tip.revision) || tip.revision < 0 ||
      typeof tip.digest !== "string" || !DIGEST_PATTERN.test(tip.digest)) {
    throw new Error("INVALID_EXPECTED_TIP");
  }
  return tip;
}

function checkpointValue(records) {
  return {
    version: FORMAT_VERSION,
    campaignId: POLICY.campaignId,
    currency: POLICY.currency,
    policyVersion: POLICY.version,
    sequence: records.length - 1,
    records
  };
}

function assertFileType(directory, name, {required = false} = {}) {
  return lstat(path.join(directory, name)).then(info => {
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("UNSAFE_HISTORY_PATH");
    }
    return true;
  }).catch(error => {
    if (error.code === "ENOENT" && !required) return false;
    if (error.code === "ENOENT") throw new Error("HISTORY_NOT_FOUND");
    throw error;
  });
}

async function assertDirectory(directory, {mustNotExist = false} = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory) ||
      path.resolve(directory) !== directory) {
    throw new TypeError("history directory must be an absolute normalized path");
  }
  try {
    const info = await lstat(directory);
    if (mustNotExist) throw new Error("HISTORY_ALREADY_EXISTS");
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("UNSAFE_HISTORY_PATH");
  } catch (error) {
    if (error.code === "ENOENT" && mustNotExist) return;
    if (error.code === "ENOENT") throw new Error("HISTORY_NOT_FOUND");
    throw error;
  }
}

async function assertTrustedParent(directory) {
  const parent = path.dirname(directory);
  const info = await lstat(parent).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink() ||
      await realpath(parent).catch(() => null) !== parent) {
    throw new Error("UNTRUSTED_HISTORY_PARENT");
  }
}

async function decodeCheckpoint(result) {
  if (result.status !== "OK") return result;
  let checkpoint;
  try {
    checkpoint = JSON.parse(result.bytes.toString("utf8"));
    if (!canonicalCheckpointBytes(checkpoint).equals(result.bytes)) {
      throw new Error("noncanonical checkpoint");
    }
    exactKeys(checkpoint, [
      "version", "campaignId", "currency", "policyVersion", "sequence", "records"
    ], "HISTORY");
    if (checkpoint.version !== FORMAT_VERSION) throw new Error("HISTORY_VERSION_MISMATCH");
    if (checkpoint.campaignId !== POLICY.campaignId) throw new Error("CAMPAIGN_ID_MISMATCH");
    if (checkpoint.currency !== POLICY.currency) throw new Error("CURRENCY_MISMATCH");
    if (checkpoint.policyVersion !== POLICY.version) throw new Error("POLICY_VERSION_MISMATCH");
    if (!Array.isArray(checkpoint.records) ||
        checkpoint.records.length !== checkpoint.sequence + 1 ||
        checkpoint.records.length < 1 ||
        checkpoint.records.length > POLICY.maxJournalObservations + 1) {
      throw new Error("INVALID_HISTORY");
    }
    const createRecord = checkpoint.records[0];
    exactKeys(createRecord, ["kind", "sequence", "predecessorHash"], "HISTORY_RECORD");
    if (createRecord.kind !== "CREATE" || createRecord.sequence !== 0 ||
        createRecord.predecessorHash !== null) {
      throw new Error("INVALID_HISTORY");
    }
    const observations = [];
    for (let index = 1; index < checkpoint.records.length; index += 1) {
      const record = checkpoint.records[index];
      exactKeys(record, ["kind", "sequence", "predecessorHash", "observation"], "HISTORY_RECORD");
      const predecessor = checkpointValue(checkpoint.records.slice(0, index));
      if (record.kind !== "OBSERVATION" || record.sequence !== index ||
          record.predecessorHash !== hash(canonicalCheckpointBytes(predecessor))) {
        throw new Error("HISTORY_CHAIN_MISMATCH");
      }
      observations.push(record.observation);
    }
    const state = replayChallengeState({
      campaignId: checkpoint.campaignId,
      currency: checkpoint.currency,
      policyVersion: checkpoint.policyVersion,
      observations
    });
    if (!canonicalCheckpointBytes(state.observations).equals(
      canonicalCheckpointBytes(observations))) {
      throw new Error("HISTORY_REPLAY_MISMATCH");
    }
    return {
      status: "OK",
      state,
      tip: makeTip(checkpoint.sequence, result.hash),
      checkpoint
    };
  } catch (error) {
    return {status: "CORRUPT", reason: error.message || "history is invalid"};
  }
}

async function readVerified(store) {
  const result = await store.readCheckpoint();
  return decodeCheckpoint(result);
}

async function validateStoreFiles(directory, {requireCheckpoint = true} = {}) {
  await assertFileType(directory, "checkpoint.json", {required: requireCheckpoint});
  await assertFileType(directory, ".checkpoint-pending");
}

export async function inspectChallengeHistory(directory) {
  await assertDirectory(directory);
  await validateStoreFiles(directory, {requireCheckpoint: false});
  const store = new CheckpointStore(directory, {maxBytes: MAX_HISTORY_BYTES});
  return readVerified(store);
}

export async function reconcileChallengeHistory(directory) {
  await assertDirectory(directory);
  await validateStoreFiles(directory, {requireCheckpoint: false});
  const store = new CheckpointStore(directory, {maxBytes: MAX_HISTORY_BYTES});
  const result = await store.reconcilePending();
  return result.status === "OK" ? decodeCheckpoint(result) : result;
}

export class ChallengeHistoryStore {
  #store;
  #directory;
  #state;
  #tip;
  #blocked = false;
  #closed = false;

  constructor(store, directory, state, tip) {
    this.#store = store;
    this.#directory = directory;
    this.#state = state;
    this.#tip = tip;
  }

  static async createNew(directory, {onPhase} = {}) {
    await assertDirectory(directory, {mustNotExist: true});
    await assertTrustedParent(directory);
    if (onPhase !== undefined && typeof onPhase !== "function") {
      throw new TypeError("history phase hook must be a function");
    }
    if (onPhase) await onPhase("before-create-directory", {directory});
    try {
      await mkdir(directory);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("HISTORY_ALREADY_EXISTS");
      throw error;
    }
    await assertDirectory(directory);
    const store = await CheckpointStore.open(directory, {maxBytes: MAX_HISTORY_BYTES, onPhase});
    try {
      const existing = await store.readCheckpoint();
      if (existing.status !== "ABSENT") throw new Error("HISTORY_ALREADY_EXISTS");
      const records = [{kind: "CREATE", sequence: 0, predecessorHash: null}];
      const bytes = canonicalCheckpointBytes(checkpointValue(records));
      const commit = await store.commitCheckpoint({
        expectedSequence: -1,
        expectedHash: null,
        candidateBytes: bytes
      });
      if (commit.status !== "ACK") throw commitError(commit);
      const state = replayChallengeState({
        campaignId: POLICY.campaignId,
        currency: POLICY.currency,
        policyVersion: POLICY.version,
        observations: []
      });
      return new ChallengeHistoryStore(
        store, directory, state, makeTip(commit.sequence, commit.hash));
    } catch (error) {
      if (error.code !== "HISTORY_COMMIT_UNKNOWN" &&
          error.code !== "HISTORY_COMMIT_FAILED") {
        await store.close().catch(() => {});
      }
      throw error;
    }
  }

  static async reopenExisting(directory, {expectedTip, onPhase} = {}) {
    validateTip(expectedTip);
    await assertDirectory(directory);
    await validateStoreFiles(directory);
    const store = await CheckpointStore.open(directory, {
      maxBytes: MAX_HISTORY_BYTES,
      onPhase
    });
    try {
      const decoded = await readVerified(store);
      if (decoded.status !== "OK") throw historyReadError(decoded);
      if (decoded.tip.revision !== expectedTip.revision ||
          decoded.tip.digest !== expectedTip.digest) {
        throw new Error("STALE_EXPECTED_TIP");
      }
      return new ChallengeHistoryStore(store, directory, decoded.state, decoded.tip);
    } catch (error) {
      await store.close().catch(() => {});
      throw error;
    }
  }

  get state() {
    this.#assertUsable();
    return this.#state;
  }

  get tip() {
    this.#assertUsable();
    return this.#tip;
  }

  async append(observation) {
    this.#assertUsable();
    const nextState = advanceChallengeState(this.#state, observation);
    if (nextState.observations.length === this.#state.observations.length) {
      return {state: this.#state, tip: this.#tip, duplicate: true};
    }
    const record = {
      kind: "OBSERVATION",
      sequence: this.#tip.revision + 1,
      predecessorHash: this.#tip.digest,
      observation: nextState.observations.at(-1)
    };
    const checkpoint = checkpointValue([
      ...this.#checkpointRecords(),
      record
    ]);
    const commit = await this.#store.commitCheckpoint({
      expectedSequence: this.#tip.revision,
      expectedHash: this.#tip.digest,
      candidateBytes: canonicalCheckpointBytes(checkpoint)
    });
    if (commit.status !== "ACK") {
      this.#blocked = true;
      throw commitError(commit);
    }
    this.#state = nextState;
    this.#tip = makeTip(commit.sequence, commit.hash);
    return {state: this.#state, tip: this.#tip, duplicate: false};
  }

  async inspect() {
    this.#assertOpen();
    return inspectChallengeHistory(this.#storeDirectory());
  }

  async reconcilePending() {
    this.#assertOpen();
    const result = await this.#store.reconcilePending();
    return result.status === "OK" ? decodeCheckpoint(result) : result;
  }

  async close() {
    this.#assertOpen();
    if (this.#blocked) throw new Error("HISTORY_RECOVERY_REQUIRED");
    await this.#store.close();
    this.#closed = true;
  }

  #checkpointRecords() {
    return this.#records;
  }

  get #records() {
    return this.#state.observations.reduce((records, observation, index) => {
      const predecessor = checkpointValue(records);
      records.push({
        kind: "OBSERVATION",
        sequence: index + 1,
        predecessorHash: hash(canonicalCheckpointBytes(predecessor)),
        observation
      });
      return records;
    }, [{kind: "CREATE", sequence: 0, predecessorHash: null}]);
  }

  #storeDirectory() {
    return this.#directory;
  }

  #assertOpen() {
    if (this.#closed) throw new Error("HISTORY_STORE_CLOSED");
  }

  #assertUsable() {
    this.#assertOpen();
    if (this.#blocked) throw new Error("HISTORY_RECOVERY_REQUIRED");
  }
}

function commitError(commit) {
  const error = new Error(commit.reason || "history commit did not receive durable acknowledgement");
  error.code = commit.status === "UNKNOWN"
    ? "HISTORY_COMMIT_UNKNOWN"
    : "HISTORY_COMMIT_FAILED";
  error.status = commit.status;
  return error;
}

function historyReadError(result) {
  const error = new Error(result.reason || `history is ${result.status.toLowerCase()}`);
  error.code = `HISTORY_${result.status}`;
  return error;
}
