import {pathToFileURL} from 'node:url';
import {exportProgress} from './export.mjs';
import {canonicalJson} from './contract.mjs';

export async function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 4 || args[0] !== '--run-directory' ||
        args[2] !== '--expected-identity-json' ||
        Buffer.byteLength(args[3]) > 16 * 1024) throw new Error('UNKNOWN');
    const result = await exportProgress({
      runDirectory: args[1], expectedIdentity: JSON.parse(args[3])
    });
    process.stdout.write(`${canonicalJson(result.progress ?? {status: result.status})}\n`);
    return result.status === 'EXPORTED' ? 0 : 1;
  } catch {
    process.stdout.write('{"status":"UNKNOWN"}\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
