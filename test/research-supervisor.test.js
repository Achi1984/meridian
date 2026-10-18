import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("durable bounded research supervisor synthetic suite", () => {
  const result = spawnSync("python3", ["-B", path.join(root, "scripts/research-supervisor/test_supervisor.py")], {
    cwd: root,
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 2 * 1024 * 1024
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /OK/);
});
