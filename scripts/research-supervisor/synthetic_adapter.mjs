import {createHash} from "node:crypto";
import {createInterface} from "node:readline";

const paths = [
  {id: "development-01", variant: "synthetic-development"},
  ...Array.from({length: 43}, (_, index) => ({
    id: `frozen-control-${String(index + 1).padStart(2, "0")}`,
    variant: "synthetic-frozen-control"
  }))
];
const lines = createInterface({input: process.stdin, crlfDelay: Infinity})[Symbol.asyncIterator]();
const first = await lines.next();
if (first.done) throw new Error("ADAPTER_INPUT_MISSING");
const input = JSON.parse(first.value);
const fields = ["protocolSha256", "sourceSha256", "dataSha256", "index", "pathId",
  "variantId", "predecessorSha256"];
if (Object.keys(input).sort().join(",") !== fields.slice().sort().join(","))
  throw new Error("ADAPTER_INPUT_SCHEMA");
if (!Number.isInteger(input.index) || input.index < 0 || input.index >= paths.length)
  throw new Error("ADAPTER_INDEX");
const path = paths[input.index];
if (path.id !== input.pathId || path.variant !== input.variantId
    || !/^[a-f0-9]{64}$/.test(input.protocolSha256)
    || !/^[a-f0-9]{64}$/.test(input.sourceSha256)
    || !/^[a-f0-9]{64}$/.test(input.dataSha256)
    || !/^[a-f0-9]{64}$/.test(input.predecessorSha256))
  throw new Error("ADAPTER_PIN_MISMATCH");
process.stdout.write(JSON.stringify({event: "path_started", index: input.index, pathId: path.id,
  variantId: path.variant, predecessorSha256: input.predecessorSha256}) + "\n");
const acknowledgement = await lines.next();
if (acknowledgement.done) throw new Error("PARENT_START_ACK_MISSING");
const ack = JSON.parse(acknowledgement.value);
if (Object.keys(ack).sort().join(",") !== "event,index,pathId"
    || ack.event !== "parent_started" || ack.index !== input.index || ack.pathId !== path.id)
  throw new Error("PARENT_START_ACK_INVALID");
process.stdin.destroy();
const outputSha256 = createHash("sha256").update(JSON.stringify({
  protocolSha256: input.protocolSha256,
  sourceSha256: input.sourceSha256,
  dataSha256: input.dataSha256,
  index: input.index,
  pathId: path.id,
  variantId: path.variant,
  predecessorSha256: input.predecessorSha256
})).digest("hex");
process.stdout.write(JSON.stringify({event: "path_completed", index: input.index, pathId: path.id,
  variantId: path.variant, predecessorSha256: input.predecessorSha256, outputSha256}) + "\n");
