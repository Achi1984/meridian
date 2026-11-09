import {createHash} from "node:crypto";
import {lstat, mkdir, realpath, rmdir} from "node:fs/promises";
import path from "node:path";
import {
  canonicalCheckpointBytes, CheckpointStore
} from "../memecoin-paper/checkpoint-store.mjs";
import {
  appendUsdAccountEventWithReplay, createUsdAccountJournal, replayUsdAccount
} from "./account.mjs";
import {normalizeBinding, USD_MODELED_COSTS} from "./account-contract.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from "./policy.mjs";

export const USD_ACCOUNT_JOURNAL_VERSION = "USD_PAPER_ACCOUNT_JOURNAL_V2";
export const USD_ACCOUNT_TIP_VERSION = "USD_PAPER_ACCOUNT_TIP_V2";
export const MAX_USD_ACCOUNT_JOURNAL_BYTES = 512 * 1024;
export const MAX_USD_ACCOUNT_JOURNAL_EVENTS = POLICY.maxJournalObservations;
export const MAX_USD_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const TIP_KEYS = [
  "schemaVersion", "campaignId", "currency", "policyVersion",
  "strategyVersion", "costVersion", "nativeInstrument", "revision", "digest"
];

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== expected.length ||
      expected.some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor?.enumerable || !Object.hasOwn(descriptor, "value");
      })) {
    throw new Error(`INVALID_${label}`);
  }
}

function checkpointValue(binding, records) {
  return {
    version: 2,
    schemaVersion: USD_ACCOUNT_JOURNAL_VERSION,
    campaignId: binding.campaignId,
    currency: binding.currency,
    policyVersion: POLICY.version,
    binding,
    costs: USD_MODELED_COSTS,
    nativeInstrument: "BTC/USD",
    maxEvents: MAX_USD_ACCOUNT_JOURNAL_EVENTS,
    maxWindowMs: MAX_USD_ACCOUNT_WINDOW_MS,
    sequence: records.length - 1,
    records
  };
}

function makeTip(binding, revision, digest) {
  return Object.freeze({
    schemaVersion: USD_ACCOUNT_TIP_VERSION,
    campaignId: binding.campaignId,
    currency: binding.currency,
    policyVersion: POLICY.version,
    strategyVersion: binding.strategyVersion,
    costVersion: binding.costVersion,
    nativeInstrument: "BTC/USD",
    revision,
    digest
  });
}

function validateTip(tip, binding) {
  exactKeys(tip, TIP_KEYS, "EXPECTED_TIP");
  if (tip.schemaVersion !== USD_ACCOUNT_TIP_VERSION ||
      tip.campaignId !== binding.campaignId ||
      tip.currency !== binding.currency ||
      tip.policyVersion !== POLICY.version ||
      tip.strategyVersion !== binding.strategyVersion ||
      tip.costVersion !== binding.costVersion ||
      tip.nativeInstrument !== "BTC/USD" ||
      !Number.isSafeInteger(tip.revision) || tip.revision < 0 ||
      typeof tip.digest !== "string" || !DIGEST_PATTERN.test(tip.digest)) {
    throw new Error("INVALID_EXPECTED_TIP");
  }
}

function assertFileType(directory, name, {required = false} = {}) {
  return lstat(path.join(directory, name)).then(info => {
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("UNSAFE_ACCOUNT_PATH");
    return true;
  }).catch(error => {
    if (error.code === "ENOENT" && !required) return false;
    if (error.code === "ENOENT") throw new Error("ACCOUNT_JOURNAL_NOT_FOUND");
    throw error;
  });
}

async function assertDirectory(directory, {mustNotExist = false} = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory) ||
      path.resolve(directory) !== directory) {
    throw new TypeError("account journal directory must be an absolute normalized path");
  }
  try {
    const info = await lstat(directory);
    if (mustNotExist) throw new Error("ACCOUNT_JOURNAL_ALREADY_EXISTS");
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("UNSAFE_ACCOUNT_PATH");
  } catch (error) {
    if (error.code === "ENOENT" && mustNotExist) return;
    if (error.code === "ENOENT") throw new Error("ACCOUNT_JOURNAL_NOT_FOUND");
    throw error;
  }
}

