#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ACCOUNT_CONTRACT = "BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2";
const MODEL_PAIR = "BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1";
const RESEARCH_SOURCE_SHA256 =
  "dc7be719198ff3c936354c75352dfb782eaece65761b4fb47ba5d3fc0f756e25";
const REQUIRED_MODULES = [
  "scripts/spot-paper-paired/host.mjs",
  "scripts/spot-paper-paired/forward.mjs",
  "scripts/spot-paper-paired/fee-scenario.mjs",
  "scripts/spot-paper-paired/feed.mjs",
  "scripts/spot-paper-paired/next-run-composition.mjs",
  "scripts/spot-paper-pilot/core.mjs",
  "scripts/spot-paper-pilot/journal.mjs",
  "scripts/spot-paper-pilot/provider.mjs",
  "scripts/spot-paper-pilot/package-host-evidence.mjs",
  "scripts/spot-paper-paired-report/contract.mjs",
  "scripts/spot-paper-paired-report/evaluate.mjs",
  "scripts/spot-paper-paired-report/cli.mjs",
  "scripts/spot-paper-research/comparison.mjs",
  "scripts/spot-paper-research/entry-confirmation.mjs",
  "scripts/spot-paper-research/five-minute-trend.mjs"
];

function execute(command, args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}`);
  }
  return result;
}

function parseJson(text, description) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${description} did not emit JSON`);
  }
}

function identityArgs(dataRoot, runId) {
  return [
    "identity", "--data-root", dataRoot, "--run-id", runId,
    "--account-contract", ACCOUNT_CONTRACT, "--model-pair", MODEL_PAIR
  ];
}

function dockerRun(image, dataRoot, command = []) {
  return execute("docker", [
    "run", "--rm", "--network", "none",
    "--mount", `type=bind,src=${dataRoot},dst=/evidence-root`,
    image, ...command
  ], {allowFailure: command[0] !== "disabled" && command[0] !== undefined});
}

