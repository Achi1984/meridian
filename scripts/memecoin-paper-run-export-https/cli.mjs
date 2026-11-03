import {createHash, randomBytes} from "node:crypto";
import {constants} from "node:fs";
import {lstat, link, mkdir, open, realpath, rm, unlink} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createExportTransfer, MAX_TRANSFER_BYTES} from "../memecoin-paper-run-export-transfer/index.mjs";
import {createHttpsExportTransport, readExportOverHttps} from "./https.mjs";

const GATE_SCHEMA = "memecoin-paper-run-export-https-attempt/v1";
const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key.startsWith("--") || index + 1 >= args.length || key in result) {
      throw new TypeError("invalid command arguments");
    }
    result[key.slice(2)] = args[index + 1];
  }
  return result;
}

function required(values, name, pattern = null) {
  const value = values[name];
  if (typeof value !== "string" || !value || pattern && !pattern.test(value)) {
    throw new TypeError(`invalid ${name}`);
  }
  return value;
}

function validateIdentity(identity) {
  if (!SAFE_ID.test(identity.runId) || !HASH.test(identity.configSha256) ||
      typeof identity.producerRevision !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(identity.producerRevision)) {
    throw new TypeError("invalid expected export identity");
  }
  return identity;
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensurePrivateDirectory(directory) {
  if (!path.isAbsolute(directory)) throw new TypeError("attempt directory must be absolute");
  await mkdir(directory, {recursive: true, mode: 0o700});
  const resolved = path.resolve(directory);
  if (await realpath(directory) !== resolved) throw new TypeError("attempt directory cannot use symlinks");
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new TypeError("attempt directory must be private and non-symlinked");
  }
}

export async function claimDurableAttempt({directory, identity, exportSha256, byteLength} = {}) {
  validateIdentity(identity);
  if (!HASH.test(exportSha256 ?? "") || !Number.isSafeInteger(byteLength) ||
      byteLength < 1 || byteLength > MAX_TRANSFER_BYTES) {
    throw new TypeError("invalid durable attempt binding");
  }
  await ensurePrivateDirectory(directory);
  const filename = path.join(directory, `${sha256(Buffer.from(identity.runId))}.jsonl`);
  const record = JSON.stringify({
    schema: GATE_SCHEMA,
    identity,
    exportSha256,
    byteLength,
    state: "ATTEMPTED"
  }) + "\n";
  let handle;
  try {
    handle = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile(record);
    await handle.sync();
    await handle.close();
    handle = null;
    await syncDirectory(directory);
    return {status: "CLAIMED", filename};
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error.code === "EEXIST") return {status: "UNKNOWN", code: "ATTEMPT_ALREADY_RECORDED"};
    throw error;
  }
}

