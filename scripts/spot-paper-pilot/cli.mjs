#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createKrakenProvider } from "./provider.mjs";
import { readRunJournal } from "./journal.mjs";
import { runSpotPaperPilot } from "./runner.mjs";
import { SPOT_PAPER_PILOT_LIMITS } from "./core.mjs";

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === "--network") {
      if (options.network) throw new Error("DUPLICATE_ARGUMENT:--network");
      options.network = true;
      continue;
    }
    if (!["--mode", "--data-root", "--run-id", "--max-cycles",
      "--max-duration-ms", "--poll-interval-ms"].includes(key)) {
      throw new Error(`UNKNOWN_ARGUMENT:${key}`);
    }
    if (options[key]) throw new Error(`DUPLICATE_ARGUMENT:${key}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`VALUE_REQUIRED:${key}`);
    options[key] = value;
  }
  const mode = options["--mode"];
  if (!["observe", "paper", "report"].includes(mode)) {
    throw new Error("Use --mode observe, --mode paper, or --mode report.");
  }
  if (!options["--data-root"] || !options["--run-id"]) {
    throw new Error("--data-root and --run-id are required.");
  }
  if (mode === "report") {
    if (options.network) throw new Error("--network is not valid for report mode.");
    return { mode, dataRoot: resolve(options["--data-root"]), runId: options["--run-id"] };
  }
  if (!options.network) {
    throw new Error("Network access is disabled unless --network is explicitly supplied.");
  }
  if (!options["--max-cycles"] || !options["--max-duration-ms"]) {
    throw new Error("A bounded run requires --max-cycles and --max-duration-ms.");
  }
  const maxCycles = Number(options["--max-cycles"]);
  const maxDurationMs = Number(options["--max-duration-ms"]);
  const pollIntervalMs = Number(options["--poll-interval-ms"] ??
    SPOT_PAPER_PILOT_LIMITS.minPollIntervalMs);
  if (!Number.isSafeInteger(maxCycles) || maxCycles < 1 ||
      maxCycles > SPOT_PAPER_PILOT_LIMITS.maxCycles ||
      !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 ||
      maxDurationMs > SPOT_PAPER_PILOT_LIMITS.maxDurationMs ||
      !Number.isSafeInteger(pollIntervalMs) ||
      pollIntervalMs < SPOT_PAPER_PILOT_LIMITS.minPollIntervalMs ||
      pollIntervalMs > SPOT_PAPER_PILOT_LIMITS.maxDurationMs) {
    throw new Error("Run budget is outside the fixed pilot limits.");
  }
  return {
    mode, dataRoot: resolve(options["--data-root"]), runId: options["--run-id"],
    maxCycles, maxDurationMs, pollIntervalMs
  };
}

export async function main(argv = process.argv.slice(2)) {
  const config = argumentsFrom(argv);
  if (config.mode === "report") {
    const journal = await readRunJournal(config);
    const terminal = journal.events.find(event => event.id === "run-terminal");
    process.stdout.write(JSON.stringify({
      reconciliation: journal.reconciliationStatus !== "READ_ONLY_VERIFIED" ?
        journal.reconciliationStatus :
        terminal ? "TERMINAL_REPORT_AVAILABLE" : "INCOMPLETE_READ_ONLY",
      runId: journal.runId, eventCount: journal.events.length,
      checkpoint: journal.checkpoint, report: terminal?.report ?? null,
      resumed: false, executionImpact: false
    }, null, 2) + "\n");
    return;
  }
  const controller = new AbortController();
  const abort = signal => controller.abort(new Error(signal));
  const onInterrupt = () => abort("SIGINT");
  const onTerminate = () => abort("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    const provider = createKrakenProvider({
      signal: controller.signal,
      maxRequests: Math.min(config.maxCycles * 2, SPOT_PAPER_PILOT_LIMITS.maxRequests)
    });
    const report = await runSpotPaperPilot({ ...config, provider, signal: controller.signal });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
