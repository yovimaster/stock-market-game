StockPlay — Investing Game · Handoff Notes
What it is

A single-file browser investing game (stockplay.html). No server, no build step — open in any browser. Virtual portfolio starting at $100,000 cash, trading 50 major US stocks.

File location

The deliverable is stockplay.html. The user has downloaded it locally. There is no repo yet.

Features implemented
Market tab: top 10 gainers / top 10 losers on load, search by symbol or name
Stock detail panel (slide-in): live price, 52W range, volume, price chart with 1D/1W/1M/3M/1Y/YTD ranges (chart loaded on demand only)
Buy / Sell: quantity input, cash validation, average cost tracking
Portfolio tab: total value, cash, invested, P&L, holdings table with per-position P&L, transaction history (last 20)
Reset portfolio button
localStorage persistence — key: sp_portfolio_v1
Data status pill in header: 🟢 Live / 🟡 Partial / 📴 Demo
Data / API approach

Yahoo Finance v8/chart endpoint (not v7/quote — that now requires auth/crumb):

GET https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1d

Current price + % change extracted from the meta object in the response.

Three CORS proxies raced concurrently via Promise.any:

Direct (no proxy)
https://corsproxy.io/?url= + encoded URL
https://api.allorigins.win/raw?url= + encoded URL

Demo mode fallback: if all proxies fail for a stock, it gets a date-seeded simulated price (consistent within a day, varies daily). The header pill shows the data mode.

Why not other APIs?
No free keyless alternative to Yahoo Finance for browser stock data exists (Stooq is historical only and also has CORS issues)
Finnhub (finnhub.io) is the best upgrade path if live data reliability becomes an issue — free tier (60 req/min), explicit CORS support, no credit card. Would be a ~20-line change to add an optional API key input stored in localStorage.
Tech stack
Vanilla HTML/CSS/JS — no framework, no bundler
Chart.js 4.4.1 from cdnjs (line charts for price history)
All CSS and JS inline in the single file
Potential next steps (not built yet)
Optional Finnhub API key input for more reliable live data
Fractional shares support
Portfolio performance chart over time
Watchlist / favorites
Order types (limit orders, stop-loss)
Multi-currency / crypto support