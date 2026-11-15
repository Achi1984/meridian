import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const run = promisify(execFile);

test("three-way CLI reads caller-supplied JSON and refuses output overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "meridian-three-way-cli-"));
  const input = join(root, "observations.json");
  const output = join(root, "report.json");
  await writeFile(input, "[]", {mode: 0o600});
  await assert.rejects(run(process.execPath, [
    "scripts/spot-paper-research/three-way-cli.mjs", "--input", input,
    "--output", output
  ]), /OBSERVATION_COUNT_LIMIT/);
  await writeFile(output, "existing", {mode: 0o600});
  const outputText = await readFile(output, "utf8");
  assert.equal(outputText, "existing");
});
