import { applyReadTokenSecret } from './read-token-auth.mjs';
import { startExchangeAutoSync } from '../exchange-auto-sync.js';

const auth=applyReadTokenSecret(process.env);
console.log(`[GATEWAY] read auth mode ${auth.mode}`);
await import('../server-gateway.js');
startExchangeAutoSync();
