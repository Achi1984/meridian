import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {evaluatePairedPaperFiles} from './evaluate.mjs';

export async function main(argv = process.argv.slice(2)) {
  const [expectedIdentityPath, reportPath, journalPath] = argv;
  if (!expectedIdentityPath || !reportPath || !journalPath || argv.length !== 3) {
    process.stderr.write(
      'Usage: node scripts/spot-paper-paired-report/cli.mjs <expected-identity.json> <report.json> <journal-export.json>\n'
    );
    process.exitCode = 2;
    return;
  }
  const dto = await evaluatePairedPaperFiles({
    expectedIdentityPath, reportPath, journalPath
  });
  process.stdout.write(`${JSON.stringify(dto, null, 2)}\n`);
  if (dto.evidenceStatus === 'CORRUPT_UNKNOWN') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
