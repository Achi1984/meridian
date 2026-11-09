import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveGitSource } from
  "../scripts/spot-paper-paired-acceptance/source-archive.mjs";

test("acceptance source archive excludes dirty and untracked checkout files", async t => {
  const root = await mkdtemp(join(tmpdir(), "paired-source-archive-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const repository = join(root, "repository");
  await mkdir(repository);
  const git = (...args) => execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Acceptance Test");
  git("config", "user.email", "acceptance@example.invalid");
  await writeFile(join(repository, "packaged.mjs"), "export const pin = 'committed';\n");
  git("add", "packaged.mjs");
  git("commit", "--quiet", "-m", "Pinned source fixture");
  const sourceSha = git("rev-parse", "HEAD");

  await writeFile(join(repository, "packaged.mjs"), "export const pin = 'working-tree';\n");
  await writeFile(join(repository, "untracked.mjs"), "export const pin = 'untracked';\n");
  const result = await archiveGitSource(repository, sourceSha, join(root, "archive"));

  assert.equal(await readFile(join(result.contextPath, "packaged.mjs"), "utf8"),
    "export const pin = 'committed';\n");
  assert.deepEqual(await readdir(result.contextPath), ["packaged.mjs"]);
  assert.match(result.archiveSha256, /^[a-f0-9]{64}$/);
});
