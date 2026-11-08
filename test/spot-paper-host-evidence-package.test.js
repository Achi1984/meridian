import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {appendFile, lstat, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EVIDENCE_PACKAGE_LIMITS, main, packageHostEvidence
} from "../scripts/spot-paper-pilot/package-host-evidence.mjs";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "spot-paper-evidence-package-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

async function fixture(root) {
  const run = path.join(root, "runtime", "btc-eur-paper-host-8h-001");
  await mkdir(path.join(run, "responses"), {recursive: true});
  await writeFile(path.join(root, "host.lock"), Buffer.from("partial lock\n"));
  await writeFile(path.join(root, "host-state.json"), Buffer.from("{incomplete"));
  await writeFile(path.join(run, "journal.pending"), Buffer.from("{truncated journal"));
  await writeFile(path.join(run,
    "journal.json.54321.123e4567-e89b-12d3-a456-426614174000.tmp"),
  Buffer.alloc(1_250_000, 0x5a));
  await writeFile(path.join(run, "responses", `${"a".repeat(64)}.json`),
    Buffer.from([0, 0xff, 0x7f, 0x0a, 0xc3]));
  return run;
}

async function packageFixture(root, output) {
  const archive = path.join(output, "evidence.tar");
  const manifest = path.join(output, "evidence.manifest.json");
  const result = await packageHostEvidence({
    evidenceDir: root, archivePath: archive, manifestPath: manifest
  });
  return {archive, manifest, result};
}

test("incomplete and corrupt regular evidence round-trips byte-exactly with a hash manifest", async t => {
  const parent = await temporaryDirectory(t);
  const root = path.join(parent, "evidence");
  const output = path.join(parent, "review");
  await mkdir(root);
  await mkdir(output);
  const run = await fixture(root);
  const original = new Map([
    ["host.lock", Buffer.from("partial lock\n")],
    ["host-state.json", Buffer.from("{incomplete")],
    ["runtime/btc-eur-paper-host-8h-001/journal.pending", Buffer.from("{truncated journal")],
    ["runtime/btc-eur-paper-host-8h-001/journal.json.54321.123e4567-e89b-12d3-a456-426614174000.tmp",
      Buffer.alloc(1_250_000, 0x5a)],
    [`runtime/btc-eur-paper-host-8h-001/responses/${"a".repeat(64)}.json`,
      Buffer.from([0, 0xff, 0x7f, 0x0a, 0xc3])]
  ]);
  const {archive, manifest, result} = await packageFixture(root, output);
  assert.equal(result.status, "PACKAGED_BYTES_ONLY");
  assert.equal(result.scope, "BYTE_PRESERVATION_ONLY");
  assert.equal(result.operationalReadiness, "NOT_ASSESSED");
  assert.equal(result.roundTripVerified, true);
  assert.equal(result.maxPayloadChunkBytes, 64 * 1024);
  assert.equal(result.fileCount, original.size);
  assert.equal(result.directoryCount, 3);
  const records = JSON.parse(await readFile(manifest, "utf8"));
  assert.equal(records.schemaVersion, "SPOT_PAPER_HOST_EVIDENCE_MANIFEST_V1");
  assert.equal(records.preservation, "BYTE_EXACT");
  assert.deepEqual(records.entries.map(entry => entry.path), [...original.keys()].sort());
  for (const entry of records.entries) {
    const bytes = original.get(entry.path);
    assert.equal(entry.sizeBytes, bytes.byteLength);
    assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"));
  }
  const listed = spawnSync("tar", ["-tf", archive], {encoding: "utf8"});
  assert.equal(listed.status, 0, listed.stderr);
  for (const [relative, bytes] of original) {
    const extracted = spawnSync("tar", ["-xOf", archive, relative], {
      encoding: null, maxBuffer: 2 * 1024 * 1024
    });
    assert.equal(extracted.status, 0, extracted.stderr?.toString());
    assert.deepEqual(extracted.stdout, bytes);
  }
  assert.equal((await lstat(run)).isDirectory(), true);
  assert.deepEqual(await readFile(path.join(root, "host-state.json")), Buffer.from("{incomplete"));
});

