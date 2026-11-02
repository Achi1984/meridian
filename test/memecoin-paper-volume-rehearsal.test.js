import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdir, mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {verifyOwnedDataRoot} from "../scripts/memecoin-paper/host-acceptance.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCKERFILE = fileURLToPath(new URL("../Dockerfile.paper-volume-protection", import.meta.url));
const TARGET = "/var/data/meridian-paper";
const SENTINEL = Buffer.from("preserve existing paper artifacts\n");
const LABEL = "io.meridian.paper-volume-rehearsal";
const OUTPUT_LIMIT = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

function run(command, args, {timeoutMs = DEFAULT_TIMEOUT_MS, maxOutputBytes = OUTPUT_LIMIT} = {}) {
  return new Promise((resolve, reject) => {
    let stdout = [];
    let stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputExceeded = false;
    let spawnError;
    let timedOut = false;
    const child = spawn(command, args, {stdio: ["ignore", "pipe", "pipe"]});
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    function collect(chunks, data, currentBytes) {
      const available = maxOutputBytes - currentBytes;
      if (data.length > available) {
        outputExceeded = true;
        if (available > 0) chunks.push(data.subarray(0, available));
        child.kill("SIGKILL");
        return currentBytes + Math.max(available, 0);
      }
      chunks.push(data);
      return currentBytes + data.length;
    }

    child.stdout.on("data", data => {
      stdoutBytes = collect(stdout, data, stdoutBytes);
    });
    child.stderr.on("data", data => {
      stderrBytes = collect(stderr, data, stderrBytes);
    });
    child.once("error", error => {
      spawnError = error;
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      if (spawnError) {
        reject(spawnError);
      } else if (timedOut) {
        reject(new Error(`${command} exceeded ${timeoutMs}ms`));
      } else if (outputExceeded) {
        reject(new Error(`${command} exceeded the ${maxOutputBytes}-byte output limit`));
      } else {
        resolve({
          status,
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8")
        });
      }
    });
  });
}

function requireSuccess(result, description) {
  assert.equal(result.status, 0,
    `${description} failed${result.signal ? ` (${result.signal})` : ""}: ` +
    `${result.stderr || result.stdout}`.slice(0, OUTPUT_LIMIT));
  return result.stdout.trim();
}

function parseJson(output, description) {
  try {
    return JSON.parse(output);
  } catch {
    assert.fail(`${description} did not emit JSON: ${output.slice(0, 4096)}`);
  }
}

function metadata(info) {
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    uid: Number(info.uid),
    gid: Number(info.gid),
    mode: Number(info.mode & 0o7777n),
    nlink: Number(info.nlink),
    size: Number(info.size),
    mtimeNs: String(info.mtimeNs),
    ctimeNs: String(info.ctimeNs)
  };
}

