import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {createHash, randomUUID} from "node:crypto";
import {runStorageDiagnostic} from "../scripts/spot-paper-pilot/storage-diagnostic.mjs";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "spot-paper-storage-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

const options = overrides => ({
  uid: 1000,
  randomUUID: () => "123e4567-e89b-12d3-a456-426614174000",
  now: () => new Date("2026-11-08T12:00:00.000Z"),
  ...overrides
});

test("storage diagnostic makes one bounded exclusive probe and returns structured readback", async t => {
  const mount = await temporaryDirectory(t);
  const result = runStorageDiagnostic(mount, options());
  const bytes = await readFile(result.probePath);
  assert.deepEqual(result, {
    schemaVersion: "SPOT_PAPER_STORAGE_DIAGNOSTIC_V1",
    status: "PASS",
    scope: "STORAGE_OPERATIONS_ONLY",
    mountPath: mount,
    probePath: join(mount, "meridian-storage-probe-123e4567-e89b-12d3-a456-426614174000", "probe.bin"),
    runtimeUid: 1000,
    probeBytes: bytes.byteLength,
    probeSha256: createHash("sha256").update(bytes).digest("hex"),
    freeBytes: result.freeBytes,
    observedAtUtc: "2026-11-08T12:00:00.000Z",
    workLimitBytes: 512,
    timeLimitMs: 10_000,
    operationalReadiness: "NOT_ASSESSED"
  });
  assert.equal(bytes.byteLength <= 512, true);
  assert.equal(JSON.parse(bytes.toString()).createdAtUtc, "2026-11-08T12:00:00.000Z");
  await assert.rejects(readFile(join(mount, "meridian-storage-probe-123e4567-e89b-12d3-a456-426614174000", "probe.pending")),
    {code: "ENOENT"});
});

test("storage diagnostic refuses root and does not retry a unique-child collision", async t => {
  const mount = await temporaryDirectory(t);
  assert.throws(() => runStorageDiagnostic(mount, options({uid: 0})),
    /UNPRIVILEGED_NODE_REQUIRED/);
  const existing = join(mount, "meridian-storage-probe-123e4567-e89b-12d3-a456-426614174000");
  await mkdir(existing);
  await writeFile(join(existing, "preserve.bin"), "keep");
  assert.throws(() => runStorageDiagnostic(mount, options()), {code: "EEXIST"});
  assert.equal(await readFile(join(existing, "preserve.bin"), "utf8"), "keep");
});

test("storage diagnostic rejects unnormalized and symlink mount paths before writes", async t => {
  const parent = await temporaryDirectory(t);
  const mount = join(parent, "mount");
  await mkdir(mount);
  await assert.rejects(async () => runStorageDiagnostic(`${mount}/../mount`, options()),
    /ABSOLUTE_NORMALIZED_MOUNT_REQUIRED/);
  const link = join(parent, "mount-link");
  await import("node:fs/promises").then(fs => fs.symlink(mount, link));
  assert.throws(() => runStorageDiagnostic(link, options()),
    /MOUNT_ANCESTRY_NOT_REAL_DIRECTORY/);
});