async function assertTrustedParent(directory) {
  const parent = path.dirname(directory);
  const info = await lstat(parent).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink() ||
      await realpath(parent).catch(() => null) !== parent) {
    throw new Error("UNTRUSTED_ACCOUNT_PARENT");
  }
}

function readError(result) {
  const error = new Error(result.reason || `account journal is ${result.status.toLowerCase()}`);
  error.code = `ACCOUNT_JOURNAL_${result.status}`;
  return error;
}

function commitError(commit) {
  const error = new Error(commit.reason || "account journal commit did not receive durable acknowledgement");
  error.code = commit.status === "UNKNOWN"
    ? "ACCOUNT_COMMIT_UNKNOWN"
    : "ACCOUNT_COMMIT_FAILED";
  error.status = commit.status;
  return error;
}

function validateWindow(events) {
  if (events.length > MAX_USD_ACCOUNT_JOURNAL_EVENTS) {
    throw new Error("ACCOUNT_JOURNAL_LIMIT_REACHED");
  }
  if (events.length > 1 &&
      events.at(-1).observedAtMs - events[0].observedAtMs > MAX_USD_ACCOUNT_WINDOW_MS) {
    throw new Error("ACCOUNT_WINDOW_LIMIT_REACHED");
  }
}

function decodeCheckpoint(result, expectedBinding) {
  if (result.status !== "OK") return result;
  try {
    const checkpoint = JSON.parse(result.bytes.toString("utf8"));
    if (!canonicalCheckpointBytes(checkpoint).equals(result.bytes)) {
      throw new Error("noncanonical checkpoint");
    }
    exactKeys(checkpoint, [
      "version", "schemaVersion", "campaignId", "currency", "policyVersion", "binding",
      "costs", "nativeInstrument", "maxEvents", "maxWindowMs", "sequence", "records"
    ], "ACCOUNT_JOURNAL");
    const binding = Object.freeze(normalizeBinding(checkpoint.binding));
    if (checkpoint.version !== 2 ||
        checkpoint.schemaVersion !== USD_ACCOUNT_JOURNAL_VERSION ||
        checkpoint.campaignId !== binding.campaignId ||
        checkpoint.currency !== binding.currency ||
        checkpoint.policyVersion !== POLICY.version ||
        !canonicalCheckpointBytes(checkpoint.costs)
          .equals(canonicalCheckpointBytes(USD_MODELED_COSTS)) ||
        checkpoint.nativeInstrument !== "BTC/USD" ||
        checkpoint.maxEvents !== MAX_USD_ACCOUNT_JOURNAL_EVENTS ||
        checkpoint.maxWindowMs !== MAX_USD_ACCOUNT_WINDOW_MS ||
        (expectedBinding && !canonicalCheckpointBytes(binding)
          .equals(canonicalCheckpointBytes(expectedBinding)))) {
      throw new Error("ACCOUNT_JOURNAL_BINDING_MISMATCH");
    }
    if (!Array.isArray(checkpoint.records) ||
        checkpoint.records.length !== checkpoint.sequence + 1 ||
        checkpoint.records.length < 1 ||
        checkpoint.records.length > MAX_USD_ACCOUNT_JOURNAL_EVENTS + 1) {
      throw new Error("INVALID_ACCOUNT_JOURNAL");
    }
    exactKeys(checkpoint.records[0], ["kind", "sequence", "predecessorHash"], "ACCOUNT_RECORD");
    if (checkpoint.records[0].kind !== "CREATE" ||
        checkpoint.records[0].sequence !== 0 ||
        checkpoint.records[0].predecessorHash !== null) {
      throw new Error("INVALID_ACCOUNT_JOURNAL");
    }
    const events = [];
    for (let index = 1; index < checkpoint.records.length; index += 1) {
      const record = checkpoint.records[index];
      exactKeys(record, [
        "kind", "sequence", "predecessorHash", "transaction"
      ], "ACCOUNT_RECORD");
      const predecessor = checkpointValue(binding, checkpoint.records.slice(0, index));
      if (record.kind !== "EVENT" ||
          record.sequence !== index ||
          record.predecessorHash !== hash(canonicalCheckpointBytes(predecessor))) {
        throw new Error("ACCOUNT_JOURNAL_CHAIN_MISMATCH");
      }
      exactKeys(record.transaction, ["event", "fill", "skipReason", "observation"], "TRANSACTION");
      events.push(record.transaction.event);
    }
    validateWindow(events);
    const replay = replayUsdAccount({
      schemaVersion: "USD_PAPER_ACCOUNT_EVENTS_V1", binding, events
    });
    for (let index = 0; index < replay.entries.length; index += 1) {
      if (!canonicalCheckpointBytes(checkpoint.records[index + 1].transaction)
        .equals(canonicalCheckpointBytes(replay.entries[index]))) {
        throw new Error("ACCOUNT_JOURNAL_REPLAY_MISMATCH");
      }
    }
    return {
      status: "OK",
      binding,
      replay,
      records: checkpoint.records,
      tip: makeTip(binding, checkpoint.sequence, result.hash)
    };
  } catch (error) {
    return {status: "CORRUPT", reason: error.message || "account journal is invalid"};
  }
}

