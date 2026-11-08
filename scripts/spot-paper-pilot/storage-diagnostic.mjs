#!/usr/bin/env node
import {createHash, randomUUID} from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, statfsSync, writeFileSync
} from "node:fs";
import {isAbsolute, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";

const MAX_PROBE_BYTES = 512;
const MAX_OPERATION_MS = 10_000;

function assertActive(context) {
  if (context.monotonicNow() >= context.deadlineAt) {
    const error = new Error("storage diagnostic deadline exceeded");
    error.code = "DEADLINE_EXCEEDED";
    throw error;
  }
}

function assertRealDirectory(path) {
  const resolved = resolve(path);
  if (!isAbsolute(path) || path !== resolved) {
    throw new Error("ABSOLUTE_NORMALIZED_MOUNT_REQUIRED");
  }
  const segments = resolved.split(sep).filter(Boolean);
  let current = sep;
  for (const segment of segments) {
    current = resolve(current, segment);
    const info = lstatSync(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("MOUNT_ANCESTRY_NOT_REAL_DIRECTORY");
    }
  }
  if (realpathSync(resolved) !== resolved) {
    throw new Error("MOUNT_PATH_NOT_CANONICAL");
  }
  return resolved;
}

function syncDirectory(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY |
    (constants.O_NOFOLLOW ?? 0));
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--mount" ||
      typeof argv[1] !== "string" || !isAbsolute(argv[1])) {
    throw new Error("USAGE: storage-diagnostic.mjs --mount <absolute-mount-path>");
  }
  return argv[1];
}

export function runStorageDiagnostic(mountPath, dependencies = {}) {
  const uid = dependencies.uid ?? process.getuid?.();
  if (!Number.isInteger(uid) || uid === 0) {
    throw new Error("UNPRIVILEGED_NODE_REQUIRED");
  }
  if (!Number.isSafeInteger(dependencies.timeoutMs ?? MAX_OPERATION_MS) ||
      (dependencies.timeoutMs ?? MAX_OPERATION_MS) < 1 ||
      (dependencies.timeoutMs ?? MAX_OPERATION_MS) > MAX_OPERATION_MS) {
    throw new Error("INVALID_OPERATION_BOUND");
  }
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const now = dependencies.now ?? (() => new Date());
  const makeId = dependencies.randomUUID ?? randomUUID;
  const context = {
    monotonicNow,
    deadlineAt: monotonicNow() + (dependencies.timeoutMs ?? MAX_OPERATION_MS)
  };
  assertActive(context);
  const mount = assertRealDirectory(mountPath);
  const token = makeId();
  if (typeof token !== "string" || !/^[a-f0-9-]{36}$/i.test(token)) {
    throw new Error("INVALID_PROBE_ID");
  }
  const childName = `meridian-storage-probe-${token}`;
  const childPath = resolve(mount, childName);
  if (childPath !== `${mount}${sep}${childName}`) {
    throw new Error("PROBE_PATH_ESCAPE");
  }
  const createdAtUtc = now().toISOString();
  const payload = Buffer.from(JSON.stringify({
    schemaVersion: "SPOT_PAPER_STORAGE_PROBE_V1",
    probeId: token,
    createdAtUtc
  }) + "\n");
  if (payload.byteLength > MAX_PROBE_BYTES) throw new Error("PROBE_SIZE_LIMIT");

  assertActive(context);
  mkdirSync(childPath, {mode: 0o700});
  syncDirectory(mount);

  const temporaryPath = resolve(childPath, "probe.pending");
  const finalPath = resolve(childPath, "probe.bin");
  let descriptor;
  let writtenInfo;
  try {
    assertActive(context);
    descriptor = openSync(temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(descriptor, payload);
    fsyncSync(descriptor);
    writtenInfo = fstatSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  assertActive(context);
  try {
    lstatSync(finalPath);
    throw new Error("PROBE_DESTINATION_COLLISION");
  } catch (error) {
    if (error.message === "PROBE_DESTINATION_COLLISION") throw error;
    if (error.code !== "ENOENT") throw error;
  }
  renameSync(temporaryPath, finalPath);
  const readbackDescriptor = openSync(finalPath, constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let readback;
  try {
    const readbackInfo = fstatSync(readbackDescriptor);
    if (!readbackInfo.isFile() || readbackInfo.dev !== writtenInfo.dev ||
        readbackInfo.ino !== writtenInfo.ino) {
      throw new Error("READBACK_IDENTITY_MISMATCH");
    }
    readback = readFileSync(readbackDescriptor);
  } finally {
    closeSync(readbackDescriptor);
  }
  if (!readback.equals(payload)) throw new Error("READBACK_MISMATCH");
  syncDirectory(childPath);
  assertActive(context);

  const free = statfsSync(mount, {bigint: true});
  const freeBytes = free.bavail * free.bsize;
  const probeSha256 = createHash("sha256").update(readback).digest("hex");
  const observedAtUtc = now().toISOString();
  assertActive(context);
  return {
    schemaVersion: "SPOT_PAPER_STORAGE_DIAGNOSTIC_V1",
    status: "PASS",
    scope: "STORAGE_OPERATIONS_ONLY",
    mountPath: mount,
    probePath: finalPath,
    runtimeUid: uid,
    probeBytes: readback.byteLength,
    probeSha256,
    freeBytes: freeBytes.toString(),
    observedAtUtc,
    workLimitBytes: MAX_PROBE_BYTES,
    timeLimitMs: dependencies.timeoutMs ?? MAX_OPERATION_MS,
    deadlineEnforcement: "COOPERATIVE_BETWEEN_OPERATIONS",
    operationalReadiness: "NOT_ASSESSED"
  };
}

export function main(argv = process.argv.slice(2), dependencies = {}) {
  const mountPath = parseArguments(argv);
  const result = runStorageDiagnostic(mountPath, dependencies);
  (dependencies.stdout ?? process.stdout).write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    const reason = /^[A-Z0-9_]+$/.test(error.message ?? "") ?
      error.message : /^[A-Z0-9_]+$/.test(error.code ?? "") ? error.code :
        "STORAGE_DIAGNOSTIC_FAILED";
    process.stderr.write(`${JSON.stringify({
      schemaVersion: "SPOT_PAPER_STORAGE_DIAGNOSTIC_V1",
      status: "BLOCKED",
      reason,
      operationalReadiness: "NOT_ASSESSED"
    })}\n`);
    process.exitCode = 1;
  }
}
