import {open} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {EIGHT_HOURS_MS, PILOT_DEPENDENCY_PINS, READ_ONLY_PAPER, canonicalJson} from "./pilot-online.mjs";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const OPTIONS = ["output", "run-id", "start-at", "mint", "pool", "quote"];

function assertConfigInputs({output, runId, startAt, mint, pool, quote}) {
  if (typeof output !== "string" || !path.isAbsolute(output) ||
      typeof runId !== "string" || !SAFE_ID.test(runId) ||
      !Number.isSafeInteger(startAt) || startAt < 1 ||
      !Number.isSafeInteger(startAt + EIGHT_HOURS_MS) ||
      ![mint, pool, quote].every(value => typeof value === "string" && BASE58.test(value))) {
    throw new TypeError("absolute output, run ID, integer start time, and explicit Solana mint/pool/quote are required");
  }
}

export function createRunConfig(inputs) {
  assertConfigInputs(inputs);
  const {runId, startAt, mint, pool, quote} = inputs;
  const endAt = startAt + EIGHT_HOURS_MS;
  const candidates = [{chainId: "solana", mint, pool, quote}];
  return {
    version: 1,
    mode: READ_ONLY_PAPER,
    runId,
    startAt,
    endAt,
    dependencyPins: {...PILOT_DEPENDENCY_PINS},
    manifest: {
      enabled: true,
      mode: READ_ONLY_PAPER,
      execution: "SIMULATED_ONLY",
      runId,
      startAt,
      endAt,
      durationMs: EIGHT_HOURS_MS,
      stopSwitch: {engaged: false},
      http: {
        credentials: false,
        redirects: "error",
        arbitraryUrls: false,
        tokenProvidedUrls: false
      },
      providers: [
        {name: "DexScreener public API", host: "api.dexscreener.com", enabled: true},
        {name: "Solana mainnet public JSON-RPC", host: "api.mainnet-beta.solana.com", enabled: true}
      ],
      allowedMints: [mint],
      allowedPools: [pool],
      pollBudget: {
        maxRequestsPerRun: 960,
        maxRequestsPerProvider: 480,
        maxBytesPerResponse: 1_048_576,
        maxBytesPerRun: 10_485_760,
        maxEvents: 10_000,
        maxCandidates: 300
      }
    },
    candidates,
    budgets: {
      requests: 960,
      dexRequests: 480,
      rpcRequests: 480,
      bytes: 10_485_760,
      providerEvents: 10_000,
      candidates: 160,
      events: 1_000,
      cycles: 481,
      pollIntervalMs: 60_000,
      callbackSettlementMs: 35_000,
      requestTimeoutMs: 5_000
    }
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!option.startsWith("--") || !OPTIONS.includes(option.slice(2)) ||
        Object.hasOwn(values, option.slice(2)) || typeof argv[index + 1] !== "string") {
      throw new TypeError(`expected each of --${OPTIONS.join(", --")} exactly once`);
    }
    values[option.slice(2)] = argv[++index];
  }
  if (OPTIONS.some(option => !Object.hasOwn(values, option))) {
    throw new TypeError(`all options are required: --${OPTIONS.join(", --")}`);
  }
  if (!/^[1-9]\d*$/.test(values["start-at"])) {
    throw new TypeError("--start-at must be an integer epoch-millisecond value");
  }
  return {
    output: values.output,
    runId: values["run-id"],
    startAt: Number(values["start-at"]),
    mint: values.mint,
    pool: values.pool,
    quote: values.quote
  };
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function writeRunConfig(inputs) {
  const config = createRunConfig(inputs);
  const bytes = Buffer.from(canonicalJson(config), "utf8");
  const handle = await open(inputs.output, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(inputs.output));
  return {runId: config.runId, startAt: config.startAt, endAt: config.endAt};
}

export async function main(argv = process.argv.slice(2)) {
  const result = await writeRunConfig(parseArguments(argv));
  process.stdout.write(`${JSON.stringify({status: "CONFIG_CREATED", ...result})}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