async function readVerified(store, expectedBinding) {
  return decodeCheckpoint(await store.readCheckpoint(), expectedBinding);
}

export async function inspectUsdAccountJournal(directory) {
  await assertDirectory(directory);
  await assertTrustedParent(directory);
  await assertFileType(directory, "checkpoint.json", {required: false});
  await assertFileType(directory, ".checkpoint-pending");
  return readVerified(new CheckpointStore(directory, {
    maxBytes: MAX_USD_ACCOUNT_JOURNAL_BYTES
  }));
}

export class UsdAccountJournalStore {
  #store;
  #directory;
  #binding;
  #journal;
  #replay;
  #records;
  #tip;
  #createdNew;
  #blocked = false;
  #closed = false;

  constructor(store, directory, binding, journal, replay, records, tip, createdNew) {
    this.#store = store;
    this.#directory = directory;
    this.#binding = binding;
    this.#journal = journal;
    this.#replay = replay;
    this.#records = records;
    this.#tip = tip;
    this.#createdNew = createdNew;
  }

  static async createNew(directory, {binding, onPhase} = {}) {
    const normalizedBinding = Object.freeze(normalizeBinding(binding));
    await assertDirectory(directory, {mustNotExist: true});
    await assertTrustedParent(directory);
    if (onPhase !== undefined && typeof onPhase !== "function") {
      throw new TypeError("account journal phase hook must be a function");
    }
    try {
      await mkdir(directory);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("ACCOUNT_JOURNAL_ALREADY_EXISTS");
      throw error;
    }
    await assertDirectory(directory);
    const store = await CheckpointStore.open(directory, {
      maxBytes: MAX_USD_ACCOUNT_JOURNAL_BYTES, onPhase
    });
    try {
      const existing = await store.readCheckpoint();
      if (existing.status !== "ABSENT") throw new Error("ACCOUNT_JOURNAL_ALREADY_EXISTS");
      const records = [{kind: "CREATE", sequence: 0, predecessorHash: null}];
      const bytes = canonicalCheckpointBytes(checkpointValue(normalizedBinding, records));
      const commit = await store.commitCheckpoint({
        expectedSequence: -1, expectedHash: null, candidateBytes: bytes
      });
      if (commit.status !== "ACK") throw commitError(commit);
      const journal = createUsdAccountJournal(normalizedBinding);
      return new UsdAccountJournalStore(
        store, directory, normalizedBinding, journal, replayUsdAccount(journal), records,
        makeTip(normalizedBinding, commit.sequence, commit.hash), true
      );
    } catch (error) {
      if (error.code !== "ACCOUNT_COMMIT_UNKNOWN") {
        await store.close().catch(() => {});
        if (error.code === "ACCOUNT_COMMIT_FAILED" && error.status === "NOT_COMMITTED") {
          await rmdir(directory).catch(() => {});
        }
      }
      throw error;
    }
  }

