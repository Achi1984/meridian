import { applyReadTokenSecret } from './read-token-auth.mjs';
import { seedKnownPortfolioOnce } from '../private-known-portfolio-seed.js';
import { startPortfolioHistoryCapture } from '../portfolio-history-runtime.js';
import { startPionexBotAutoSync } from '../pionex-bot-auto-sync.js';
import { startPionexAccountReadSync } from '../pionex-account-read-sync.js';
import { startOkxPortfolioAuthoritySync } from '../okx-portfolio-authority-sync.js';

// Portfolio quantities are seeded from private runtime env; no exchange API is required.
const auth=applyReadTokenSecret(process.env);
console.log(`[GATEWAY] read auth mode ${auth.mode}`);
await import('../server-gateway.js');
await seedKnownPortfolioOnce();
startOkxPortfolioAuthoritySync();
startPortfolioHistoryCapture();
startPionexAccountReadSync();
startPionexBotAutoSync();
