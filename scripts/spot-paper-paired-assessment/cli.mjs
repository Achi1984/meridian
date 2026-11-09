import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  readBoundedJsonFile,
  SPOT_PAPER_PAIRED_MAX_HOST_EXPORT_BYTES
} from '../spot-paper-paired-report/evaluate.mjs';
import {formatSpotPaperPairedAssessment} from './format.mjs';

function usage(stderr) {
  stderr.write(
    'Usage: node scripts/spot-paper-paired-assessment/cli.mjs ' +
    '[--format markdown|json] <sanitized-dashboard.json>\n'
  );
}

export async function main(argv = process.argv.slice(2), {
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  let format = 'markdown';
  let formatSpecified = false;
  let inputPath;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--format' && index + 1 < argv.length) {
      if (formatSpecified || !['markdown', 'json'].includes(argv[index + 1])) {
        usage(stderr);
        return 2;
      }
      formatSpecified = true;
      format = argv[++index];
    } else if (argv[index].startsWith('--') || inputPath !== undefined) {
      usage(stderr);
      return 2;
    } else {
      inputPath = argv[index];
    }
  }
  if (!inputPath) {
    usage(stderr);
    return 2;
  }

  try {
    const dto = await readBoundedJsonFile(
      inputPath, SPOT_PAPER_PAIRED_MAX_HOST_EXPORT_BYTES
    );
    stdout.write(formatSpotPaperPairedAssessment(dto, format));
    return 0;
  } catch (error) {
    const code = error?.message === 'PAIRED_DASHBOARD_INVALID' ?
      'PAIRED_DASHBOARD_INVALID' : 'INPUT_INVALID_OR_OVERSIZED';
    stderr.write(`${code}\n`);
    return 1;
  }
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
