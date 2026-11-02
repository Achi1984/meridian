import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {open, lstat, link, mkdtemp, rmdir, unlink} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {parseDexScreenerPair} from "./adapters.mjs";
import {createRunConfig} from "./create-run-config.mjs";
import {FILTER_POLICY, filterCandidate} from "./stages.mjs";
import {canonicalJson, EIGHT_HOURS_MS} from "./pilot-online.mjs";

export const MAX_INPUT_BYTES = 1_048_576;
export const MAX_SNAPSHOTS = 300;
export const MAX_REJECTIONS = 40;
export const CALLER_SNAPSHOT_SOURCE = "CALLER_LABEL_ONLY_NOT_AUTHENTICATED";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const OPTIONS = ["input", "output", "run-id", "start-at", "mint", "pool", "quote"];
const FILTER_EVIDENCE = Object.freeze({
  pairCreatedAt: "pairCreatedAt",
  marketCapUsd: "marketCapUsd",
  tokenDecimals: null,
  mintAuthorityRevoked: null,
  freezeAuthorityRevoked: null,
  lpProtection: null,
  liquidityUsd: "liquidityUsd",
  volume1hUsd: "volume1hUsd",
  top10OwnerPct: null,
  devAssociatedPct: null,
  crediblePriorRug: null,
  bundledLaunchPct: null,
  priceChange1hPct: "priceChange1hPct",
  tokenExtensions: null
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value) {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isSafeInteger(parsed) && Number.isFinite(new Date(parsed).getTime())
    ? parsed : null;
}

function reason(code, rowIndex, identity = {}) {
  return {
    code,
    rowIndex,
    ...(typeof identity.mint === "string" && BASE58.test(identity.mint) ? {mint: identity.mint} : {}),
    ...(typeof identity.pool === "string" && BASE58.test(identity.pool) ? {pool: identity.pool} : {})
  };
}

function safeOriginLabel(value) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 120) {
    throw new TypeError("originLabel must be a nonempty caller-supplied label of at most 120 characters");
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]").trim().slice(0, 120);
}

function addRejection(rejections, item) {
  rejections.total += 1;
  if (rejections.items.length < MAX_REJECTIONS) rejections.items.push(item);
}

function validatePairNumbers(pair) {
  for (const [value, code] of [
    [pair.marketCap, "INVALID_MARKET_CAP"],
    [pair.fdv, "INVALID_FDV"],
    [pair.liquidity?.usd, "INVALID_LIQUIDITY"],
    [pair.volume?.h1, "INVALID_VOLUME"]
  ]) {
    if (value !== undefined && value !== null &&
        (typeof value !== "number" || !Number.isFinite(value) || value < 0)) return code;
  }
  const priceChange = pair.priceChange?.h1;
  if (priceChange !== undefined && priceChange !== null &&
      (typeof priceChange !== "number" || !Number.isFinite(priceChange) || priceChange < -100)) {
    return "INVALID_PRICE_CHANGE";
  }
  for (const value of [pair.txns?.h1?.buys, pair.txns?.h1?.sells]) {
    if (value !== undefined && value !== null &&
        (!Number.isSafeInteger(value) || value < 0)) return "INVALID_TRANSACTION_COUNT";
  }
  return null;
}

function makeCandidate(parsed, sampledAt) {
  const identity = {
    chainId: parsed.chainId,
    mint: parsed.mint,
    pool: parsed.pool,
    quote: parsed.quote
  };
  const values = {
    pairCreatedAt: parsed.pairCreatedAt,
    marketCapUsd: parsed.marketCapUsd,
    liquidityUsd: parsed.liquidityUsd,
    volume1hUsd: parsed.volume1hUsd,
    priceChange1hPct: parsed.priceChange1hPct
  };
  const evidence = Object.fromEntries(Object.entries(FILTER_EVIDENCE).map(([key, valueKey]) => [
    key,
    {
      value: valueKey ? values[valueKey] ?? null : null,
      source: CALLER_SNAPSHOT_SOURCE,
      observedAt: sampledAt,
      verified: false,
      coverage: {complete: false, reason: "caller-supplied snapshot is not authenticated evidence"},
      binding: identity
    }
  ]));
  return {
    ...identity,
    source: CALLER_SNAPSHOT_SOURCE,
    sampledAt,
    pairCreatedAt: parsed.pairCreatedAt,
    marketCapUsd: parsed.marketCapUsd,
    liquidityUsd: parsed.liquidityUsd,
    volume1hUsd: parsed.volume1hUsd,
    priceChange1hPct: parsed.priceChange1hPct,
    transactions1h: parsed.transactions1h,
    decimals: null,
    evidence
  };
}

