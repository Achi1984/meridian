import { applyReadTokenSecret } from './read-token-auth.mjs';
import { seedKnownPortfolioOnce } from '../private-known-portfolio-seed.js';
import { startPortfolioHistoryCapture } from '../portfolio-history-runtime.js';
import { startPionexBotAutoSync } from '../pionex-bot-auto-sync.js';

// Portfolio quantities are seeded from private runtime env; no exchange API is required.
const auth=applyReadTokenSecret(process.env);
console.log(`[GATEWAY] read auth mode ${auth.mode}`);
await import('../server-gateway.js');
await seedKnownPortfolioOnce();
startPortfolioHistoryCapture();
startPionexBotAutoSync();