function assertCommandRejected(result, expectedError, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.match(result.stderr, new RegExp(expectedError.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${label} did not report ${expectedError}: ${result.stderr}`);
}

async function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert(["--source-dir", "--source-sha"].includes(key) && value && !value.startsWith("--"),
      "Use --source-dir PATH --source-sha COMMIT");
    assert(!Object.hasOwn(options, key), `Duplicate option ${key}`);
    options[key] = value;
  }
  assert(options["--source-dir"] && options["--source-sha"],
    "Use --source-dir PATH --source-sha COMMIT");

  const sourceDir = resolve(options["--source-dir"]);
  const sourceSha = options["--source-sha"];
  const checkedOutSha = execute("git", ["rev-parse", "HEAD"], {cwd: sourceDir}).stdout.trim();
  assert.equal(checkedOutSha, sourceSha, "Source checkout does not match the requested pin");
  assert.match(sourceSha, /^[a-f0-9]{40}$/, "A full source commit SHA is required");

  const dockerfilePath = join(sourceDir, "Dockerfile.spot-paper-paired");
  const dockerfile = await readFile(dockerfilePath);
  const imageTag = `meridian-spot-paper-paired-acceptance:${sourceSha.slice(0, 12)}`;
  execute("docker", [
    "build",
    "--label", `org.opencontainers.image.revision=${sourceSha}`,
    "--file", dockerfilePath,
    "--tag", imageTag,
    sourceDir
  ]);
  const image = parseJson(execute("docker", [
    "image", "inspect", "--format", "{{json .}}", imageTag
  ]).stdout, "Docker image inspection");
  assert.equal(image.Config.Labels["org.opencontainers.image.revision"], sourceSha);
  assert.equal(image.Config.User, "node");

  const tempRoot = await mkdtemp(join(tmpdir(), "spot-paper-paired-acceptance-"));
  const dataRoot = join(tempRoot, "evidence-root");
  try {
    await mkdir(dataRoot);
    await chmod(dataRoot, 0o777);
    const runId = `accept-${sourceSha.slice(0, 12)}`;
    const sourceIdentity = parseJson(execute("node", [
      "scripts/spot-paper-paired/host.mjs", ...identityArgs(dataRoot, runId)
    ], {cwd: sourceDir}).stdout, "Source identity command");

    const defaultRun = dockerRun(imageTag, dataRoot);
    const disabled = parseJson(defaultRun.stdout, "Default container command");
    assert.equal(disabled.status, "DISABLED");
    assert.equal(disabled.reason, "NO_RUN_REQUESTED");
    assert.equal(disabled.liveTrading, false);
    assert.equal(disabled.executionImpact, false);
    assert.equal(disabled.autoPromotion, false);

    const containerIdentityRun = dockerRun(imageTag, dataRoot, identityArgs(
      "/evidence-root", runId
    ));
    assert.equal(containerIdentityRun.status, 0, containerIdentityRun.stderr);
    const containerIdentity = parseJson(containerIdentityRun.stdout, "Container identity command");
    assert.deepEqual(containerIdentity, sourceIdentity);
    assert.equal(containerIdentity.modelPairId, MODEL_PAIR);
    assert.equal(containerIdentity.researchSourceSha256, RESEARCH_SOURCE_SHA256);
    assert.deepEqual(containerIdentity.models.map(({modelId}) => modelId), [
      "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1",
      "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1",
      "CASH_CONTROL_V1"
    ]);
    assert.deepEqual(await readdir(dataRoot), [], "Default/identity commands created evidence");

    const importProgram = `
      import assert from "node:assert/strict";
      import { access } from "node:fs/promises";
      import { resolve } from "node:path";
      import { pathToFileURL } from "node:url";
      const modules = ${JSON.stringify(REQUIRED_MODULES)};
      for (const module of modules) {
        const path = resolve(module);
        await access(path);
        await import(pathToFileURL(path).href);
      }
      console.log(JSON.stringify({ importedModules: modules }));
    `;
    const imports = execute("docker", [
      "run", "--rm", "--network", "none", "--entrypoint", "node",
      imageTag, "--input-type=module", "-e", importProgram
    ]);
    const importResult = parseJson(imports.stdout, "Packaged module import check");
    assert.deepEqual(importResult.importedModules, REQUIRED_MODULES);

    const invalidSelections = [
      {
        args: [
          "identity", "--data-root", "/evidence-root", "--run-id", runId,
          "--account-contract", ACCOUNT_CONTRACT, "--model-pair", "UNKNOWN_PAIR"
        ],
        error: "UNKNOWN_MODEL_PAIR",
        label: "unknown model pair"
      },
      {
        args: [
          "identity", "--data-root", "/evidence-root", "--run-id", runId,
          "--account-contract", "UNKNOWN_ACCOUNT"
        ],
        error: "UNKNOWN_ACCOUNT_CONTRACT",
        label: "unknown account contract"
      },
      {
        args: [
          "identity", "--data-root", "/evidence-root", "--run-id", runId,
          "--account-contract", "BTC_EUR_PAIRED_PAPER_V1",
          "--model-pair", MODEL_PAIR
        ],
        error: "MODEL_PAIR_ACCOUNT_CONTRACT_MISMATCH",
        label: "model pair with incompatible account contract"
      },
      {
        args: [
          "identity", "--data-root", "/evidence-root", "--run-id", runId,
          "--account-contract", ACCOUNT_CONTRACT, "--model-pair"
        ],
        error: "VALUE_REQUIRED:--model-pair",
        label: "malformed model pair selection"
      }
    ];
    for (const selection of invalidSelections) {
      const result = dockerRun(imageTag, dataRoot, selection.args);
      assertCommandRejected(result, selection.error, selection.label);
    }
    assert.deepEqual(await readdir(dataRoot), [], "Rejected selections created evidence");

    const existingRunId = "accept-existing-path";
    const existingPath = join(dataRoot, existingRunId);
    await mkdir(existingPath);
    const sentinel = join(existingPath, "preserve.txt");
    await writeFile(sentinel, "existing acceptance fixture\n");
    const existingResult = dockerRun(imageTag, dataRoot, identityArgs(
      "/evidence-root", existingRunId
    ));
    assertCommandRejected(existingResult, "EVIDENCE_PATH_ALREADY_EXISTS",
      "existing evidence path");
    assert.equal(await readFile(sentinel, "utf8"), "existing acceptance fixture\n");
    assert.deepEqual(await readdir(existingPath), ["preserve.txt"]);

    const imageId = image.Id;
    const baseImageDigest =
      "sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293";
    const repoDigests = image.RepoDigests ?? [];
    process.stdout.write(`${JSON.stringify({
      sourceSha,
      sourceDir,
      imageTag,
      imageId,
      repoDigests,
      dockerfileSha256: createHash("sha256").update(dockerfile).digest("hex"),
      baseImageDigest,
      disabledStatus: disabled.status,
      disabledReason: disabled.reason,
      identity: containerIdentity,
      packagedModulesImported: importResult.importedModules,
      rejectedCases: [...invalidSelections.map(({label}) => label), "existing evidence path"],
      evidenceRootEmptyAfterDefaultAndIdentity: true,
      existingFixturePreserved: true,
      networkMode: "none",
      launchedFeed: false,
      runJournalCreated: false,
      remotelyPushed: repoDigests.length > 0
    }, null, 2)}\n`);
  } finally {
    await rm(tempRoot, {recursive: true, force: true});
  }
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`${error.message ?? error}\n`);
  process.exitCode = 1;
});