function inspectSnapshot(snapshot, rowIndex, {now, startAt, endAt}, rejections) {
  if (!isRecord(snapshot) || !isRecord(snapshot.pair)) {
    addRejection(rejections, reason("INVALID_SNAPSHOT", rowIndex));
    return null;
  }
  const pair = snapshot.pair;
  const identity = {
    mint: pair.baseToken?.address,
    pool: pair.pairAddress
  };
  if (pair.chainId !== "solana") {
    addRejection(rejections, reason("WRONG_CHAIN", rowIndex, identity));
    return null;
  }
  if (!isRecord(pair.baseToken) || !isRecord(pair.quoteToken) ||
      typeof pair.baseToken.address !== "string" || !BASE58.test(pair.baseToken.address) ||
      typeof pair.pairAddress !== "string" || !BASE58.test(pair.pairAddress) ||
      typeof pair.quoteToken.address !== "string" || !BASE58.test(pair.quoteToken.address)) {
    addRejection(rejections, reason("INVALID_IDENTITY", rowIndex, identity));
    return null;
  }
  if (!isRecord(pair.liquidity) || !isRecord(pair.volume) ||
      !isRecord(pair.txns) || !isRecord(pair.txns.h1)) {
    addRejection(rejections, reason("INVALID_PAIR_SCHEMA", rowIndex, identity));
    return null;
  }
  const numbersError = validatePairNumbers(pair);
  if (numbersError) {
    addRejection(rejections, reason(numbersError, rowIndex, identity));
    return null;
  }
  if (!Number.isSafeInteger(pair.pairCreatedAt) ||
      !Number.isFinite(new Date(pair.pairCreatedAt).getTime())) {
    addRejection(rejections, reason("MISSING_OR_INVALID_PAIR_TIME", rowIndex, identity));
    return null;
  }
  const sampledAt = timestamp(snapshot.sampledAt);
  if (sampledAt === null) {
    addRejection(rejections, reason("MISSING_OR_INVALID_SAMPLE_TIME", rowIndex, identity));
    return null;
  }
  if (sampledAt > now) {
    addRejection(rejections, reason("FUTURE_SAMPLE_TIME", rowIndex, identity));
    return null;
  }
  if (now - sampledAt > FILTER_POLICY.maxEvidenceAgeMs) {
    addRejection(rejections, reason("STALE_SAMPLE", rowIndex, identity));
    return null;
  }
  if (pair.pairCreatedAt > sampledAt) {
    addRejection(rejections, reason("FUTURE_PAIR_TIME", rowIndex, identity));
    return null;
  }
  if (sampledAt - pair.pairCreatedAt < FILTER_POLICY.minPairAgeMs) {
    addRejection(rejections, reason("PAIR_YOUNGER_THAN_MINIMUM_AT_SAMPLE", rowIndex, identity));
    return null;
  }
  if (sampledAt - pair.pairCreatedAt > FILTER_POLICY.maxPairAgeMs) {
    addRejection(rejections, reason("PAIR_OLDER_THAN_MAXIMUM_AT_SAMPLE", rowIndex, identity));
    return null;
  }
  if (pair.marketCap === undefined || pair.marketCap === null) {
    addRejection(rejections, reason("MISSING_MARKET_CAP", rowIndex, identity));
    return null;
  }
  if (pair.marketCap < FILTER_POLICY.minMarketCapUsd ||
      pair.marketCap > FILTER_POLICY.maxMarketCapUsd) {
    addRejection(rejections, reason("MARKET_CAP_OUTSIDE_POLICY", rowIndex, identity));
    return null;
  }
  if (startAt < now) {
    addRejection(rejections, reason("PLAN_START_IN_PAST", rowIndex, identity));
    return null;
  }
  if (startAt - pair.pairCreatedAt < FILTER_POLICY.minPairAgeMs) {
    addRejection(rejections, reason("PAIR_YOUNGER_THAN_MINIMUM_AT_START", rowIndex, identity));
    return null;
  }
  if (endAt - pair.pairCreatedAt > FILTER_POLICY.maxPairAgeMs) {
    addRejection(rejections, reason("PAIR_EXPIRES_BEFORE_WINDOW_END", rowIndex, identity));
    return null;
  }
  const parsed = parseDexScreenerPair(pair, {sampledAt, observedAt: sampledAt});
  if (parsed.status !== "PARTIAL") {
    addRejection(rejections, reason("PAIR_NORMALIZATION_FAILED", rowIndex, identity));
    return null;
  }
  return {
    candidate: makeCandidate(parsed, sampledAt),
    sampledAt,
    pairCreatedAt: pair.pairCreatedAt
  };
}