export async function recordDurableOutcome(filename, outcome) {
  if (typeof filename !== "string" || !path.isAbsolute(filename) ||
      !outcome || !/^(?:TRANSFER_ACKNOWLEDGED|UNKNOWN|REJECTED)$/.test(outcome.status)) {
    throw new TypeError("invalid durable attempt outcome");
  }
  const code = typeof outcome.code === "string" && /^[A-Z0-9_]{1,64}$/.test(outcome.code)
    ? outcome.code : null;
  const handle = await open(filename, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    await handle.writeFile(JSON.stringify({state: outcome.status, code}) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(filename));
}

async function readExportFile(filename, identity) {
  if (!path.isAbsolute(filename)) throw new TypeError("export path must be absolute");
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() ||
      before.size < 1 || before.size > MAX_TRANSFER_BYTES) {
    throw new TypeError("export must be a bounded regular non-symlink file");
  }
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== before.size || stat.size > MAX_TRANSFER_BYTES) {
      throw new TypeError("export changed while opening");
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const {bytesRead} = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.byteLength - offset), offset);
      if (!bytesRead) throw new TypeError("export file is partial");
      offset += bytesRead;
    }
    const value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    if (value?.schemaVersion !== "memecoin-paper-run-export/v1" ||
        value.runId !== identity.runId || value.configSha256 !== identity.configSha256 ||
        value.producerRevision !== identity.producerRevision) {
      throw new TypeError("export identity does not match the independent expectation");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function runtimeConfig({write = false} = {}) {
  if (process.env.PAPER_EXPORT_HTTPS_ENABLED !== "true") {
    throw new TypeError("HTTPS export operations are disabled");
  }
  const privateOrigin = process.env.PAPER_EXPORT_HTTPS_ORIGIN;
  const writeAuthorization = process.env.PAPER_EXPORT_HTTPS_WRITE_AUTHORIZATION;
  const readAuthorization = process.env.PAPER_EXPORT_HTTPS_READ_AUTHORIZATION;
  if (typeof privateOrigin !== "string" || !readAuthorization ||
      write && (!writeAuthorization || writeAuthorization === readAuthorization)) {
    throw new TypeError(write
      ? "origin and separate runtime authorizations are required"
      : "origin and read authorization are required");
  }
  return {privateOrigin, writeAuthorization, readAuthorization};
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function runUpload(values) {
  const config = runtimeConfig({write: true});
  const identity = validateIdentity({
    runId: required(values, "run-id", SAFE_ID),
    configSha256: required(values, "config-sha256", HASH),
    producerRevision: required(values, "producer-revision")
  });
  const exportPath = required(values, "export");
  const attemptDirectory = process.env.PAPER_EXPORT_HTTPS_ATTEMPT_DIRECTORY;
  if (typeof attemptDirectory !== "string") throw new TypeError("durable attempt directory is required");
  const bytes = await readExportFile(exportPath, identity);
  const digest = sha256(bytes);
  const gate = await claimDurableAttempt({
    directory: attemptDirectory,
    identity,
    exportSha256: digest,
    byteLength: bytes.byteLength
  });
  if (gate.status !== "CLAIMED") {
    emit({status: "UNKNOWN", code: gate.code, identity, exportSha256: digest, byteLength: bytes.byteLength});
    return 2;
  }

  const transfer = createExportTransfer({
    enabled: true,
    privateOrigin: config.privateOrigin,
    transport: createHttpsExportTransport({privateOrigin: config.privateOrigin})
  });
  let outcome;
  try {
    outcome = await transfer.transfer({
      exportBytes: bytes,
      expected: identity,
      writeAuthorization: config.writeAuthorization,
      explicitlyAuthorized: true
    });
  } catch {
    outcome = {status: "UNKNOWN", code: "WRITE_OUTCOME_UNKNOWN"};
  }
  if (!["TRANSFER_ACKNOWLEDGED", "REJECTED", "UNKNOWN"].includes(outcome.status)) {
    outcome = {status: "UNKNOWN", code: "WRITE_OUTCOME_UNKNOWN"};
  }
  try {
    await recordDurableOutcome(gate.filename, outcome);
  } catch {
    emit({
      status: "UNKNOWN",
      code: "ATTEMPT_OUTCOME_NOT_DURABLE",
      identity,
      exportSha256: digest,
      byteLength: bytes.byteLength,
      checkpointAcknowledged: false
    });
    return 2;
  }
  emit({
    status: outcome.status,
    ...(outcome.code ? {code: outcome.code} : {}),
    identity,
    exportSha256: digest,
    byteLength: bytes.byteLength,
    checkpointAcknowledged: false
  });
  return outcome.status === "TRANSFER_ACKNOWLEDGED" ? 0 : outcome.status === "UNKNOWN" ? 2 : 1;
}

async function writeExactBytes(filename, bytes) {
  if (!path.isAbsolute(filename)) throw new TypeError("readback output path must be absolute");
  const directory = path.dirname(filename);
  const temporary = path.join(directory, `.${path.basename(filename)}.${randomBytes(12).toString("hex")}.stage`);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const {bytesWritten} = await handle.write(bytes, offset, Math.min(64 * 1024, bytes.byteLength - offset));
      if (!bytesWritten) throw new Error("readback output write made no progress");
      offset += bytesWritten;
    }
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, filename);
    await unlink(temporary);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, {force: true}).catch(() => {});
    throw error;
  }
}

async function runReadback(values) {
  const config = runtimeConfig();
  const identity = validateIdentity({
    runId: required(values, "run-id", SAFE_ID),
    configSha256: required(values, "config-sha256", HASH),
    producerRevision: required(values, "producer-revision")
  });
  const digest = required(values, "export-sha256", HASH);
  const byteLength = Number(required(values, "byte-length"));
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_TRANSFER_BYTES) {
    throw new TypeError("invalid byte length");
  }
  const output = required(values, "output");
  const result = await readExportOverHttps({
    transport: createHttpsExportTransport({privateOrigin: config.privateOrigin}),
    privateOrigin: config.privateOrigin,
    expected: identity,
    expectedExportSha256: digest,
    expectedByteLength: byteLength,
    readAuthorization: config.readAuthorization
  });
  if (result.status !== "READ_BACK") {
    emit({status: result.status, code: result.code, identity, exportSha256: digest, byteLength});
    return result.status === "UNKNOWN" ? 2 : 1;
  }
  await writeExactBytes(output, result.bytes);
  emit({
    status: "READ_BACK",
    identity,
    exportSha256: result.exportSha256,
    byteLength: result.byteLength,
    evaluation: {overall: result.evaluation.overall},
    output
  });
  return result.evaluation.overall === "FAIL" ? 1 : result.evaluation.overall === "UNKNOWN" ? 2 : 0;
}

export async function main(args = process.argv.slice(2)) {
  try {
    const [command, ...rest] = args;
    const values = parseArgs(rest);
    const allowed = command === "upload"
      ? ["export", "run-id", "config-sha256", "producer-revision"]
      : command === "readback"
        ? ["run-id", "config-sha256", "producer-revision", "export-sha256", "byte-length", "output"]
        : [];
    if (!allowed.length || Object.keys(values).some(key => !allowed.includes(key)) ||
        allowed.some(key => typeof values[key] !== "string")) {
      throw new TypeError("invalid HTTPS export command");
    }
    return command === "upload" ? await runUpload(values) : await runReadback(values);
  } catch {
    emit({status: "REJECTED", code: "INVALID_COMMAND_OR_RUNTIME_CONFIGURATION"});
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