test("isolated bind-mount repair is idempotent and preserves paper data", {timeout: 300_000}, async t => {
  let dockerInfo;
  try {
    dockerInfo = await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  } catch (error) {
    t.skip(`Docker unavailable; mounted-volume rehearsal not run: ${error.message}`);
    return;
  }
  if (dockerInfo.status !== 0) {
    t.skip(`Docker daemon unavailable; mounted-volume rehearsal not run: ${
      (dockerInfo.stderr || dockerInfo.stdout || `docker info exited ${dockerInfo.status}`).trim()
        .slice(0, 512)
    }`);
    return;
  }

  const token = randomUUID();
  const image = `meridian-paper-volume-rehearsal:${token}`;
  const imageLabel = `${LABEL}=${token}`;
  const containers = new Set();
  let imageBuilt = false;
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `meridian-volume-rehearsal-${token}-`));
  const validVolume = path.join(temporaryRoot, "valid-volume");
  const wrongModeVolume = path.join(temporaryRoot, "wrong-mode-volume");
  await Promise.all([
    mkdir(validVolume, {mode: 0o700}),
    mkdir(wrongModeVolume, {mode: 0o700})
  ]);
  t.after(async () => {
    const cleanupFailures = [];
    try {
      const listed = await run("docker", [
        "ps", "-aq", "--no-trunc", "--filter", `label=${imageLabel}`
      ]);
      if (listed.status !== 0) throw new Error(listed.stderr || "unable to list rehearsal containers");
      const ids = listed.stdout.trim().split(/\s+/).filter(id => /^[a-f0-9]{12,64}$/.test(id));
      for (const id of containers) ids.push(id);
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length) {
        const removed = await run("docker", ["rm", "--force", ...uniqueIds]);
        if (removed.status !== 0) cleanupFailures.push(removed.stderr || removed.stdout);
      }
    } catch (error) {
      cleanupFailures.push(error.message);
    }
    if (imageBuilt) {
      try {
        const listed = await run("docker", [
          "image", "ls", "--quiet", "--no-trunc", "--filter", `label=${imageLabel}`
        ]);
        const imageIds = listed.stdout.trim().split(/\s+/)
          .filter(id => /^sha256:[a-f0-9]{64}$/.test(id));
        if (listed.status !== 0 || imageIds.length !== 1) {
          cleanupFailures.push(listed.stderr || "unable to identify invocation-owned helper image");
        } else {
          const cleanupScript = `
            import fs from "node:fs";
            const target = ${JSON.stringify(TARGET)};
            for (const relative of ["sentinel.bin", "application-data/durable-probe.bin"]) {
              const filename = target + "/" + relative;
              if (fs.existsSync(filename)) fs.unlinkSync(filename);
            }
            const child = target + "/application-data";
            if (fs.existsSync(child)) fs.rmdirSync(child);
            fs.chownSync(target, ${process.getuid()}, ${process.getgid()});
            fs.chmodSync(target, 0o700);
          `;
          for (const source of [validVolume, wrongModeVolume]) {
            const name = `meridian-volume-rehearsal-cleanup-${token}-${nextCleanup++}`;
            const created = await run("docker", [
              "create", "--name", name, "--label", imageLabel, "--network=none", "--read-only",
              "--mount", `type=bind,source=${source},target=${TARGET}`,
              "--entrypoint", "node", imageIds[0], "--input-type=module", "-e", cleanupScript
            ]);
            const id = requireSuccess(created, "cleanup container creation");
            if (!/^[a-f0-9]{12,64}$/.test(id)) {
              cleanupFailures.push("cleanup container returned an invalid ID");
              continue;
            }
            containers.add(id);
            const started = await run("docker", ["start", "--attach", id]);
            if (started.status !== 0) {
              cleanupFailures.push(started.stderr || started.stdout || "cleanup container failed");
            }
          }
        }
      } catch (error) {
        cleanupFailures.push(error.message);
      }
    }
    try {
      const listed = await run("docker", [
        "ps", "-aq", "--no-trunc", "--filter", `label=${imageLabel}`
      ]);
      if (listed.status !== 0) throw new Error(listed.stderr || "unable to list rehearsal containers");
      const ids = listed.stdout.trim().split(/\s+/).filter(id => /^[a-f0-9]{12,64}$/.test(id));
      for (const id of containers) ids.push(id);
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length) {
        const removed = await run("docker", ["rm", "--force", ...uniqueIds]);
        if (removed.status !== 0) cleanupFailures.push(removed.stderr || removed.stdout);
      }
    } catch (error) {
      cleanupFailures.push(error.message);
    }
    try {
      const listed = await run("docker", [
        "image", "ls", "--quiet", "--no-trunc", "--filter", `label=${imageLabel}`
      ]);
      if (listed.status !== 0) throw new Error(listed.stderr || "unable to list rehearsal images");
      const ids = listed.stdout.trim().split(/\s+/).filter(id => /^sha256:[a-f0-9]{64}$/.test(id));
      if (ids.length) {
        const removed = await run("docker", ["image", "rm", "--force", ...ids]);
        if (removed.status !== 0) cleanupFailures.push(removed.stderr || removed.stdout);
      }
    } catch (error) {
      cleanupFailures.push(error.message);
    }
    try {
      await rm(temporaryRoot, {recursive: true, force: true});
    } catch (error) {
      cleanupFailures.push(error.message);
    }
    assert.deepEqual(cleanupFailures, [], "invocation-owned Docker resources must be removed");
  });

  let nextCleanup = 0;
  const build = await run("docker", [
    "build", "--quiet", "--label", imageLabel, "--tag", image,
    "--file", DOCKERFILE, REPOSITORY_ROOT
  ], {timeoutMs: 180_000});
  requireSuccess(build, "helper image build");
  imageBuilt = true;

  const imageConfig = parseJson(requireSuccess(await run("docker", [
    "image", "inspect", "--format", "{{json .Config}}", image
  ]), "helper image inspection"), "helper image config");
  assert.equal(imageConfig.User, "0:1000");
  assert.deepEqual(imageConfig.Entrypoint, ["node", "/helper/volume-protection.mjs"]);
  assert.equal(imageConfig.Cmd, null);

  let nextContainer = 0;
  async function createContainer(source, commandArgs, {entrypoint, user} = {}) {
    const name = `meridian-volume-rehearsal-${token}-${nextContainer++}`;
    const args = [
      "create", "--name", name, "--label", imageLabel, "--network=none", "--read-only",
      "--mount", `type=bind,source=${source},target=${TARGET}`
    ];
    if (user) args.push("--user", user);
    if (entrypoint) args.push("--entrypoint", entrypoint);
    args.push(image, ...commandArgs);
    const created = await run("docker", args);
    const id = requireSuccess(created, "container creation");
    assert.match(id, /^[a-f0-9]{12,64}$/);
    containers.add(id);

    const inspected = parseJson(requireSuccess(await run("docker", [
      "inspect", "--format", "{{json .}}", id
    ]), "container inspection"), "container config");
    assert.equal(inspected.HostConfig.Privileged, false);
    assert.equal(inspected.HostConfig.NetworkMode, "none");
    assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
    assert.notEqual(inspected.HostConfig.PidMode, "host");
    assert.deepEqual(inspected.Mounts.map(({Type, Destination, RW}) =>
      ({Type, Destination, RW})), [{Type: "bind", Destination: TARGET, RW: true}]);
    return id;
  }

  async function executeContainer(id, expectedStatus = 0) {
    const result = await run("docker", ["start", "--attach", id]);
    assert.equal(result.status, expectedStatus,
      `container ${id} exited ${result.status}; stderr=${result.stderr}; stdout=${result.stdout}`);
    return result.stdout.trim();
  }

  async function runNode(source, script, {user} = {}) {
    const id = await createContainer(source, ["--input-type=module", "-e", script], {
      entrypoint: "node",
      user
    });
    return executeContainer(id);
  }

  const setupScript = `
    import fs from "node:fs";
    import {createHash} from "node:crypto";
    const target = ${JSON.stringify(TARGET)};
    const sentinel = Buffer.from(${JSON.stringify(SENTINEL.toString("base64"))}, "base64");
    fs.chownSync(target, 0, 1000);
    fs.chmodSync(target, 0o2775);
    const sentinelPath = target + "/sentinel.bin";
    fs.writeFileSync(sentinelPath, sentinel, {flag: "wx", mode: 0o640});
    fs.chownSync(sentinelPath, 0, 1000);
    fs.chmodSync(sentinelPath, 0o640);
    process.stdout.write(JSON.stringify({
      uid: process.getuid(),
      gid: process.getgid(),
      root: fs.statSync(target, {bigint: true}).mode.toString(8),
      sentinel: createHash("sha256").update(fs.readFileSync(sentinelPath)).digest("hex")
    }));
  `;
  const initialization = parseJson(await runNode(validVolume, setupScript), "mount initialization");
  assert.deepEqual(initialization, {
    uid: 0,
    gid: 1000,
    root: "42775",
    sentinel: createHash("sha256").update(SENTINEL).digest("hex")
  });

  const inspectScript = `
    import fs from "node:fs";
    import {createHash} from "node:crypto";
    const target = ${JSON.stringify(TARGET + "/sentinel.bin")};
    const info = fs.lstatSync(target, {bigint: true});
    const bytes = fs.readFileSync(target);
    process.stdout.write(JSON.stringify({
      metadata: {
        dev: String(info.dev), ino: String(info.ino), uid: Number(info.uid),
        gid: Number(info.gid), mode: Number(info.mode & 0o7777n),
        nlink: Number(info.nlink), size: Number(info.size),
        mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs)
      },
      bytes: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex")
    }));
  `;
  const readSentinel = async () =>
    parseJson(await runNode(validVolume, inspectScript), "sentinel inspection");
  const sentinelBefore = await readSentinel();
  assert.equal(sentinelBefore.bytes, SENTINEL.toString("base64"));
  assert.equal(sentinelBefore.metadata.uid, 0);
  assert.equal(sentinelBefore.metadata.gid, 1000);
  assert.equal(sentinelBefore.metadata.mode, 0o640);

  const repair = parseJson(await executeContainer(
    await createContainer(validVolume, ["--repair"])
  ), "initial repair");
  assert.equal(repair.status, "PROTECTION_APPLIED");
  assert.deepEqual(repair.credentials, {uid: 1000, gid: 1000, supplementaryGroupCount: 0});
  assert.deepEqual(await readSentinel(), sentinelBefore);
  const repairedInfo = await lstat(validVolume, {bigint: true});
  assert.equal(Number(repairedInfo.uid), 0);
  assert.equal(Number(repairedInfo.gid), 1000);
  assert.equal(Number(repairedInfo.mode & 0o7777n), 0o3775);

  for (const args of [["--verify"], ["--repair"], ["--repair"]]) {
    const outcome = parseJson(await executeContainer(
      await createContainer(validVolume, args)
    ), args[0]);
    assert.equal(outcome.status, "ALREADY_PROTECTED");
    assert.deepEqual(outcome.credentials, {uid: 1000, gid: 1000, supplementaryGroupCount: 0});
    assert.deepEqual(await readSentinel(), sentinelBefore);
  }

  const sentinelAfter = await readSentinel();
  assert.deepEqual(sentinelAfter, sentinelBefore);
  const finalInfo = await lstat(validVolume, {bigint: true});
  assert.equal(Number(finalInfo.uid), 0);
  assert.equal(Number(finalInfo.gid), 1000);
  assert.equal(Number(finalInfo.mode & 0o7777n), 0o3775);

  const wrongModeSetup = `
    import fs from "node:fs";
    const target = ${JSON.stringify(TARGET)};
    fs.chownSync(target, 0, 1000);
    fs.chmodSync(target, 0o2774);
  `;
  await runNode(wrongModeVolume, wrongModeSetup);
  const wrongModeBefore = metadata(await lstat(wrongModeVolume, {bigint: true}));
  const wrongModeResult = parseJson(await executeContainer(
    await createContainer(wrongModeVolume, ["--repair"]), 2
  ), "wrong-mode repair");
  assert.equal(wrongModeResult.status, "BLOCKED");
  assert.equal(wrongModeResult.failureCode, "VOLUME_PROTECTION_MODE_MISMATCH");
  assert.deepEqual(wrongModeResult.credentials, {uid: 1000, gid: 1000, supplementaryGroupCount: 0});
  const wrongModeAfter = metadata(await lstat(wrongModeVolume, {bigint: true}));
  assert.deepEqual(wrongModeAfter, wrongModeBefore);

  const childScript = `
    import fs from "node:fs";
    import {createHash} from "node:crypto";
    const target = ${JSON.stringify(TARGET + "/application-data")};
    const bytes = Buffer.from("uid-1000 child data\\n");
    fs.mkdirSync(target, {mode: 0o700});
    const file = target + "/durable-probe.bin";
    const fd = fs.openSync(file, "wx", 0o600);
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    const directoryFd = fs.openSync(target, "r");
    fs.fsyncSync(directoryFd);
    fs.closeSync(directoryFd);
    const readback = fs.readFileSync(file);
    process.stdout.write(JSON.stringify({
      uid: process.getuid(),
      gid: process.getgid(),
      bytes: readback.toString("base64"),
      sha256: createHash("sha256").update(readback).digest("hex")
    }));
  `;
  const child = parseJson(await runNode(validVolume, childScript, {user: "1000:1000"}),
    "runtime child data probe");
  assert.equal(child.uid, 1000);
  assert.equal(child.gid, 1000);
  assert.equal(child.bytes, Buffer.from("uid-1000 child data\n").toString("base64"));
  assert.equal(child.sha256,
    createHash("sha256").update("uid-1000 child data\n").digest("hex"));

  const layout = await verifyOwnedDataRoot({
    mountRoot: validVolume,
    dataRoot: path.join(validVolume, "application-data"),
    runtimeUid: 1000
  });
  assert.equal(Number(layout.mountInfo.uid), 0);
  assert.equal(Number(layout.mountInfo.gid), 1000);
  assert.equal(layout.mountInfo.mode & 0o7777, 0o3775);
  assert.equal(Number(layout.info.uid), 1000);
  assert.equal(Number(layout.info.gid), 1000);
  assert.equal(layout.info.mode & 0o700, 0o700);
  assert.equal(layout.info.mode & 0o077, 0);
  assert.equal(layout.sameDeviceAsMountRoot, true);
});
