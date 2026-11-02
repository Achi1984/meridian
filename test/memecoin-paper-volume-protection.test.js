import assert from "node:assert/strict";
import {constants as fsConstants} from "node:fs";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {
  EXPECTED_MODE,
  PROTECTED_MODE,
  REQUIRED_GID,
  REQUIRED_UID,
  RUNTIME_GID,
  RUNTIME_UID,
  TARGET,
  main,
  parseMountInfo,
  runOneShot
} from "../scripts/memecoin-paper/volume-protection.mjs";

const DOCKERFILE = fileURLToPath(new URL("../Dockerfile.paper-volume-protection", import.meta.url));

function directoryInfo(overrides = {}) {
  const info = {
    dev: 50,
    ino: 60,
    uid: REQUIRED_UID,
    gid: REQUIRED_GID,
    mode: 0o040000 | EXPECTED_MODE,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    ...overrides
  };
  return info;
}

function fixture({
  mode = EXPECTED_MODE,
  uid = REQUIRED_UID,
  gid = REQUIRED_GID,
  lstatOverride,
  canonicalPath = TARGET,
  descriptorStat,
  descriptorInfo = "pos:\t0\nflags:\t0100000\nmnt_id:\t41\n",
  failDescriptorInfo = false,
  failReadback = false,
  failChmod = false,
  failClose = false,
  mountInfo = "41 20 0:50 / /var/data/meridian-paper rw - ext4 /dev/mock rw"
} = {}) {
  const events = [];
  const target = directoryInfo({mode: 0o040000 | mode, uid, gid});
  let chmodCalls = 0;
  let descriptorStats = 0;
  let pathStats = 0;
  const fsOps = {
    async lstat(filename) {
      events.push(["lstat", filename]);
      pathStats += 1;
      if (lstatOverride) {
        const overridden = lstatOverride({filename, target, pathStats, chmodCalls});
        if (overridden) return overridden;
      }
      if (filename === TARGET) return directoryInfo(target);
      return directoryInfo({dev: 1, ino: filename.length, uid: 0, gid: 0, mode: 0o040755});
    },
    async realpath(filename) {
      events.push(["realpath", filename]);
      return canonicalPath;
    },
    async readFile(filename, encoding) {
      events.push(["readFile", filename, encoding]);
      if (filename === "/proc/self/mountinfo") return mountInfo;
      if (failDescriptorInfo) throw new Error("descriptor evidence unavailable");
      return descriptorInfo;
    },
    async open(filename, flags) {
      events.push(["open", filename, flags]);
      return {
        fd: 123,
        async stat() {
          events.push(["fstat"]);
          descriptorStats += 1;
          if (failReadback && descriptorStats > 1) throw new Error("readback unavailable");
          return descriptorStat ? descriptorStat({target, descriptorStats}) : directoryInfo(target);
        },
        async chmod(nextMode) {
          events.push(["fchmod", nextMode]);
          chmodCalls += 1;
          if (failChmod) throw new Error("ambiguous chmod");
          target.mode = 0o040000 | nextMode;
        },
        async close() {
          events.push(["close"]);
          if (failClose) throw new Error("close failed");
        }
      };
    }
  };

  const credentialState = {
    uid: 0,
    euid: 0,
    gid: 0,
    egid: 0,
    groups: [0, 1000],
    calls: []
  };
  const credentials = {
    getuid: () => credentialState.uid,
    geteuid: () => credentialState.euid,
    getgid: () => credentialState.gid,
    getegid: () => credentialState.egid,
    getgroups: () => [...credentialState.groups],
    setgroups(groups) {
      credentialState.calls.push(["setgroups", [...groups]]);
      credentialState.groups = [...groups];
    },
    setgid(gid) {
      credentialState.calls.push(["setgid", gid]);
      credentialState.gid = gid;
      credentialState.egid = gid;
    },
    setuid(uid) {
      credentialState.calls.push(["setuid", uid]);
      credentialState.uid = uid;
      credentialState.euid = uid;
    }
  };

  return {fsOps, credentials, credentialState, events, get chmodCalls() { return chmodCalls; }};
}

function assertDropped(harness) {
  assert.deepEqual(harness.credentialState.calls, [
    ["setgroups", []],
    ["setgid", RUNTIME_GID],
    ["setuid", RUNTIME_UID]
  ]);
  assert.equal(harness.credentialState.uid, RUNTIME_UID);
  assert.equal(harness.credentialState.euid, RUNTIME_UID);
  assert.equal(harness.credentialState.gid, RUNTIME_GID);
  assert.equal(harness.credentialState.egid, RUNTIME_GID);
  assert.deepEqual(harness.credentialState.groups, []);
}