test("package rejects path traversal through symlinks, symlinks, and special files", async t => {
  const parent = await temporaryDirectory(t);
  const root = path.join(parent, "evidence");
  const output = path.join(parent, "review");
  await mkdir(root);
  await mkdir(output);
  await writeFile(path.join(parent, "outside"), "outside");
  await symlink(path.join(parent, "outside"), path.join(root, "escape"));
  await assert.rejects(packageFixture(root, output), /SYMLINK_IN_EVIDENCE_TREE/);
  await rm(path.join(root, "escape"));

  const fifo = path.join(root, "pipe");
  const created = spawnSync("mkfifo", [fifo]);
  assert.equal(created.status, 0, created.stderr?.toString());
  await assert.rejects(packageFixture(root, output), /SPECIAL_FILE_IN_EVIDENCE_TREE/);

  await rm(fifo);
  const invalidUtf8 = Buffer.concat([Buffer.from(root + path.sep), Buffer.from([0xff])]);
  const invalidName = await open(invalidUtf8, "wx");
  await invalidName.close();
  await assert.rejects(packageFixture(root, output), /UNSUPPORTED_EVIDENCE_PATH_ENCODING/);
});

test("package enforces response, metadata, count, depth, time, and archive bounds", async t => {
  const parent = await temporaryDirectory(t);
  const root = path.join(parent, "evidence");
  const output = path.join(parent, "review");
  await mkdir(root);
  await mkdir(output);
  await mkdir(path.join(root, "responses"));
  await writeFile(path.join(root, "responses", "large.json"),
    Buffer.alloc(EVIDENCE_PACKAGE_LIMITS.maxResponseFileBytes + 1));
  await assert.rejects(packageFixture(root, output), /RESPONSE_FILE_SIZE_LIMIT/);

  await rm(path.join(root, "responses"), {recursive: true});
  await writeFile(path.join(root, "metadata.bin"),
    Buffer.alloc(EVIDENCE_PACKAGE_LIMITS.maxMetadataBytes + 1));
  await assert.rejects(packageFixture(root, output), /EVIDENCE_METADATA_BYTES_LIMIT/);

  await rm(path.join(root, "metadata.bin"));
  const journalRoot = path.join(root, "journal-candidates");
  await mkdir(journalRoot);
  await Promise.all(["a", "b"].map((suffix, index) => writeFile(
    path.join(journalRoot,
      `journal.json.${index}.123e4567-e89b-12d3-a456-426614174000.tmp`),
    Buffer.alloc(4_500_000, suffix.charCodeAt(0))
  )));
  await assert.rejects(packageFixture(root, output), /EVIDENCE_TOTAL_BYTES_LIMIT/);
  await rm(journalRoot, {recursive: true});

  const responseRoot = path.join(root, "responses");
  await mkdir(responseRoot);
  await Promise.all(Array.from({length: EVIDENCE_PACKAGE_LIMITS.maxResponseFiles + 1},
    (_, index) => writeFile(path.join(responseRoot, `r-${index}`), "")));
  await assert.rejects(packageFixture(root, output), /RESPONSE_FILE_COUNT_LIMIT/);

  await rm(responseRoot, {recursive: true});
  const fileRoot = path.join(root, "files");
  await mkdir(fileRoot);
  await Promise.all(Array.from({length: EVIDENCE_PACKAGE_LIMITS.maxFiles + 1},
    (_, index) => writeFile(path.join(fileRoot, `f-${index}`), "")));
  await assert.rejects(packageFixture(root, output), /EVIDENCE_FILE_COUNT_LIMIT/);
  await rm(fileRoot, {recursive: true});

  const deep = ["a", "b", "c", "d", "e", "f", "g", "h", "i"]
    .reduce((parentPath, segment) => path.join(parentPath, segment), root);
  await mkdir(deep, {recursive: true});
  await assert.rejects(packageFixture(root, output), /EVIDENCE_DEPTH_LIMIT/);

  await rm(path.join(root, "a"), {recursive: true});
  let now = 0;
  await assert.rejects(packageHostEvidence({
    evidenceDir: root,
    archivePath: path.join(output, "late.tar"),
    manifestPath: path.join(output, "late.json"),
    timeoutMs: 1,
    monotonicNow: () => now++
  }), /PACKAGE_DEADLINE_EXCEEDED/);
});

