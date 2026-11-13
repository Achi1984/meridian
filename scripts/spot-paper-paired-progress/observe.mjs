#!/usr/bin/env node
import {isAbsolute, normalize} from 'node:path';
import {pathToFileURL} from 'node:url';
import {exportProgress} from './export.mjs';
import {publishProgress, readProgressJsonFile, PUBLISH_TOKEN_ENV} from './publish.mjs';
import {validIdentity, validateProgress} from './contract.mjs';

export const CADENCE_MS = 60_000;

export async function observe({
  runDirectory, expectedIdentity, endAt, maxTicks, token,
  exportImpl = exportProgress, publishImpl = publishProgress,
  now = Date.now, monotonic = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const result = (status, ticks) => ({status, ticks});
  if (typeof runDirectory !== 'string' || !isAbsolute(runDirectory) ||
      normalize(runDirectory) !== runDirectory || !validIdentity(expectedIdentity) ||
      !Number.isSafeInteger(endAt) || endAt <= now() ||
      !Number.isSafeInteger(maxTicks) || maxTicks < 1 ||
      typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token) ||
      typeof exportImpl !== 'function' || typeof publishImpl !== 'function' ||
      typeof sleep !== 'function') return result('REJECTED', 0);

  const identity = structuredClone(expectedIdentity);
  let last = null;
  let ticks = 0;
  let next = monotonic();
  try {
    while (ticks < maxTicks) {
      if (now() >= endAt) return result('END_REACHED', ticks);
      const wait = next - monotonic();
      if (wait > 0) {
        await sleep(Math.min(wait, endAt - now()));
        const late = monotonic() - next;
        if (late >= CADENCE_MS) next += (Math.floor(late / CADENCE_MS) + 1) * CADENCE_MS;
        continue;
      }
      const started = monotonic();
      ticks++;
      const exported = await exportImpl({runDirectory, expectedIdentity: identity});
      if (exported?.status === 'IDENTITY_CONFLICT') return result('IDENTITY_CONFLICT', ticks);
      if (exported?.status !== 'BUSY' && exported?.status !== 'UNKNOWN') {
        if (exported?.status !== 'EXPORTED') return result('REJECTED', ticks);
        const progress = validateProgress(exported.progress, identity);
        if (!progress) return result('IDENTITY_CONFLICT', ticks);
        if (last && (progress.journalSequence < last.journalSequence ||
            progress.journalSequence === last.journalSequence &&
            progress.journalSha256 !== last.journalSha256)) {
          return result('SEQUENCE_CONFLICT', ticks);
        }
        if (!last || progress.journalSequence !== last.journalSequence) {
          if (now() >= endAt) return result('END_REACHED', ticks);
          let published;
          try {
            published = await publishImpl(progress, {
              expectedIdentity: identity, enabled: true, token
            });
          } catch {
            return result('UPLOAD_UNKNOWN', ticks);
          }
          if (published?.status !== 'PUBLISHED') {
            return result(published?.status === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'UPLOAD_UNKNOWN', ticks);
          }
          last = {journalSequence: progress.journalSequence, journalSha256: progress.journalSha256};
          if (progress.terminal.status !== 'UNKNOWN') return result('TERMINAL', ticks);
        }
      }
      const elapsed = monotonic() - next;
      next = Math.max(started + CADENCE_MS,
        next + (Math.floor(Math.max(0, elapsed) / CADENCE_MS) + 1) * CADENCE_MS);
    }
    return result('MAX_TICKS', ticks);
  } catch {
    return result('UNKNOWN', ticks);
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      if (!['--run-directory', '--expected-identity', '--end-at', '--max-ticks'].includes(key) ||
          Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error();
      options[key] = args[i + 1];
    }
    if (Object.keys(options).length !== 4 ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(options['--end-at']) ||
        !/^[1-9]\d*$/.test(options['--max-ticks']) ||
        !isAbsolute(options['--expected-identity'])) throw new Error();
    const endAt = Date.parse(options['--end-at']);
    const supplied = options['--end-at'].replace(/(?:\.(\d{1,3}))?Z$/,
      (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
    if (!Number.isSafeInteger(endAt) || new Date(endAt).toISOString() !== supplied) throw new Error();
    const expectedIdentity = await readProgressJsonFile(options['--expected-identity']);
    return await observe({
      runDirectory: options['--run-directory'], expectedIdentity,
      endAt, maxTicks: Number(options['--max-ticks']),
      token: env[PUBLISH_TOKEN_ENV]
    });
  } catch {
    return {status: 'REJECTED', ticks: 0};
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await main();
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  process.exitCode = ['END_REACHED', 'MAX_TICKS', 'TERMINAL'].includes(outcome.status) ? 0 : 1;
}
