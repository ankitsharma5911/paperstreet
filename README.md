# Paperstreet

A responsive paper trading web app for Indian stocks. Start with ₹10,00,000 in virtual funds, explore 16 NSE companies, place market and limit orders, manage a watchlist, and follow portfolio returns.

## Run locally

Requires Node.js 20 or newer. No dependencies or API keys are needed.

```sh
npm start
```

Open http://127.0.0.1:3000. Run the trading engine checks with `npm test`.

## Behavior

- Prices, chart history, benchmarks, and volumes are simulated. This app has no live NSE data connection.
- Market orders fill at the current simulated quote. Marketable limit orders also fill immediately; other limits wait for a matching quote.
- Open buy orders reserve cash. Open sell orders reserve shares. Cancelling releases the reservation.
- Whole shares, long positions, delivery trades only. No short selling, margin, fees, taxes, or exchange-hours enforcement.
- The simulator advances every three seconds while a tab is open. Orders have no expiry and do not execute with the app closed.
- Cash and cost basis use integer paise. Portfolio returns include realized and unrealized profit or loss.
- Data stays in localStorage on the current browser and origin. It is not a server-backed account and does not sync between devices. Browser Web Locks coordinate account writes across tabs where supported.
- Export order history from the header or Settings. Resetting requires typing RESET and clears the local practice account.

## Files

`dist/` contains the deployable static app. `dist/engine.js` is the independent ledger and order matching module. `dist/app.js` implements routing, charts, forms, simulation, and persistence. `server.mjs` serves local previews. Tests use Node’s built-in test runner.

The app works without external JavaScript dependencies. Google Fonts is optional; system fonts are used if it cannot load.