test("package rejects output collision and any output located inside the evidence tree", async t => {
  const parent = await temporaryDirectory(t);
  const root = path.join(parent, "evidence");
  const output = path.join(parent, "review");
  await mkdir(root);
  await mkdir(output);
  await writeFile(path.join(root, "journal.pending"), "partial");
  const archive = path.join(output, "existing.tar");
  const manifest = path.join(output, "existing.json");
  await writeFile(archive, "preserve");
  await assert.rejects(packageHostEvidence({
    evidenceDir: root, archivePath: archive, manifestPath: manifest
  }), {code: "EEXIST"});
  assert.equal(await readFile(archive, "utf8"), "preserve");
  const manifestCollision = path.join(output, "occupied.json");
  await writeFile(manifestCollision, "keep manifest");
  const archiveBeforeManifestCollision = path.join(output, "not-published.tar");
  await assert.rejects(packageHostEvidence({
    evidenceDir: root,
    archivePath: archiveBeforeManifestCollision,
    manifestPath: manifestCollision
  }), {code: "EEXIST"});
  assert.equal(await readFile(manifestCollision, "utf8"), "keep manifest");
  await assert.rejects(readFile(archiveBeforeManifestCollision), {code: "ENOENT"});
  await assert.rejects(packageHostEvidence({
    evidenceDir: root,
    archivePath: path.join(root, "archive.tar"),
    manifestPath: path.join(output, "inside.json")
  }), /OUTPUT_MUST_BE_OUTSIDE_EVIDENCE/);
});

test("package detects input mutation while reading and publishes no archive", async t => {
  const parent = await temporaryDirectory(t);
  const root = path.join(parent, "evidence");
  const output = path.join(parent, "review");
  await mkdir(root);
  await mkdir(output);
  const changedFile = path.join(root, "journal.pending");
  await writeFile(changedFile, "initial bytes");
  let changed = false;
  const io = {
    open: async (filename, ...args) => {
      const handle = await open(filename, ...args);
      if (filename !== changedFile || changed) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === "close") {
            return async () => {
              await target.close();
              if (!changed) {
                changed = true;
                await appendFile(changedFile, "-mutated");
              }
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  };
  const archive = path.join(output, "changed.tar");
  await assert.rejects(packageHostEvidence({
    evidenceDir: root,
    archivePath: archive,
    manifestPath: path.join(output, "changed.json"),
    io
  }), /EVIDENCE_CHANGED_DURING_PACKAGE/);
  await assert.rejects(readFile(archive), {code: "ENOENT"});
});

test("successful maintenance package can hold the job open for one bounded download window", async t => {
  const parent = await temporaryDirectory(t);
  const root = path.join(parent, "evidence");
  const output = path.join(parent, "review");
  await mkdir(root);
  await mkdir(output);
  await writeFile(path.join(root, "journal.pending"), "partial");
  let stdout = "";
  const started = Date.now();
  const result = await main([
    root, path.join(output, "held.tar"), path.join(output, "held.json"),
    "--retrieval-window-ms", "25"
  ], {stdout: {write: value => {stdout += value;}}});
  assert.ok(Date.now() - started >= 20);
  assert.equal(result.retrievalWindowMs, 25);
  assert.equal(JSON.parse(stdout).status, "PACKAGED_BYTES_ONLY");
  await assert.rejects(main([
    root, path.join(output, "bad.tar"), path.join(output, "bad.json"),
    "--retrieval-window-ms", "300001"
  ]), /INVALID_RETRIEVAL_WINDOW/);
});