  static async reopenExisting(directory, {binding, expectedTip, onPhase} = {}) {
    const normalizedBinding = normalizeBinding(binding);
    validateTip(expectedTip, normalizedBinding);
    await assertDirectory(directory);
    await assertTrustedParent(directory);
    await assertFileType(directory, "checkpoint.json", {required: true});
    await assertFileType(directory, ".checkpoint-pending");
    const store = await CheckpointStore.open(directory, {
      maxBytes: MAX_USD_ACCOUNT_JOURNAL_BYTES, onPhase
    });
    try {
      const decoded = await readVerified(store, normalizedBinding);
      if (decoded.status !== "OK") throw readError(decoded);
      if (decoded.tip.revision !== expectedTip.revision ||
          decoded.tip.digest !== expectedTip.digest) {
        throw new Error("STALE_EXPECTED_TIP");
      }
      return new UsdAccountJournalStore(
        store, directory, decoded.binding,
        Object.freeze({
          schemaVersion: "USD_PAPER_ACCOUNT_EVENTS_V1",
          binding: decoded.binding,
          events: Object.freeze(decoded.replay.entries.map(entry => entry.event))
        }),
        decoded.replay, decoded.records, decoded.tip, false
      );
    } catch (error) {
      await store.close().catch(() => {});
      throw error;
    }
  }

  get binding() {
    this.#assertUsable();
    return this.#binding;
  }

  get createdNew() {
    this.#assertUsable();
    return this.#createdNew;
  }

  get replay() {
    this.#assertUsable();
    return this.#replay;
  }

  get tip() {
    this.#assertUsable();
    return this.#tip;
  }

  async append(event) {
    this.#assertUsable();
    const appended = appendUsdAccountEventWithReplay(this.#journal, event);
    if (appended.duplicate) {
      return {replay: this.#replay, tip: this.#tip, duplicate: true};
    }
    validateWindow(appended.journal.events);
    const record = {
      kind: "EVENT",
      sequence: this.#tip.revision + 1,
      predecessorHash: this.#tip.digest,
      transaction: appended.replay.entries.at(-1)
    };
    const records = [...this.#records, record];
    const checkpoint = checkpointValue(this.#binding, records);
    const candidateBytes = canonicalCheckpointBytes(checkpoint);
    if (candidateBytes.byteLength > MAX_USD_ACCOUNT_JOURNAL_BYTES) {
      throw new Error("ACCOUNT_JOURNAL_STORAGE_LIMIT_REACHED");
    }
    const commit = await this.#store.commitCheckpoint({
      expectedSequence: this.#tip.revision,
      expectedHash: this.#tip.digest,
      candidateBytes
    });
    if (commit.status !== "ACK") {
      this.#blocked = true;
      throw commitError(commit);
    }
    this.#journal = appended.journal;
    this.#replay = appended.replay;
    this.#records = records;
    this.#tip = makeTip(this.#binding, commit.sequence, commit.hash);
    return {replay: this.#replay, tip: this.#tip, duplicate: false};
  }

  async inspect() {
    this.#assertOpen();
    return inspectUsdAccountJournal(this.#directory);
  }

  async close() {
    this.#assertOpen();
    if (this.#blocked) throw new Error("ACCOUNT_RECOVERY_REQUIRED");
    await this.#store.close();
    this.#closed = true;
  }

  #assertOpen() {
    if (this.#closed) throw new Error("ACCOUNT_JOURNAL_CLOSED");
  }

  #assertUsable() {
    this.#assertOpen();
    if (this.#blocked) throw new Error("ACCOUNT_RECOVERY_REQUIRED");
  }
}
