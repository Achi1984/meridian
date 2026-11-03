import {constants} from "node:fs";
import {open} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {
  EvidenceWarmupStore,
  warmupCoverage
} from "./index.mjs";

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

async function readInput(filename) {
  if (!path.isAbsolute(filename)) throw new TypeError("input path must be absolute");
  const handle = await open(filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_INPUT_BYTES) {
      throw new RangeError("capture input is outside the bounded file size");
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const {bytesRead} = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new Error("capture input size changed while reading");
    return JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } finally {
    await handle.close();
  }
}

function optionsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--enabled") {
      result.enabled = true;
      continue;
    }
    if (!["--store", "--input", "--id", "--query"].includes(key) ||
        typeof argv[index + 1] !== "string" || argv[index + 1].startsWith("--")) {
      throw new TypeError("invalid warmup command arguments");
    }
    result[key.slice(2)] = argv[++index];
  }
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  const options = optionsOf(args);
  if (!options.enabled && command === "capture") {
    process.stdout.write(`${JSON.stringify({status: "DISABLED"})}\n`);
    return 0;
  }
  if (!["capture", "read", "status"].includes(command) ||
      typeof options.store !== "string" || !path.isAbsolute(options.store) ||
      typeof options.id !== "string") {
    throw new TypeError("usage: cli.mjs capture|read|status --store ABSOLUTE --id ID");
  }
  const store = new EvidenceWarmupStore(options.store, {
    enabled: command === "capture" && options.enabled === true
  });
  let result;
  if (command === "capture") {
    if (typeof options.input !== "string") throw new TypeError("capture requires --input");
    const input = await readInput(options.input);
    result = input?.datasetId === options.id
      ? await store.publish(input)
      : {status: "UNKNOWN", reason: "DATASET_ID_MISMATCH"};
  } else {
    const reader = new EvidenceWarmupStore(options.store);
    const read = await reader.read(options.id);
    if (read.status !== "AVAILABLE") result = read;
    else if (command === "read") {
      result = {status: read.status, datasetId: options.id, digest: read.digest,
        byteLength: read.byteLength, document: read.document};
    } else {
      if (typeof options.query !== "string" || options.query.length > 4096) {
        throw new TypeError("status requires a bounded --query");
      }
      result = warmupCoverage(read.document, JSON.parse(options.query));
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === "PUBLISHED" || result.status === "DUPLICATE" ||
    result.status === "AVAILABLE" || (command === "status" && result.status === "WARMUP") ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write("Evidence warmup command failed closed.\n");
    process.exitCode = 1;
  });
}
