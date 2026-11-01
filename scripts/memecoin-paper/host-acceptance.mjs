import {createHash, randomUUID} from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat
} from "node:fs/promises";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {pathToFileURL} from "node:url";

const VOLUME_ROOT = "/var/data/meridian-paper";
const EVIDENCE_ROOT_NAME = "host-acceptance";
const MAX_EVIDENCE_BYTES = 16 * 1024;
const MAX_PROVIDER_REQUESTS = 4;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const MAX_PROVIDER_BYTES = MAX_PROVIDER_REQUESTS * MAX_PROVIDER_RESPONSE_BYTES;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PRODUCER_PINS = Object.freeze({
  provider: "b000c6a6dcfcce102e61821e8316174a15a0dd58",
  controller: "89a20bf118e059c6153ac75b51f2ed6947d46332",
  report: "14075eef9ef0eebde3249718a6f6e3c51016bdee"
});
const DEX_PROVIDER = {name: "DexScreener public API", host: "api.dexscreener.com", enabled: true};
const RPC_PROVIDER = {
  name: "Solana mainnet public JSON-RPC",
  host: "api.mainnet-beta.solana.com",
  enabled: true
};

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value === undefined) return "null";
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertEvidenceId(value) {
  if (typeof value !== "string" || !SAFE_ID.test(value) || value.includes("..")) {
    throw new TypeError("evidence ID must be a safe, unique path component");
  }
  return value;
}

async function boundedRegularFile(filePath, maxBytes) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) {
    throw new Error("host acceptance input is not a bounded regular file");
  }
  const bytes = await readFile(filePath);
  if (bytes.length !== info.size || bytes.length > maxBytes) {
    throw new Error("host acceptance input changed or exceeded its byte limit");
  }
  return bytes;
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomicNew(directory, filename, bytes) {
  if (bytes.length > MAX_EVIDENCE_BYTES) throw new RangeError("host acceptance evidence exceeded its bound");
  const temporary = path.join(directory, `.${filename}.${randomUUID()}.tmp`);
  const target = path.join(directory, filename);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await syncDirectory(directory);
  const readback = await boundedRegularFile(target, MAX_EVIDENCE_BYTES);
  if (!readback.equals(bytes)) throw new Error("host acceptance evidence readback mismatch");
  return sha256(readback);
}

function verifyCandidate({mint, pool, quote}) {
  if (![mint, pool, quote].every(value =>
    typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))) {
    throw new TypeError("explicit Solana mint, pool, and quote identities are required");
  }
  return {chainId: "solana", mint, pool, quote};
}

function hostManifest(evidenceId, candidate, now) {
  const startAt = now - 1_000;
  return {
    enabled: true,
    mode: "READ_ONLY_PAPER",
    execution: "SIMULATED_ONLY",
    runId: `host-check-${evidenceId}`,
    startAt,
    endAt: startAt + 8 * 60 * 60 * 1000,
    durationMs: 8 * 60 * 60 * 1000,
    stopSwitch: {engaged: false},
    http: {
      credentials: false,
      redirects: "error",
      arbitraryUrls: false,
      tokenProvidedUrls: false
    },
    providers: [DEX_PROVIDER, RPC_PROVIDER],
    allowedMints: [candidate.mint],
    allowedPools: [candidate.pool],
    pollBudget: {
      maxRequestsPerRun: MAX_PROVIDER_REQUESTS,
      maxRequestsPerProvider: 3,
      maxBytesPerResponse: MAX_PROVIDER_RESPONSE_BYTES,
      maxBytesPerRun: MAX_PROVIDER_BYTES,
      maxEvents: MAX_PROVIDER_REQUESTS,
      maxCandidates: 1
    }
  };
}

