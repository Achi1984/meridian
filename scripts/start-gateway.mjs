import { applyReadTokenSecret } from './read-token-auth.mjs';

const auth=applyReadTokenSecret(process.env);
console.log(`[GATEWAY] read auth mode ${auth.mode}`);
await import('../server-gateway.js');
