#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSpotPaperDashboardDto} from './contract.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function main(argv = process.argv.slice(2)) {
  const [readbackPath, provenancePath, assessmentPath, replayPath,
    expectedDispatchPath, outputPath] = argv;
  if (!readbackPath || !provenancePath || !assessmentPath ||
      !replayPath || !expectedDispatchPath || !outputPath) {
    throw new Error('Usage: create-dto.mjs <readback.json> <pilot-manifest.json> <assessment.json> <signal-replay.json> <independently-verified-dispatch.json> <output.json>');
  }
  const [readback, provenance, assessment, signalReplay, expectedDispatch] =
    await Promise.all([readbackPath, provenancePath, assessmentPath, replayPath,
      expectedDispatchPath].map(readJson));
  const dto = createSpotPaperDashboardDto({
    readback, provenance, assessment, signalReplay, expectedDispatch
  });
  if (!dto) throw new Error('Spot-paper evidence or independently verified dispatch identity was rejected');
  await writeFile(resolve(outputPath), `${JSON.stringify(dto, null, 2)}\n`,
    {encoding: 'utf8', mode: 0o600, flag: 'wx'});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