function clockObservation(wallStart, wallEnd, monotonicStart, monotonicEnd) {
  const wallElapsedMs = wallEnd - wallStart;
  const monotonicElapsedMs = monotonicEnd - monotonicStart;
  return {
    wallStart: Number.isSafeInteger(wallStart) ? new Date(wallStart).toISOString() : null,
    wallEnd: Number.isSafeInteger(wallEnd) ? new Date(wallEnd).toISOString() : null,
    wallElapsedMs,
    monotonicElapsedMs,
    wallMonotonicDifferenceMs: wallElapsedMs - monotonicElapsedMs,
    provenance: "UNVERIFIED"
  };
}

async function verifyMountRoot(mountRoot, runtimeUid) {
  if (typeof mountRoot !== "string" || !path.isAbsolute(mountRoot) ||
      path.resolve(mountRoot) !== mountRoot) {
    throw new TypeError("mount root must be an absolute normalized path");
  }
  const info = await lstat(mountRoot);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(mountRoot) !== mountRoot) {
    throw new Error("configured volume root must be a real, non-symlink directory");
  }
  const parentInfo = await stat(path.dirname(mountRoot));
  return {
    info,
    ownerMatchesRuntimeUid: Number.isInteger(runtimeUid) && info.uid === runtimeUid,
    sameDeviceAsParent: info.dev === parentInfo.dev
  };
}

function parseEvidenceRecord(bytes, evidenceId, candidateHash) {
  let record;
  try {
    record = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("persisted host acceptance evidence is unreadable");
  }
  const {evidenceHash, ...payload} = record ?? {};
  if (payload.schema !== "MERIDIAN_PAPER_HOST_ACCEPTANCE_V1" ||
      payload.evidenceId !== evidenceId || payload.candidateSha256 !== candidateHash ||
      typeof evidenceHash !== "string" ||
      sha256(Buffer.from(canonicalJson(payload), "utf8")) !== evidenceHash) {
    throw new Error("persisted host acceptance identity or hash is mismatched");
  }
  return record;
}

async function verifyExisting(evidenceDirectory, evidenceId, candidateHash, runtimeUid) {
  const dirInfo = await lstat(evidenceDirectory);
  if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink() ||
      dirInfo.uid !== runtimeUid || (dirInfo.mode & 0o022) !== 0 ||
      await realpath(evidenceDirectory) !== evidenceDirectory) {
    throw new Error("existing acceptance evidence directory is unsafe");
  }
  const probePath = path.join(evidenceDirectory, "probe.json");
  const resultPath = path.join(evidenceDirectory, "result.json");
  const [probeInfo, resultInfo] = await Promise.all([lstat(probePath), lstat(resultPath)]);
  if (probeInfo.uid !== runtimeUid || resultInfo.uid !== runtimeUid) {
    throw new Error("existing acceptance evidence ownership does not match the runtime UID");
  }
  const [probeBytes, resultBytes] = await Promise.all([
    boundedRegularFile(probePath, MAX_EVIDENCE_BYTES),
    boundedRegularFile(resultPath, MAX_EVIDENCE_BYTES)
  ]);
  const record = parseEvidenceRecord(resultBytes, evidenceId, candidateHash);
  if (record.probeSha256 !== sha256(probeBytes) || record.pilotStarted !== false ||
      record.runtimeAuthorization !== false) {
    throw new Error("persisted host acceptance probe identity is invalid");
  }
  return {
    status: record.status === "PASS" ? "RESTART_VERIFIED" : record.status,
    scope: "HOST_ACCEPTANCE_ONLY",
    evidenceId,
    persistedEvidenceSha256: record.evidenceHash,
    providerRequestsThisInvocation: 0,
    pilotStarted: false,
    runtimeAuthorization: false,
    hostDurability: "NOT_VERIFIED",
    clockProvenance: "UNVERIFIED"
  };
}

