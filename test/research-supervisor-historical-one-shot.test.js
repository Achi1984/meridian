import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suite = path.join(root, "scripts/research-supervisor/test_historical_one_shot.py");

test("manual D2 one-shot launcher and Linux worker containment", () => {
  const result = spawnSync("python3", ["-B", suite, "-v"], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024
  });
  const diagnostic = [
    `status=${result.status}`,
    result.error ? `error=${result.error.code || result.error.message}` : "",
    `stdout:\n${result.stdout || ""}`,
    `stderr:\n${result.stderr || ""}`
  ].join("\n");
  assert.equal(result.error, undefined, diagnostic);
  assert.equal(result.status, 0, diagnostic);
  assert.match(result.stderr, /\nOK(?:\n|$)/, diagnostic);
  assert.doesNotMatch(result.stderr, /skipped=/, diagnostic);
});
