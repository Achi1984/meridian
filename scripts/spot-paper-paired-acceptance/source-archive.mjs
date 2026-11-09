import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function run(command, args, {cwd} = {}) {
  const result = spawnSync(command, args, {cwd, encoding: "utf8"});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

export async function archiveGitSource(sourceDir, sourceSha, destination) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) {
    throw new Error("A full source commit SHA is required");
  }
  const resolvedSha = run("git", ["rev-parse", "--verify", `${sourceSha}^{commit}`], {
    cwd: sourceDir
  });
  if (resolvedSha !== sourceSha) {
    throw new Error("Source revision did not resolve to the requested commit");
  }

  await mkdir(destination, {recursive: false});
  const archivePath = join(destination, "source.tar");
  const contextPath = join(destination, "context");
  await mkdir(contextPath);
  try {
    run("git", [
      "archive", "--format=tar", `--output=${archivePath}`, sourceSha
    ], {cwd: sourceDir});
    const archive = await readFile(archivePath);
    const archiveSha256 = createHash("sha256").update(archive).digest("hex");
    run("tar", ["-xf", archivePath, "-C", contextPath]);
    return {contextPath, archiveSha256};
  } catch (error) {
    await rm(destination, {recursive: true, force: true});
    throw error;
  } finally {
    await rm(archivePath, {force: true});
  }
}
