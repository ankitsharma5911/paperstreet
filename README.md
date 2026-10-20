# Paperstreet

Indian equities, index futures and options paper trading with virtual funds. Each simulation or broker-data account starts with ₹10,00,000. Real broker orders are never submitted.

## Connect your daily Zerodha enctoken

1. Open **Data connections → Zerodha web session**.
2. Paste the current `enctoken` value from your own authenticated Kite session. Enter only the token value, not other cookies.
3. Select **Connect & validate feed**. Update the token daily, or whenever Zerodha rejects the session.
4. Open **Futures & options** to browse current broker-listed contracts and place paper orders.

The web-session adapter calls Zerodha's unofficial `/oms/quote` endpoint with an `enctoken` authorization header. It may be blocked or changed by Zerodha. It does not automate login, collect a password/OTP, or bypass broker challenges. The supplied daily token was checked on 20 October 2026. The read-only quote endpoint returned HTTP 400 (InputException: Bad Request), so authenticated quote access remains unverified. The token has not been placed in source or deployed as a working connection.

Official alternatives are available in Data connections:

- **Kite Connect:** API key and access token obtained through the [official login flow](https://kite.trade/docs/connect/v3/user/). Live quote access needs the appropriate entitlement.
- **Groww Trading API:** access token from an enabled API account. See [Groww's documentation](https://groww.in/trade-api/docs/curl).

## Live data behavior

- Broker quotes are REST snapshots polled approximately every five seconds, not WebSocket tick streaming.
- Broker mode never replaces missing, rejected, or stale quotes with simulated prices. Chart lines contain only snapshots observed in that account while the app is open; synthetic history is shown only in Simulation.
- Market and limit fills require a fresh exchange timestamp during weekday NSE continuous-market hours, 09:15–15:30 IST. Old exchange timestamps also prevent holiday or stale-price fills. There is no separate holiday-calendar integration.
- A new execution quote is fetched before each submitted paper order. Up to ten open orders receive execution snapshots during polling.
- Limit orders execute only while the app is open and the quote passes freshness checks.
- Current index contract symbols, expiries, strikes, lot sizes, tick sizes and instrument tokens are loaded from broker instrument masters. The server caches public metadata in memory and, when available, the Worker Cache API. Concurrent downloads are combined.
- The first signed-in request each new IST calendar day refreshes the instrument file. If loaded before 08:30 IST, it refreshes again on the first request after 08:30, following Zerodha’s recommended download time. An open tab in Broker data mode checks automatically, including after sleep. This is request-driven; no background job runs while the app is closed. The F&O screen shows the file date and fetch time, even while the broker token needs updating. Manual refresh is also available.
- A failed daily refresh clears the selectable catalog, blocks new F&O orders and retries after one minute; yesterday’s metadata is never presented as today’s. Existing holdings and order history remain. Changed or removed contracts cancel affected pending paper orders. Incompatible position lot-size changes require review rather than rewriting units. Instrument-file last_price is never treated as a live quote.
- Supported F&O underlyings are NIFTY, BANKNIFTY, FINNIFTY and MIDCPNIFTY, where listed. Equity derivatives and physical settlement are outside this version.

## Paper accounting

- Equities support whole-share delivery buys and selling owned, unreserved shares.
- Index futures and options support long and short paper positions in whole broker-defined lots. Close-only orders reduce existing positions without reversing them.
- Futures do not debit full notional value. Their cash P&L is realized when closed. Option premiums, short-option liabilities, realized and unrealized P&L are accounted for in integer paise.
- Futures and short options reserve an illustrative **20% of notional** as paper margin. This is not exchange SPAN/exposure margin or an actual broker margin quote. There is no automatic daily futures settlement, liquidation or brokerage/tax calculation.
- Expired open orders are cancelled. Expired index positions require the user to enter the published final underlying settlement price using **Settle expiry**. The engine then cash-settles futures or option intrinsic value, including worthless options. It does not invent an official settlement price.
- Simulation and each broker provider have separate local paper accounts. Old simulation progress is preserved under its original storage key. Disconnecting a broker preserves its paper holdings.

## Credentials and storage

Broker tokens are validated server-side and stored in AES-GCM encrypted, HttpOnly, SameSite=Strict cookies bound to the signed-in Site visitor. HTTPS sessions also use Secure cookies. Tokens are not returned to client JavaScript, written to localStorage, included in exports, or logged. App sessions expire at 06:00 IST; a broker can invalidate its token sooner.

Production uses the secret `BROKER_SESSION_SECRET`, configured through Sites runtime environment variables. Never place a production secret in source or the hosting manifest. Local `.dev.vars` and `.env*` files are ignored.

Paper holdings, orders, chart samples and quotes remain in this browser and origin, without cross-device synchronization. Clearing browser data removes them. CSV export and explicit account reset are available in Settings.

## Development

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

For Vinext preview, open http://127.0.0.1:5173/signin-with-chatgpt?return_to=/terminal/index.html to establish the starter's local development identity. Set `BROKER_SESSION_SECRET` to a local development value in an ignored `.dev.vars` file.

`npm run preview:terminal` serves a faster standalone preview at http://127.0.0.1:3000. This loopback-only server uses a local identity and a development encryption key; hosted deployments use the Vinext routes and Sites visitor identity.

```sh
npm test
npm run build
```

`tests/browser-smoke.mjs` checks the existing simulation experience. `tests/browser-live.mjs` checks live-mode UI, F&O orders, provider isolation and failure handling using explicit broker fixtures and a test clock. These browser scripts use an isolated installed Chrome profile on Windows and are not live broker verification.

## Source

- `public/terminal/`: responsive trading UI, simulation, paper ledger and F&O engine.
- `lib/market/`: server-only broker adapters, streaming instrument parser, encrypted sessions and request authorization.
- `app/api/market/[action]/route.ts`: authenticated market-data endpoints.
- `build/`, `scripts/`, `vite.config.ts`: retained Sites/Vinext build and hosting integration.
- `tests/`: ledger, derivatives, API/session and browser checks.

The deployed Site keeps its original private audience. `.openai/hosting.json` retains the original project identity; the static publication was migrated to a Worker for server-side market-data requests.