function compareCandidates(left, right) {
  const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return right.sampledAt - left.sampledAt ||
    lexical(left.candidate.pool, right.candidate.pool) ||
    lexical(left.candidate.quote, right.candidate.quote) ||
    lexical(left.candidate.mint, right.candidate.mint);
}

function selectionFrom(options) {
  const fields = ["mint", "pool", "quote"];
  const provided = fields.filter(field => options.selection?.[field] !== undefined);
  if (provided.length === 0) return null;
  if (provided.length !== fields.length ||
      !fields.every(field => typeof options.selection[field] === "string" &&
        BASE58.test(options.selection[field]))) {
    throw new TypeError("explicit selection requires valid mint, pool, and quote identities");
  }
  return {chainId: "solana", ...options.selection};
}

export function buildCandidateIntakePlan({
  input,
  output,
  runId,
  startAt,
  now = Date.now(),
  selection: requestedSelection
} = {}) {
  if (!isRecord(input) || !Array.isArray(input.snapshots) ||
      input.snapshots.length > MAX_SNAPSHOTS) {
    throw new TypeError(`input must contain at most ${MAX_SNAPSHOTS} bounded snapshots`);
  }
  if (typeof output !== "string" || !path.isAbsolute(output) ||
      !Number.isSafeInteger(startAt) || !Number.isSafeInteger(now) ||
      !Number.isFinite(new Date(startAt).getTime()) || !Number.isFinite(new Date(now).getTime()) ||
      !Number.isSafeInteger(startAt + EIGHT_HOURS_MS)) {
    throw new TypeError("absolute output and valid integer planning and window timestamps are required");
  }
  const originLabel = safeOriginLabel(input.originLabel);
  const selection = selectionFrom({selection: requestedSelection});
  const endAt = startAt + EIGHT_HOURS_MS;
  const rejections = {items: [], total: 0};
  const eligible = [];
  for (const [rowIndex, snapshot] of input.snapshots.entries()) {
    const inspected = inspectSnapshot(snapshot, rowIndex, {now, startAt, endAt}, rejections);
    if (inspected) eligible.push(inspected);
  }

  let ordered;
  if (selection) {
    ordered = eligible.filter(({candidate}) =>
      candidate.chainId === selection.chainId && candidate.mint === selection.mint &&
      candidate.pool === selection.pool && candidate.quote === selection.quote).sort(compareCandidates);
    if (ordered.length === 0) {
      addRejection(rejections, reason("EXPLICIT_IDENTITY_NOT_ELIGIBLE", -1, selection));
    } else {
      for (const duplicate of ordered.slice(1)) {
        addRejection(rejections, reason("DUPLICATE_MINT_POOL_NOT_MIXED", -1, duplicate.candidate));
      }
    }
  } else {
    const byMint = new Map();
    for (const inspected of eligible.sort(compareCandidates)) {
      const mint = inspected.candidate.mint;
      if (byMint.has(mint)) {
        addRejection(rejections, reason("DUPLICATE_MINT_POOL_NOT_MIXED", -1, inspected.candidate));
      } else {
        byMint.set(mint, inspected);
      }
    }
    ordered = [...byMint.values()].sort(compareCandidates);
  }

  const selected = ordered[0] ?? null;
  const rejectionSummary = {
    items: rejections.items,
    totalRecorded: rejections.total,
    truncated: rejections.total > rejections.items.length
  };
  const base = {
    status: selected ? "OBSERVATION_PLAN_READY" : "OBSERVATION_PLAN_BLOCKED",
    provenance: {
      source: CALLER_SNAPSHOT_SOURCE,
      originLabel,
      authenticated: false
    },
    executionAuthorized: false,
    identity: selected ? {
      chainId: selected.candidate.chainId,
      mint: selected.candidate.mint,
      pool: selected.candidate.pool,
      quote: selected.candidate.quote
    } : null,
    window: selected ? {startAt, endAt, durationMs: EIGHT_HOURS_MS} : null,
    hardGateStatus: selected
      ? filterCandidate(selected.candidate, {now, holdUntil: endAt}).status : null,
    rejections: rejectionSummary,
    configHash: null
  };
  if (!selected) return base;

  const config = createRunConfig({
    output,
    runId,
    startAt,
    mint: selected.candidate.mint,
    pool: selected.candidate.pool,
    quote: selected.candidate.quote
  });
  const configBytes = Buffer.from(canonicalJson(config), "utf8");
  return {
    ...base,
    configHash: createHash("sha256").update(configBytes).digest("hex"),
    configBytes
  };
}

