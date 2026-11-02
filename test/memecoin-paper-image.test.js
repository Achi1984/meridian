import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cp, mkdir, mkdtemp, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assemblyCheck = `
import assert from "node:assert/strict";
import {stat} from "node:fs/promises";
import {createPinnedAssembly} from "./scripts/memecoin-paper/pilot-online-assembly.mjs";
let fetchCalls = 0;
const assembly = await createPinnedAssembly({
  fetchImpl: () => { fetchCalls += 1; throw new Error("unexpected network request"); }
});
assert.equal(typeof assembly.acquireProviderEvidence, "function");
assert.equal(typeof assembly.createPilotRunControl, "function");
assert.equal(typeof assembly.projectOperatorReport, "function");
assert.equal(typeof assembly.renderOperatorReport, "function");
assert.equal(fetchCalls, 0);
for (const file of [
  "./scripts/memecoin-paper/provider-evidence.mjs",
  "./scripts/memecoin-paper-token-safety/evidence-bridge.mjs"
]) {
  assert.equal((await stat(file)).uid, process.getuid());
}
console.log("ASSEMBLY_OK");
`;
const disabledCheck = `
import assert from "node:assert/strict";
globalThis.fetch = () => { throw new Error("unexpected network request"); };
const {main} = await import("./scripts/memecoin-paper/pilot-online.mjs");
const result = await main([]);
assert.equal(result.status, "DISABLED");
assert.equal(result.acquisitionStarted, false);
assert.equal(result.executionStarted, false);
`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: "utf8", ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function stageDockerCopies(directory) {
  const dockerfile = await readFile(path.join(root, "Dockerfile.paper"), "utf8");
  const copyLines = dockerfile.split(/\r?\n/).filter(line => line.startsWith("COPY "));
  assert.ok(copyLines.length > 0, "Dockerfile.paper must copy application files");
  for (const line of copyLines) {
    const match = line.match(/^COPY(?:\s+--chown=\S+)?\s+(\S+)\s+(\S+)$/);
    assert.ok(match, `unsupported Dockerfile COPY instruction: ${line}`);
    const source = path.resolve(root, match[1]);
    const destination = path.resolve(directory, match[2]);
    assert.ok(source.startsWith(`${root}${path.sep}`), "COPY source must stay inside the repository");
    assert.ok(destination.startsWith(`${directory}${path.sep}`), "COPY destination must stay inside staging");
    await mkdir(path.dirname(destination), {recursive: true});
    await cp(source, destination, {recursive: true});
  }
}

test("Paper image packages and imports its pinned assembly without starting acquisition", async t => {
  const stagedRoot = await mkdtemp(path.join(os.tmpdir(), "meridian-paper-image-"));
  t.after(() => rm(stagedRoot, {recursive: true, force: true}));

  const dockerInfo = spawnSync("docker", ["info"], {encoding: "utf8"});
  if (dockerInfo.error || dockerInfo.status !== 0) {
    await stageDockerCopies(stagedRoot);
    assert.match(run(process.execPath, ["--input-type=module", "-e", assemblyCheck], {
      cwd: stagedRoot
    }), /ASSEMBLY_OK/);
    const disabled = run(process.execPath, ["--input-type=module", "-e", disabledCheck], {
      cwd: stagedRoot
    });
    assert.match(disabled, /"status":"DISABLED"/);
    t.diagnostic(
      "Docker daemon unavailable; Dockerfile COPY staging and assembly/default checks passed locally, but image execution was not verified."
    );
    return;
  }

  const image = `meridian-paper-image-test:${process.pid}`;
  t.after(() => {
    spawnSync("docker", ["image", "rm", "--force", image], {stdio: "ignore"});
  });
  run("docker", ["build", "--tag", image, "--file", "Dockerfile.paper", "."], {cwd: root});
  assert.match(run("docker", [
    "run", "--rm", "--network=none", "--entrypoint", "node",
    image, "--input-type=module", "-e", assemblyCheck
  ]), /ASSEMBLY_OK/);

  const imageConfig = run("docker", [
    "inspect", "--format", "{{.Config.User}} {{json .Config.Entrypoint}}", image
  ]);
  assert.equal(imageConfig, 'node ["node","scripts/memecoin-paper/pilot-online.mjs"]');
  const disabled = JSON.parse(run("docker", ["run", "--rm", "--network=none", image]));
  assert.equal(disabled.status, "DISABLED");
  assert.equal(disabled.acquisitionStarted, false);
  assert.equal(disabled.executionStarted, false);
});
