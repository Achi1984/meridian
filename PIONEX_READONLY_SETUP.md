# MERIDIAN — Pionex Read-Only API Setup

Status: code-ready, credentials not yet configured.

## Required Pionex permissions

Use one dedicated API key for MERIDIAN with only:
- Enable reading
- Bot reading (Beta), if Pionex has enabled Bot API access for the account

Do NOT enable:
- Enable trading
- Bot trading
- Enable transfer
- Earn or any other write permission

Pionex recommends IP whitelisting where possible.

## Create the key

In Pionex:
1. Account
2. API Management
3. Create API
4. Enable only the read permissions above
5. If Bot reading is not available, request Bot API Beta access from Pionex support
6. Add the runtime/server egress IP to the whitelist when a stable IP is available

Never paste the API Secret into chat, source code, issues, PRs, logs, screenshots, or documentation.

## Runtime secrets

Preferred single-key setup:
- PIONEX_API_KEY
- PIONEX_API_SECRET

Optional split-key setup:
- PIONEX_READ_API_KEY
- PIONEX_READ_API_SECRET
- PIONEX_BOT_READ_API_KEY
- PIONEX_BOT_READ_API_SECRET

Dedicated variables take precedence over the generic pair.

## Read-only endpoints used by MERIDIAN

Account/Futures reading:
- GET /api/v1/account/balances
- GET /uapi/v1/account/balances
- GET /uapi/v1/account/positions

Bot reading:
- GET /api/v1/bot/orders
- GET /api/v1/bot/orders/futuresGrid/order

MERIDIAN does not implement Pionex create, adjust, reduce, cancel, transfer, leverage-update, margin-mode-update, or order-placement calls.

## Verification

After secrets are added to the runtime:
1. /gateway-health must show pionexReadConfigured=true.
2. Bot reading additionally requires pionexBotReadConfigured=true.
3. Data Truth should show ACCOUNT API = OK after a successful read.
4. BOT API should show OK only after Bot API access is enabled and the full list/detail read succeeds.
5. Failed reads retain the previous snapshot as stale; they do not silently promote stale values to fresh data.