function spawn(command, args) {
  const result = spawnSync(command, args, {encoding: "utf8"});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("mountinfo requires one exact decoded mountpoint", () => {
  assert.equal(parseMountInfo(
    "41 20 0:50 / /var/data/meridian-paper rw - ext4 /dev/mock rw"
  ), true);
  assert.equal(parseMountInfo(
    "41 20 0:50 / /var/data/meridian-paper-extra rw - ext4 /dev/mock rw"
  ), false);
  assert.equal(parseMountInfo(
    "41 20 0:50 / /var/data/meridian\\040paper rw - ext4 /dev/mock rw"
  ), false);
  assert.equal(parseMountInfo([
    "41 20 0:50 / /var/data/meridian-paper rw - ext4 /dev/one rw",
    "42 20 0:51 / /var/data/meridian-paper rw - ext4 /dev/two rw"
  ].join("\n")), false);
  assert.equal(parseMountInfo(
    "invalid 20 0:50 / /var/data/meridian-paper rw - ext4 /dev/mock rw"
  ), false);
});

test("descriptor mount identity must match the unique target mount before mutation", async t => {
  for (const [label, options] of [
    ["covering mount descriptor", {descriptorInfo: "mnt_id:\t42\n"}],
    ["missing descriptor evidence", {descriptorInfo: "pos:\t0\n"}],
    ["malformed descriptor evidence", {descriptorInfo: "mnt_id:\tnot-a-number\n"}],
    ["unreadable descriptor evidence", {failDescriptorInfo: true}]
  ]) {
    await t.test(label, async () => {
      const harness = fixture(options);
      const result = await runOneShot({
        mode: "REPAIR",
        fsOps: harness.fsOps,
        credentials: harness.credentials
      });
      assert.equal(result.status, "BLOCKED");
      assert.equal(result.failureCode, "VOLUME_PROTECTION_MOUNT_IDENTITY_MISMATCH");
      assert.equal(harness.chmodCalls, 0);
      assert.equal(harness.events.some(([operation]) => operation === "fchmod"), false);
      assert.equal(harness.events.some(([operation, filename]) =>
        operation === "readFile" && filename === "/proc/self/fdinfo/123"), true);
      assertDropped(harness);
    });
  }
});

test("applies exactly one descriptor-bound mode change and drops credentials", async () => {
  const harness = fixture();
  const result = await runOneShot({
    mode: "REPAIR",
    fsOps: harness.fsOps,
    credentials: harness.credentials,
    exitImmediately: () => assert.fail("unexpected exit")
  });

  assert.equal(result.status, "PROTECTION_APPLIED");
  assert.equal(result.credentials.uid, REQUIRED_GID);
  assert.equal(result.credentials.gid, REQUIRED_GID);
  assert.equal(result.credentials.supplementaryGroupCount, 0);
  assert.equal(harness.chmodCalls, 1);
  assert.equal(harness.events.filter(([operation]) => operation === "fchmod").length, 1);
  assert.deepEqual(harness.events.find(([operation]) => operation === "fchmod"), [
    "fchmod",
    PROTECTED_MODE
  ]);
  assert.equal(harness.events.find(([operation]) => operation === "open")[2],
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  assert.equal(harness.events.filter(([operation]) => operation === "close").length, 1);
  assert.deepEqual(harness.events.filter(([operation]) =>
    ["readFile", "open"].includes(operation)).map(([operation, filename]) => [operation, filename]), [
    ["readFile", "/proc/self/mountinfo"],
    ["open", TARGET],
    ["readFile", "/proc/self/fdinfo/123"]
  ]);
  assert.equal(harness.events.some(([operation]) => operation === "readdir"), false);
  assertDropped(harness);
});

test("already-protected mount verifies without mutation and still drops credentials", async () => {
  const harness = fixture({mode: PROTECTED_MODE});
  const result = await runOneShot({
    mode: "REPAIR",
    fsOps: harness.fsOps,
    credentials: harness.credentials
  });
  assert.equal(result.status, "ALREADY_PROTECTED");
  assert.equal(harness.chmodCalls, 0);
  assertDropped(harness);
});

test("explicit verify mode is read-only and reports the verified mode", async () => {
  const harness = fixture({mode: PROTECTED_MODE});
  const result = await runOneShot({
    mode: "VERIFY",
    fsOps: harness.fsOps,
    credentials: harness.credentials
  });
  assert.equal(result.status, "ALREADY_PROTECTED");
  assert.deepEqual(result.volume, {uid: REQUIRED_UID, gid: REQUIRED_GID, mode: "03775"});
  assert.equal(harness.chmodCalls, 0);
  assertDropped(harness);

  const unprotected = fixture();
  const blocked = await runOneShot({
    mode: "VERIFY",
    fsOps: unprotected.fsOps,
    credentials: unprotected.credentials
  });
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(unprotected.chmodCalls, 0);
  assertDropped(unprotected);
});

test("rejects unsafe owner, mode, symlink, mountpoint, and inode before mutation", async t => {
  const cases = [
    ["wrong owner", fixture({uid: REQUIRED_UID + 1}), "VOLUME_PROTECTION_OWNER_MISMATCH"],
    ["wrong group", fixture({gid: REQUIRED_GID + 1}), "VOLUME_PROTECTION_OWNER_MISMATCH"],
    ["wrong mode", fixture({mode: 0o2777}), "VOLUME_PROTECTION_MODE_MISMATCH"],
    ["noncanonical path", fixture({canonicalPath: "/var/data/other"}),
      "VOLUME_PROTECTION_PATH_UNSAFE"],
    ["not a mountpoint", fixture({mountInfo: "41 20 0:50 / /var/data rw - ext4 /dev/mock rw"}),
      "VOLUME_PROTECTION_MOUNTPOINT_MISMATCH"],
    ["descriptor path race", fixture({
      lstatOverride: ({filename, target}) => filename === TARGET
        ? directoryInfo({...target, ino: target.ino + 1})
        : undefined
    }), "VOLUME_PROTECTION_PATH_IDENTITY_MISMATCH"]
  ];

  for (const [label, harness, failureCode] of cases) {
    await t.test(label, async () => {
      const result = await runOneShot({
        mode: "REPAIR",
        fsOps: harness.fsOps,
        credentials: harness.credentials
      });
      assert.equal(result.status, "BLOCKED");
      assert.equal(result.failureCode, failureCode);
      assert.equal(harness.chmodCalls, 0);
      assertDropped(harness);
    });
  }

  const symlink = fixture({
    lstatOverride: ({filename, target}) => filename === TARGET
      ? directoryInfo({...target, isSymbolicLink: () => true})
      : undefined
  });
  const symlinkResult = await runOneShot({
    mode: "REPAIR",
    fsOps: symlink.fsOps,
    credentials: symlink.credentials
  });
  assert.equal(symlinkResult.failureCode, "VOLUME_PROTECTION_PATH_UNSAFE");
  assert.equal(symlink.events.some(([operation]) => operation === "open"), false);
  assertDropped(symlink);

  const symlinkParent = fixture({
    lstatOverride: ({filename}) => filename === "/var/data"
      ? directoryInfo({isSymbolicLink: () => true})
      : undefined
  });
  const parentResult = await runOneShot({
    mode: "REPAIR",
    fsOps: symlinkParent.fsOps,
    credentials: symlinkParent.credentials
  });
  assert.equal(parentResult.failureCode, "VOLUME_PROTECTION_PATH_UNSAFE");
  assert.equal(symlinkParent.events.some(([operation]) => operation === "open"), false);
  assertDropped(symlinkParent);
});

test("rejects wrong-owner and writable ancestors before opening target", async t => {
  for (const [label, ancestorInfo] of [
    ["wrong owner", directoryInfo({uid: RUNTIME_UID})],
    ["group writable", directoryInfo({mode: 0o040775})],
    ["world writable", directoryInfo({mode: 0o040757})]
  ]) {
    await t.test(label, async () => {
      const harness = fixture({
        lstatOverride: ({filename}) => filename === "/var/data" ? ancestorInfo : undefined
      });
      const result = await runOneShot({
        mode: "REPAIR",
        fsOps: harness.fsOps,
        credentials: harness.credentials
      });
      assert.equal(result.status, "BLOCKED");
      assert.equal(result.failureCode, "VOLUME_PROTECTION_PATH_UNSAFE");
      assert.equal(harness.events.some(([operation]) => operation === "open"), false);
      assert.equal(harness.chmodCalls, 0);
      assertDropped(harness);
    });
  }
});

test("ambiguous mutation/readback remains UNKNOWN without retry or rollback", async t => {
  for (const [label, options] of [
    ["write error", {failChmod: true}],
    ["readback error", {failReadback: true}],
    ["path replaced during readback", {
      lstatOverride: ({filename, target, chmodCalls}) => filename === TARGET
        ? directoryInfo({...target, ino: chmodCalls ? target.ino + 1 : target.ino})
        : undefined
    }]
  ]) {
    await t.test(label, async () => {
      const harness = fixture(options);
      const result = await runOneShot({
        mode: "REPAIR",
        fsOps: harness.fsOps,
        credentials: harness.credentials
      });
      assert.equal(result.status, "UNKNOWN");
      assert.equal(result.failureCode, "VOLUME_PROTECTION_READBACK_UNKNOWN");
      assert.equal(harness.chmodCalls, 1);
      assert.equal(harness.events.filter(([operation]) => operation === "fchmod").length, 1);
      assertDropped(harness);
    });
  }
});

test("every ordinary mode drops credentials and failed drop exits before output or keepalive", async t => {
  for (const mode of ["DISABLED", "INVALID"]) {
    await t.test(mode, async () => {
      const harness = fixture();
      const result = await runOneShot({mode, credentials: harness.credentials});
      assert.equal(result.status, mode === "DISABLED" ? "DISABLED" : "BLOCKED");
      assertDropped(harness);
    });
  }

  const nonRoot = fixture();
  nonRoot.credentialState.uid = 42;
  nonRoot.credentialState.euid = 42;
  const rejected = await runOneShot({
    mode: "REPAIR",
    credentials: nonRoot.credentials
  });
  assert.equal(rejected.status, "BLOCKED");
  assert.equal(rejected.failureCode, "VOLUME_PROTECTION_ROOT_REQUIRED");
  assertDropped(nonRoot);

  const harness = fixture();
  let exits = 0;
  let writes = 0;
  let keepalives = 0;
  const credentials = {
    ...harness.credentials,
    setgroups() {
      throw new Error("cannot drop groups");
    }
  };
  await assert.rejects(main(["--keepalive"], {
    credentials,
    write: () => { writes += 1; },
    keepalive: () => { keepalives += 1; },
    exitImmediately: code => { exits += 1; assert.equal(code, 1); }
  }), /PRIVILEGE_DROP_FAILED/);
  assert.equal(exits, 1);
  assert.equal(writes, 0);
  assert.equal(keepalives, 0);
});

test("descriptor close failure exits without reporting or remaining idle", async () => {
  const harness = fixture({failClose: true});
  let exits = 0;
  let writes = 0;
  await assert.rejects(main(["--repair", "--keepalive"], {
    fsOps: harness.fsOps,
    credentials: harness.credentials,
    write: () => { writes += 1; },
    keepalive: () => assert.fail("must not keep alive"),
    exitImmediately: code => { exits += 1; assert.equal(code, 1); }
  }), /DESCRIPTOR_CLOSE_UNKNOWN/);
  assert.equal(exits, 1);
  assert.equal(writes, 0);
  assertDropped(harness);
});

test("import is inert", () => {
  const output = spawn(process.execPath, ["--input-type=module", "-e",
    `await import(${JSON.stringify(new URL("../scripts/memecoin-paper/volume-protection.mjs", import.meta.url).href)})`
  ]);
  assert.equal(output, "");
});

test("isolated helper image uses UID 0/GID 1000 by default and drops to 1000:1000", async t => {
  const dockerInfo = spawnSync("docker", ["info"], {encoding: "utf8"});
  if (dockerInfo.error || dockerInfo.status !== 0) {
    t.skip("Docker daemon unavailable; isolated container privilege-drop check not run");
    return;
  }

  const image = `meridian-paper-volume-protection-test:${process.pid}`;
  t.after(() => {
    spawnSync("docker", ["image", "rm", "--force", image], {stdio: "ignore"});
  });
  spawn("docker", ["build", "--tag", image, "--file", DOCKERFILE,
    fileURLToPath(new URL("..", import.meta.url))]);

  const initialCredentials = JSON.parse(spawn("docker", [
    "run", "--rm", "--network=none", "--read-only", "--entrypoint", "node", image,
    "-e", "process.stdout.write(JSON.stringify({uid: process.getuid(), gid: process.getgid()}))"
  ]));
  assert.deepEqual(initialCredentials, {uid: 0, gid: REQUIRED_GID});

  const output = JSON.parse(spawn("docker", [
    "run", "--rm", "--network=none", "--read-only", image
  ]));
  assert.equal(output.status, "DISABLED");
  assert.deepEqual(output.credentials, {
    uid: RUNTIME_UID,
    gid: RUNTIME_GID,
    supplementaryGroupCount: 0
  });
});
