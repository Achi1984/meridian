import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {HISTORICAL_RUN_PROFILE} from '../research/b1-7/historical-profile.mjs';
import {runB1Adapter} from './b1_adapter.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runB1Adapter(HISTORICAL_RUN_PROFILE.profile).catch(error => {
    process.stderr.write(`${error?.code ?? error?.message ?? 'HISTORICAL_ADAPTER_FAILED'}\n`);
    process.exitCode = 1;
  });
}