async function runProviderPreflight({assemblyLoader, candidate, evidenceId, now}) {
  const assembly = await assemblyLoader();
  if (typeof assembly?.acquireProviderEvidence !== "function" ||
      typeof assembly.transport !== "function" || !assembly.freshnessPolicy) {
    throw new Error("pinned public provider assembly contract is unavailable");
  }
  const producerPins = assembly.pins;
  if (!producerPins || !["controller", "provider", "report"].every(name =>
    producerPins[name] === PRODUCER_PINS[name])) {
    throw new Error("provider preflight source pins do not match the reviewed assembly");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("host preflight deadline")), 6_000);
  try {
    const result = await assembly.acquireProviderEvidence({
      manifest: hostManifest(evidenceId, candidate, now),
      candidates: [candidate],
      enabled: true,
      transport: assembly.transport,
      clock: Date.now,
      signal: controller.signal,
      freshnessPolicy: assembly.freshnessPolicy,
      requestTimeoutMs: 5_000
    });
    const events = Array.isArray(result?.events) ? result.events : [];
    const counters = result?.counters ?? {};
    const expectedEvents = new Set([
      `${DEX_PROVIDER.name}:pair`,
      "Solana JSON-RPC:getAccountInfo",
      "Solana JSON-RPC:getTokenLargestAccounts",
      "Solana JSON-RPC:getTokenSupply"
    ]);
    let eventBytes = 0;
    const eventIdentitiesMatch = events.length === MAX_PROVIDER_REQUESTS && events.every(event => {
      const key = `${event.provider}:${event.endpointKind}`;
      const valid = expectedEvents.delete(key) && event.status === "RECEIVED" &&
        Number.isSafeInteger(event.bytes) && event.bytes >= 0 &&
        event.bytes <= MAX_PROVIDER_RESPONSE_BYTES;
      if (valid) eventBytes += event.bytes;
      return valid;
    });
    const valid = result.status === "ACQUISITION_FINISHED" && result.networkAccessed === true &&
      counters.requests === MAX_PROVIDER_REQUESTS && counters.events === MAX_PROVIDER_REQUESTS &&
      counters.byProvider?.dex === 1 && counters.byProvider?.rpc === 3 &&
      counters.bytes <= MAX_PROVIDER_BYTES && counters.bytes === eventBytes &&
      counters.reservedBytes === 0 && eventIdentitiesMatch && expectedEvents.size === 0;
    return {
      status: valid ? "PASS" : "BLOCKED",
      requestCount: counters.requests ?? 0,
      maxRequests: MAX_PROVIDER_REQUESTS,
      byteCount: counters.bytes ?? 0,
      maxBytes: MAX_PROVIDER_BYTES,
      events: events.slice(0, MAX_PROVIDER_REQUESTS).map(event => ({
        provider: typeof event.provider === "string" ? event.provider : "UNKNOWN",
        kind: typeof event.endpointKind === "string" ? event.endpointKind : "UNKNOWN",
        status: typeof event.status === "string" ? event.status : "UNKNOWN",
        bytes: Number.isSafeInteger(event.bytes) ? event.bytes : null
      })),
      producerPins,
      retries: 0,
      rawResponsesLogged: false
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runHostAcceptance({
  mode,
  evidenceId,
  candidate: candidateInput,
  providerPreflight = false,
  mountRoot = VOLUME_ROOT,
  runtimeUid = typeof process.getuid === "function" ? process.getuid() : null,
  runtimeGid = typeof process.getgid === "function" ? process.getgid() : null,
  assemblyLoader = async () => {
    const assemblyModule = await import("./pilot-online-assembly.mjs");
    return assemblyModule.createPinnedAssembly();
  },
  wallClock = Date.now,
  monotonicClock = () => performance.now()
} = {}) {
  if (mode !== "HOST_ACCEPTANCE_ONLY" || providerPreflight !== true) {
    throw new TypeError("explicit HOST_ACCEPTANCE_ONLY mode and --provider-preflight are required");
  }
  evidenceId = assertEvidenceId(evidenceId);
  const candidate = verifyCandidate(candidateInput ?? {});
  const candidateHash = sha256(Buffer.from(canonicalJson(candidate), "utf8"));
  const mount = await verifyMountRoot(mountRoot, runtimeUid);
  const evidenceParent = path.join(mountRoot, EVIDENCE_ROOT_NAME);
  const evidenceDirectory = path.join(evidenceParent, evidenceId);
  if (!mount.ownerMatchesRuntimeUid) {
    return {
      status: "BLOCKED",
      scope: "HOST_ACCEPTANCE_ONLY",
      reason: "mounted volume root is not owned by the actual runtime UID",
      runtimeUid,
      runtimeGid,
      volumeRootUid: mount.info.uid,
      volumeRootGid: mount.info.gid,
      expectedMountPath: mountRoot,
      mountIdentity: "UNVERIFIED",
      pilotStarted: false,
      runtimeAuthorization: false,
      providerRequests: 0,
      hostDurability: "NOT_VERIFIED",
      clockProvenance: "UNVERIFIED"
    };
  }

  try {
    await mkdir(evidenceParent, {mode: 0o700});
    await syncDirectory(mountRoot);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const info = await lstat(evidenceParent);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== runtimeUid ||
        (info.mode & 0o022) !== 0 ||
        await realpath(evidenceParent) !== evidenceParent) {
      throw new Error("host acceptance parent must be a real, non-symlink directory");
    }
  }

  try {
    await mkdir(evidenceDirectory, {mode: 0o700});
    await syncDirectory(evidenceParent);
    const evidenceInfo = await lstat(evidenceDirectory);
    if (!evidenceInfo.isDirectory() || evidenceInfo.isSymbolicLink() ||
        evidenceInfo.uid !== runtimeUid || (evidenceInfo.mode & 0o022) !== 0 ||
        await realpath(evidenceDirectory) !== evidenceDirectory) {
      throw new Error("new acceptance evidence directory failed its ownership boundary");
    }
  } catch (error) {
    if (error.code === "EEXIST") {
      try {
        return await verifyExisting(evidenceDirectory, evidenceId, candidateHash, runtimeUid);
      } catch {
        return {
          status: "UNKNOWN",
          scope: "HOST_ACCEPTANCE_ONLY",
          evidenceId,
          reason: "existing host acceptance evidence is incomplete or invalid; it was preserved",
          providerRequestsThisInvocation: 0,
          pilotStarted: false,
          runtimeAuthorization: false,
          hostDurability: "NOT_VERIFIED",
          clockProvenance: "UNVERIFIED"
        };
      }
    }
    throw error;
  }

  const wallStart = wallClock();
  const monotonicStart = monotonicClock();
  const probe = {
    schema: "MERIDIAN_PAPER_HOST_PROBE_V1",
    evidenceId,
    candidateSha256: candidateHash,
    runtimeUid,
    runtimeGid,
    volumeRootUid: mount.info.uid,
    volumeRootGid: mount.info.gid,
    volumeRootMode: (mount.info.mode & 0o777).toString(8).padStart(3, "0"),
    volumeDevice: String(mount.info.dev),
    sameDeviceAsParent: mount.sameDeviceAsParent,
    createdAt: new Date(wallStart).toISOString(),
    nonce: randomUUID()
  };
  let probeSha256;
  let providerResult = {status: "UNKNOWN", requestCount: 0, maxRequests: MAX_PROVIDER_REQUESTS};
  let failureCode = null;
  try {
    probeSha256 = await writeAtomicNew(
      evidenceDirectory,
      "probe.json",
      Buffer.from(canonicalJson(probe), "utf8")
    );
    providerResult = await runProviderPreflight({assemblyLoader, candidate, evidenceId, now: wallStart});
  } catch (error) {
    const failureType = typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
      ? error.code
      : typeof error?.name === "string" && /^[A-Za-z]{1,24}$/.test(error.name)
        ? error.name.toUpperCase()
        : "FAILED";
    failureCode = probeSha256
      ? `PROVIDER_PREFLIGHT_${failureType}`
      : `VOLUME_PROBE_${failureType}`;
    providerResult = {
      status: "UNKNOWN",
      requestCount: null,
      requestCountStatus: "UNKNOWN",
      maxRequests: MAX_PROVIDER_REQUESTS,
      retries: 0,
      rawResponsesLogged: false
    };
  }
  const wallEnd = wallClock();
  const monotonicEnd = monotonicClock();
  const hostStatus = probeSha256 ? "PASS" : "UNKNOWN";
  const status = hostStatus === "PASS" && providerResult.status === "PASS" ? "PASS" : "BLOCKED";
  const payload = {
    schema: "MERIDIAN_PAPER_HOST_ACCEPTANCE_V1",
    status,
    scope: "HOST_ACCEPTANCE_ONLY",
    evidenceId,
    candidateSha256: candidateHash,
    probeSha256: probeSha256 ?? null,
    runtimeUid,
    runtimeGid,
    volumeRootUid: mount.info.uid,
    volumeRootGid: mount.info.gid,
    volumeRootMode: probe.volumeRootMode,
    volumeDevice: probe.volumeDevice,
    sameDeviceAsParent: mount.sameDeviceAsParent,
    mountIdentity: "UNVERIFIED",
    hostCheck: hostStatus,
    providerPreflight: providerResult,
    ...(failureCode ? {failureCode} : {}),
    clock: clockObservation(wallStart, wallEnd, monotonicStart, monotonicEnd),
    clockProvenance: "UNVERIFIED",
    hostDurability: "NOT_VERIFIED",
    pilotStarted: false,
    runtimeAuthorization: false
  };
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  const evidenceHash = sha256(payloadBytes);
  const recordBytes = Buffer.from(canonicalJson({...payload, evidenceHash}), "utf8");
  try {
    await writeAtomicNew(evidenceDirectory, "result.json", recordBytes);
  } catch {
    return {
      ...payload,
      status: "UNKNOWN",
      evidenceHash: null,
      evidencePreserved: true,
      resultReadback: "UNKNOWN"
    };
  }
  return {...payload, evidenceHash, evidencePreserved: true, resultReadback: "PASS"};
}

function parseArguments(argv) {
  if (argv[0] !== "verify") {
    throw new TypeError("explicit verify command required; this utility never starts the Paper pilot");
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--evidence-id", "--mint", "--pool", "--quote", "--provider-preflight"].includes(key) ||
        Object.hasOwn(values, key) ||
        (key !== "--provider-preflight" && typeof argv[index + 1] !== "string")) {
      throw new TypeError("expected unique --evidence-id, --mint, --pool, --quote, and --provider-preflight options");
    }
    values[key] = key === "--provider-preflight" ? true : argv[++index];
  }
  if (!values["--provider-preflight"] || !values["--evidence-id"] ||
      !values["--mint"] || !values["--pool"] || !values["--quote"]) {
    throw new TypeError("verify requires --evidence-id, --mint, --pool, --quote, and --provider-preflight");
  }
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const result = await runHostAcceptance({
    mode: "HOST_ACCEPTANCE_ONLY",
    evidenceId: args["--evidence-id"],
    candidate: {mint: args["--mint"], pool: args["--pool"], quote: args["--quote"]},
    providerPreflight: args["--provider-preflight"]
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!["PASS", "RESTART_VERIFIED"].includes(result.status)) process.exitCode = 2;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const failureType = typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
      ? error.code
      : typeof error?.name === "string" && /^[A-Za-z]{1,24}$/.test(error.name)
        ? error.name.toUpperCase()
        : "FAILED";
    process.stdout.write(`${JSON.stringify({
      status: "UNKNOWN",
      scope: "HOST_ACCEPTANCE_ONLY",
      failureCode: `HOST_ACCEPTANCE_${failureType}`,
      pilotStarted: false,
      runtimeAuthorization: false,
      hostDurability: "NOT_VERIFIED",
      clockProvenance: "UNVERIFIED"
    })}\n`);
    process.exitCode = 2;
  });
}
