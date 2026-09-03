import { applyReadTokenSecret } from './read-token-auth.mjs';
import { seedKnownPortfolioOnce } from '../private-known-portfolio-seed.js';

const auth=applyReadTokenSecret(process.env);
console.log(`[GATEWAY] read auth mode ${auth.mode}`);
await import('../server-gateway.js');
await seedKnownPortfolioOnce();
