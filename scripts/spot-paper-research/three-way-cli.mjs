#!/usr/bin/env node
import {readFile, stat, writeFile} from "node:fs/promises";
import {compareThreeSpotPaperStrategies, SPOT_PAPER_RESEARCH_LIMITS} from
  "./three-way-comparison.mjs";

function usage() {
  throw new Error("USAGE: three-way-cli.mjs --input <observations.json> --output <report.json>");
}

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith("--") || !argv[index + 1] || argv[index + 1].startsWith("--")) usage();
    result[key.slice(2)] = argv[++index];
  }
  if (!result.input || !result.output) usage();
  return result;
}

const options = args(process.argv.slice(2));
let inputStat;
try {
  inputStat = await stat(options.input);
} catch (error) {
  throw new Error(`INPUT_READ_FAILED:${error.code ?? "STAT_FAILED"}`);
}
if (!Number.isSafeInteger(inputStat.size) ||
    inputStat.size > SPOT_PAPER_RESEARCH_LIMITS.maxInputBytes) {
  throw new Error("INPUT_BYTE_LIMIT");
}

let observations;
try {
  observations = JSON.parse(await readFile(options.input, "utf8"));
} catch (error) {
  throw new Error(`INPUT_READ_FAILED:${error.code ?? "INVALID_JSON"}`);
}

const result = compareThreeSpotPaperStrategies(observations);
await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, {
  encoding: "utf8", flag: "wx", mode: 0o600
});
process.stdout.write(`${JSON.stringify({status: result.status, output: options.output})}\n`);
