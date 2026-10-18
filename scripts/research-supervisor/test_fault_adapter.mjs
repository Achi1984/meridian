import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, writeFileSync} from "node:fs";
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
if (first.done) process.exit(2);
const input = JSON.parse(first.value);
const path = paths[input.index];
const emit = (event, overrides = {}) => new Promise(resolve => process.stdout.write(JSON.stringify({
  event, index: input.index, pathId: path.id, variantId: path.variant,
  predecessorSha256: input.predecessorSha256, ...overrides
}) + "\n", resolve));
if (input.sourceSha256 === "e".repeat(64)) {
  await emit("path_started", {pathId: "unmanifested-path"});
} else if (input.sourceSha256 === "f".repeat(64)) {
  process.exit(0);
} else {
  if (input.sourceSha256 === "2".repeat(64)) {
    const marker = `/tmp/meridian-m11-descendant-${process.ppid}.pid`;
    const proceed = `${marker}.go`;
    spawn(process.execPath, ["-e",
      "require('fs').writeFileSync(process.argv[1],String(process.pid));setTimeout(()=>{},10000)",
      marker], {stdio: ["ignore", "inherit", "inherit"]});
    while (!existsSync(marker)) await new Promise(resolve => setTimeout(resolve, 5));
    while (!existsSync(proceed)) await new Promise(resolve => setTimeout(resolve, 5));
  }
  await emit("path_started");
  const acknowledgement = await lines.next();
  if (acknowledgement.done) process.exit(3);
  const ack = JSON.parse(acknowledgement.value);
  if (ack.event !== "parent_started" || ack.index !== input.index || ack.pathId !== path.id)
    process.exit(4);
  process.stdin.destroy();
  if (input.sourceSha256 === "b".repeat(64)) await new Promise(resolve => setTimeout(resolve, 3000));
  if (input.sourceSha256 === "c".repeat(64)) {
    process.stdout.write("X".repeat(12000));
  } else if (input.sourceSha256 === "9".repeat(64)) {
    process.stderr.write("X".repeat(6000));
  } else if (input.sourceSha256 === "d".repeat(64)) {
    spawn(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
      stdio: ["ignore", "inherit", "inherit"]
    });
    process.exit(0);
  } else if (input.sourceSha256 === "3".repeat(64) && input.index === 0) {
    await new Promise(resolve => setTimeout(resolve, 350));
    const outputSha256 = createHash("sha256").update(JSON.stringify({
      sourceSha256: input.sourceSha256, dataSha256: input.dataSha256,
      index: input.index, pathId: path.id, predecessorSha256: input.predecessorSha256
    })).digest("hex");
    await emit("path_completed", {outputSha256});
  } else if (input.sourceSha256 === "4".repeat(64) && input.index === 43) {
    const outputSha256 = createHash("sha256").update(JSON.stringify({
      sourceSha256: input.sourceSha256, dataSha256: input.dataSha256,
      index: input.index, pathId: path.id, predecessorSha256: input.predecessorSha256
    })).digest("hex");
    await emit("path_completed", {outputSha256});
    // Keep the final child alive until the test has observed the durable final
    // event and acquired its independent SQLite lock. No timing race window.
    const marker = `/tmp/meridian-m11-settlement-${process.ppid}.ready`;
    writeFileSync(marker, String(process.pid));
    while (!existsSync(`${marker}.go`))
      await new Promise(resolve => setTimeout(resolve, 5));
  } else if (input.sourceSha256 === "8".repeat(64) && input.index === 1) {
    await emit("path_started", {pathId: "false-path"});
  } else {
    if (input.sourceSha256 === "7".repeat(64))
      await new Promise(resolve => setTimeout(resolve, 25));
    const outputSha256 = createHash("sha256").update(JSON.stringify({
      sourceSha256: input.sourceSha256, dataSha256: input.dataSha256,
      index: input.index, pathId: path.id, predecessorSha256: input.predecessorSha256
    })).digest("hex");
    await emit("path_completed", {outputSha256});
  }
}