async function assertSafeOutputDirectory(directory) {
  let current = path.resolve(directory);
  while (true) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new TypeError("output directory path must contain only real directories");
    }
    const parent = path.dirname(current);
    if (parent === current) return await lstat(path.resolve(directory));
    current = parent;
  }
}

function sameDirectory(left, right) {
  return left.isDirectory() && right.isDirectory() && left.dev === right.dev && left.ino === right.ino;
}

function sameFile(left, right) {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino;
}

function descriptorPath(handle) {
  if (process.platform !== "linux") {
    throw new TypeError("safe config publication requires Linux directory handles");
  }
  return `/proc/self/fd/${handle.fd}`;
}

async function assertDirectoryBinding(directory, expected, handle) {
  const [current, opened] = await Promise.all([assertSafeOutputDirectory(directory), handle.stat()]);
  if (!sameDirectory(expected, current) || !sameDirectory(expected, opened)) {
    throw new TypeError("output directory identity changed during config publication");
  }
}

export async function writeExclusiveConfig(output, bytes, {
  write = (handle, data) => handle.writeFile(data),
  sync = handle => handle.sync(),
  openDirectory = directory => open(directory, "r"),
  syncDirectory = handle => handle.sync(),
  beforeOpenStagingDirectory = async () => {},
  beforeOpenStagedConfig = async () => {}
} = {}) {
  if (typeof output !== "string" || !path.isAbsolute(output) || !Buffer.isBuffer(bytes) ||
      typeof write !== "function" || typeof sync !== "function" ||
      typeof openDirectory !== "function" || typeof syncDirectory !== "function" ||
      typeof beforeOpenStagingDirectory !== "function" ||
      typeof beforeOpenStagedConfig !== "function") {
    throw new TypeError("an absolute output path and config bytes are required");
  }
  const resolved = path.resolve(output);
  const directory = path.dirname(resolved);
  const basename = path.basename(resolved);
  const expectedDirectory = await assertSafeOutputDirectory(directory);
  let directoryHandle;
  let stagingDirectory;
  let stagingName;
  let stagingHandle;
  let stagingIdentity;
  let handle;
  let stagedFileCreated = false;
  let publicationStatus = "PUBLISHED_DURABLE";
  try {
    directoryHandle = await open(directory, "r");
    const directoryPath = descriptorPath(directoryHandle);
    await assertDirectoryBinding(directory, expectedDirectory, directoryHandle);
    stagingDirectory = await mkdtemp(path.join(directoryPath, ".candidate-intake-"));
    stagingName = path.basename(stagingDirectory);
    const createdStagingInfo = await lstat(stagingDirectory);
    if (!createdStagingInfo.isDirectory() || (createdStagingInfo.mode & 0o077) !== 0) {
      throw new TypeError("private config staging directory was not created safely");
    }
    stagingIdentity = {dev: createdStagingInfo.dev, ino: createdStagingInfo.ino};
    await beforeOpenStagingDirectory(stagingDirectory);
    stagingHandle = await open(
      stagingDirectory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    const stagingPath = descriptorPath(stagingHandle);
    const stagingInfo = await stagingHandle.stat();
    if (!sameDirectory(createdStagingInfo, stagingInfo) || (stagingInfo.mode & 0o077) !== 0) {
      throw new TypeError("private config staging directory identity changed before opening");
    }
    const stagedOutput = path.join(stagingPath, "config");
    await beforeOpenStagedConfig(stagedOutput, stagingDirectory);
    handle = await open(stagedOutput, "wx", 0o600);
    stagedFileCreated = true;
    await handle.chmod(0o600);
    await write(handle, bytes);
    await sync(handle);
    const stagedInfo = await handle.stat();
    const stagedPathInfo = await lstat(stagedOutput);
    if (!stagedInfo.isFile() || (stagedInfo.mode & 0o777) !== 0o600 ||
        stagedInfo.dev !== stagedPathInfo.dev || stagedInfo.ino !== stagedPathInfo.ino) {
      throw new TypeError("staged config identity or permissions changed before publication");
    }
    await assertDirectoryBinding(directory, expectedDirectory, directoryHandle);
    await link(stagedOutput, path.join(directoryPath, basename));

    const verifyPublished = async () => {
      const publishedHandle = await open(path.join(directoryPath, basename), "r");
      try {
        const info = await publishedHandle.stat();
        const staged = await handle.stat();
        const publishedBytes = await publishedHandle.readFile();
        return info.isFile() && (info.mode & 0o777) === 0o600 &&
          info.dev === staged.dev && info.ino === staged.ino && publishedBytes.equals(bytes);
      } finally {
        await publishedHandle.close();
      }
    };

    if (!await verifyPublished()) {
      throw new TypeError("published config did not match its verified staged identity and bytes");
    }
    try {
      await assertDirectoryBinding(directory, expectedDirectory, directoryHandle);
      const syncHandle = await openDirectory(directoryPath);
      try {
        await syncDirectory(syncHandle);
      } finally {
        await syncHandle.close();
      }
      await assertDirectoryBinding(directory, expectedDirectory, directoryHandle);
    } catch {
      if (!await verifyPublished()) {
        throw new TypeError("published config could not be verified after a durability failure");
      }
      publicationStatus = "PUBLISHED_DURABILITY_UNCERTAIN";
    }
  } finally {
    if (handle && stagedFileCreated && stagingHandle) {
      try {
        const stagedOutput = path.join(descriptorPath(stagingHandle), "config");
        const [openedInfo, currentInfo] = await Promise.all([handle.stat(), lstat(stagedOutput)]);
        if (sameFile(openedInfo, currentInfo)) await unlink(stagedOutput);
      } catch {}
    }
    if (handle) try { await handle.close(); } catch {}
    if (stagingHandle) {
      try { await stagingHandle.close(); } catch {}
    }
    if (stagingDirectory && stagingName && directoryHandle && stagingIdentity) {
      try {
        const stagingPath = path.join(descriptorPath(directoryHandle), stagingName);
        const current = await lstat(stagingPath);
        if (current.dev === stagingIdentity.dev && current.ino === stagingIdentity.ino) {
          await rmdir(stagingPath);
        }
      } catch {}
    }
    if (directoryHandle) try { await directoryHandle.close(); } catch {}
  }
  return {status: publicationStatus};
}

export async function readSnapshotFile(inputPath) {
  if (typeof inputPath !== "string" || !path.isAbsolute(inputPath)) {
    throw new TypeError("input path must be absolute");
  }
  const handle = await open(
    inputPath,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
  );
  let bytes;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new TypeError("input must be a regular file");
    if (info.size > MAX_INPUT_BYTES) {
      throw new TypeError(`input exceeded the ${MAX_INPUT_BYTES}-byte limit`);
    }
    const chunks = [];
    let size = 0;
    while (size <= MAX_INPUT_BYTES) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - size));
      const {bytesRead} = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > MAX_INPUT_BYTES) {
        throw new TypeError(`input exceeded the ${MAX_INPUT_BYTES}-byte limit`);
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    bytes = Buffer.concat(chunks, size);
  } finally {
    await handle.close();
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch {
    throw new TypeError("input was not valid UTF-8 JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.snapshots) ||
      parsed.snapshots.length > MAX_SNAPSHOTS) {
    throw new TypeError(`input must contain at most ${MAX_SNAPSHOTS} snapshots`);
  }
  return parsed;
}

export async function runCandidateIntake(options, publicationOptions) {
  const input = await readSnapshotFile(options.input);
  const plan = buildCandidateIntakePlan({...options, input});
  if (plan.status === "OBSERVATION_PLAN_READY") {
    const publication = await writeExclusiveConfig(options.output, plan.configBytes, publicationOptions);
    delete plan.configBytes;
    plan.publicationStatus = publication.status;
    if (publication.status === "PUBLISHED_DURABILITY_UNCERTAIN") {
      plan.status = "OBSERVATION_PLAN_PUBLISHED_DURABILITY_UNCERTAIN";
    }
  }
  return plan;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const key = option.startsWith("--") ? option.slice(2) : "";
    if (!OPTIONS.includes(key) || Object.hasOwn(values, key) ||
        typeof argv[index + 1] !== "string" || argv[index + 1].startsWith("--")) {
      throw new TypeError(`expected unique --${OPTIONS.join(", --")} options`);
    }
    values[key] = argv[++index];
  }
  if (["input", "output", "run-id", "start-at"].some(key => !Object.hasOwn(values, key))) {
    throw new TypeError("--input, --output, --run-id, and --start-at are required");
  }
  const selectionCount = ["mint", "pool", "quote"].filter(key => Object.hasOwn(values, key)).length;
  if (selectionCount !== 0 && selectionCount !== 3) {
    throw new TypeError("--mint, --pool, and --quote must be supplied together");
  }
  if (!/^[1-9]\d*$/.test(values["start-at"])) {
    throw new TypeError("--start-at must be a positive epoch-millisecond integer");
  }
  return {
    input: values.input,
    output: values.output,
    runId: values["run-id"],
    startAt: Number(values["start-at"]),
    ...(selectionCount ? {selection: {
      mint: values.mint, pool: values.pool, quote: values.quote
    }} : {})
  };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const plan = await runCandidateIntake(parseArguments(argv));
    const {configBytes: _configBytes, ...summary} = plan;
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (plan.status !== "OBSERVATION_PLAN_READY") process.exitCode = 2;
    return summary;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      status: "OBSERVATION_PLAN_BLOCKED",
      provenance: {source: CALLER_SNAPSHOT_SOURCE, authenticated: false},
      executionAuthorized: false,
      identity: null,
      window: null,
      hardGateStatus: null,
      configHash: null,
      rejections: {items: [{code: "INTAKE_ERROR"}], totalRecorded: 1, truncated: false}
    })}\n`);
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
