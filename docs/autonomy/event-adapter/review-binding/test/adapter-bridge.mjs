// Test-only bridge: actual reviewed adapter, never a replacement implementation.
import fs from 'node:fs';
import {reconcileContinuation} from '../../scripts/event-continuation-adapter.mjs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
input.adapter.snapshot.work.responses=input.binding.plannerResponse?[input.binding.plannerResponse]:[];
process.stdout.write(JSON.stringify(reconcileContinuation(input.adapter)));
