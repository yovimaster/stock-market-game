StockPlay — Investing Game · Handoff Notes
What it is

A browser investing game split across three static files (index.html, style.css, app.js). No server, no build step — open index.html in any browser. Virtual portfolio starting at $100,000 cash, trading 50 major US stocks.

File location

index.html / style.css / app.js live together in the project root. Originally a single stockplay_1.html; split into three files for editing ergonomics, still no build step.

Features implemented
Market tab: top 10 gainers / top 10 losers on load, search by symbol or name
Favorites tab: star any stock (Market, Favorites, or the detail panel) to watch it; stars persist via localStorage (sp_favorites_v1)
Stock detail panel (slide-in): live price, 52W range, volume, price chart with 1D/1W/1M/3M/1Y/YTD ranges (chart loaded on demand only)
Buy / Sell: quantity input, cash validation, average cost tracking
Portfolio tab: total value, cash, invested, P&L, holdings table with per-position P&L, transaction history (last 20), and a "Portfolio Value Over Time" chart (1W/1M/3M/1Y/ALL) built from a snapshot recorded on every load/trade/reset
Export Backup / Import Backup buttons (Portfolio tab): download the whole portfolio + favorites as a timestamped JSON file, or re-load one — the portable copy since localStorage is per-browser and invisible
Reset portfolio button
localStorage persistence — keys: sp_portfolio_v1 (cash/holdings/txs/history), sp_favorites_v1 (starred symbols)
Data status pill in header: 🟢 Live / 🟡 Partial / 📴 Demo
Data / API approach

Yahoo Finance v8/chart endpoint (not v7/quote — that now requires auth/crumb):

GET https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1d

Current price + % change extracted from the meta object in the response.

Five strategies raced concurrently via Promise.any, each with a 10s timeout so a dead one can't stall the race:

Direct (no proxy)
https://api.allorigins.win/raw?url= + encoded URL
https://corsproxy.io/?url= + encoded URL
https://api.codetabs.com/v1/proxy?quest= + encoded URL
https://thingproxy.freeboard.io/fetch/ + raw URL

Demo mode fallback: if all five fail for a stock, it gets a date-seeded simulated price (consistent within a day, varies daily). The header pill shows the data mode. Public CORS proxies are inherently flaky (outages, rate limits, rejecting the null origin a file:// page sends) — more independent candidates reduces but doesn't eliminate stocks falling through to demo mode.

Why not other APIs?
No free keyless alternative to Yahoo Finance for browser stock data exists (Stooq is historical only and also has CORS issues)
Finnhub (finnhub.io) is the best upgrade path if live data reliability becomes an issue — free tier (60 req/min), explicit CORS support, no credit card, no proxy needed for quotes. Note their free tier has restricted historical candle data in the past, so the price-history chart would likely still need a fallback. Would be a moderate change to add an optional API key input stored in localStorage.
Tech stack
Vanilla HTML/CSS/JS — no framework, no bundler, no Node project
Chart.js 4.4.1 from cdnjs (line charts for both price history and portfolio value over time)
Persistence considered and decided against
A real SQLite file was considered for cross-browser/cross-session persistence, but a static page can't write an arbitrary file to disk — that needs a local server. Decided to stay fully static and use the JSON export/import backup instead of adding a server + SQLite.
Potential next steps (not built yet)
Optional Finnhub API key input for more reliable live data
Fractional shares support
Order types (limit orders, stop-loss)
Multi-currency / crypto support