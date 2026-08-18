// ═══ CONFIG ════════════════════════════════════════════════
const START_CASH = 100_000;
const YF2       = 'https://query2.finance.yahoo.com';

const STOCKS = [
  ['AAPL','Apple Inc.'],['MSFT','Microsoft Corp.'],['GOOGL','Alphabet Inc.'],
  ['AMZN','Amazon.com Inc.'],['NVDA','NVIDIA Corp.'],['META','Meta Platforms'],
  ['TSLA','Tesla Inc.'],['BRK-B','Berkshire Hathaway'],['UNH','UnitedHealth Group'],
  ['JPM','JPMorgan Chase'],['V','Visa Inc.'],['XOM','Exxon Mobil'],
  ['MA','Mastercard Inc.'],['PG','Procter & Gamble'],['JNJ','Johnson & Johnson'],
  ['HD','Home Depot Inc.'],['CVX','Chevron Corp.'],['ABBV','AbbVie Inc.'],
  ['LLY','Eli Lilly & Co.'],['MRK','Merck & Co.'],['KO','Coca-Cola Co.'],
  ['PEP','PepsiCo Inc.'],['COST','Costco Wholesale'],['AVGO','Broadcom Inc.'],
  ['TMO','Thermo Fisher'],['WMT','Walmart Inc.'],['ACN','Accenture plc'],
  ['NKE','Nike Inc.'],['MCD',"McDonald's Corp."],['VZ','Verizon Comms'],
  ['ADBE','Adobe Inc.'],['DIS','Walt Disney Co.'],['TXN','Texas Instruments'],
  ['ORCL','Oracle Corp.'],['IBM','IBM Corp.'],['INTC','Intel Corp.'],
  ['AMD','Advanced Micro Devices'],['QCOM','Qualcomm Inc.'],['HON','Honeywell Intl'],
  ['CAT','Caterpillar Inc.'],['BA','Boeing Co.'],['GE','General Electric'],
  ['SBUX','Starbucks Corp.'],['NEE','NextEra Energy'],['RTX','Raytheon Tech'],
  ['PM','Philip Morris Intl'],['DHR','Danaher Corp.'],['UPS','United Parcel Service'],
  ['AMGN','Amgen Inc.'],['NFLX','Netflix Inc.'],
].map(([symbol, name]) => ({ symbol, name }));

const SYMBOL_MAP = Object.fromEntries(STOCKS.map(s => [s.symbol, s.name]));

const RANGES = {
  '1D':  { range: '1d',   interval: '5m' },
  '1W':  { range: '5d',   interval: '60m' },
  '1M':  { range: '1mo',  interval: '1d' },
  '3M':  { range: '3mo',  interval: '1d' },
  '1Y':  { range: '1y',   interval: '1wk' },
  'YTD': { range: 'ytd',  interval: '1d' },
};

// Windows for the portfolio-value-over-time chart (in days; Infinity = full history)
const PF_RANGES = { '1W': 7, '1M': 30, '3M': 90, '1Y': 365, 'ALL': Infinity };

// ═══ DEMO PRICES (fallback when APIs are unreachable) ════════
// Approximate mid-2025 prices — updated daily variation via seeded RNG
const DEMO_BASE = {
  AAPL:228, MSFT:423, GOOGL:185, AMZN:222, NVDA:132, META:605, TSLA:345,
  'BRK-B':455, UNH:530, JPM:248, V:318, XOM:112, MA:512, PG:175, JNJ:155,
  HD:415, CVX:155, ABBV:188, LLY:895, MRK:105, KO:68, PEP:152, COST:925,
  AVGO:195, TMO:555, WMT:92, ACN:302, NKE:72, MCD:298, VZ:42,
  ADBE:402, DIS:98, TXN:195, ORCL:165, IBM:225, INTC:23, AMD:112,
  QCOM:162, HON:228, CAT:378, BA:175, GE:195, SBUX:82, NEE:68,
  RTX:128, PM:132, DHR:218, UPS:105, AMGN:292, NFLX:985,
};

function getDemoQuote(symbol) {
  const base = DEMO_BASE[symbol] || 100;
  // Seed = symbol + today's date → consistent within a day, changes daily
  const seedStr = symbol + new Date().toDateString();
  let seed = [...seedStr].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 1337);
  const rng = () => {
    seed = (Math.imul(seed ^ seed >>> 15, 1 | seed) + Math.imul(seed ^ seed >>> 7, 61 | seed)) >>> 0;
    return seed / 4294967296;
  };
  const changePct = (rng() - 0.5) * 4;           // ±2% range
  const price     = +(base * (1 + changePct / 100)).toFixed(2);
  const change    = +(price - base).toFixed(2);
  return {
    symbol,
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: changePct,
    regularMarketPreviousClose: base,
    regularMarketVolume: Math.floor(rng() * 40e6) + 5e6,
    longName: SYMBOL_MAP[symbol],
    fiftyTwoWeekHigh: +(base * 1.30).toFixed(2),
    fiftyTwoWeekLow:  +(base * 0.72).toFixed(2),
    marketCap: null,
    _demo: true,
  };
}

// ═══ STATE ═════════════════════════════════════════════════
let quotes        = {};      // symbol → YF quote object
let chartCache     = {};      // `${symbol}_${range}` → parsed {labels, data}
let activeRange    = '1M';
let openSymbol     = null;
let tradeMode      = 'buy';
let activeChart    = null;    // stock-panel Chart.js instance
let portfolioChart = null;    // portfolio-value-over-time Chart.js instance
let pfRange        = 'ALL';
let portfolio      = loadPortfolio();
let favorites      = loadFavorites();

// ═══ PERSISTENCE ═══════════════════════════════════════════
function loadPortfolio() {
  try {
    const raw = localStorage.getItem('sp_portfolio_v1');
    if (raw) {
      const p = JSON.parse(raw);
      if (!Array.isArray(p.history)) p.history = [];
      return p;
    }
  } catch (_) {}
  return { cash: START_CASH, holdings: {}, txs: [], history: [] };
}

function savePortfolio() {
  try { localStorage.setItem('sp_portfolio_v1', JSON.stringify(portfolio)); } catch (_) {}
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem('sp_favorites_v1');
    if (raw) return new Set(JSON.parse(raw));
  } catch (_) {}
  return new Set();
}

function saveFavorites() {
  try { localStorage.setItem('sp_favorites_v1', JSON.stringify([...favorites])); } catch (_) {}
}

function isFavorite(symbol) { return favorites.has(symbol); }

// ═══ BACKUP (export/import — localStorage is per-browser, so this is the
// portable copy you can move between machines/browsers or keep as a safety net) ═
function exportBackup() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    portfolio,
    favorites: [...favorites],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `stockplay-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Backup downloaded', true);
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    e.target.value = '';
    let data;
    try {
      data = JSON.parse(reader.result);
      if (!data.portfolio || typeof data.portfolio.cash !== 'number' || typeof data.portfolio.holdings !== 'object') {
        throw new Error('unrecognized format');
      }
    } catch (err) {
      toast('Invalid backup file', false);
      return;
    }

    if (!confirm('Import this backup? It will overwrite your current portfolio and favorites.')) return;

    portfolio = {
      cash: data.portfolio.cash,
      holdings: data.portfolio.holdings ?? {},
      txs: Array.isArray(data.portfolio.txs) ? data.portfolio.txs : [],
      history: Array.isArray(data.portfolio.history) ? data.portfolio.history : [],
    };
    favorites = new Set(Array.isArray(data.favorites) ? data.favorites : []);

    savePortfolio();
    saveFavorites();
    refreshHeader();
    if (document.getElementById('tab-portfolio')?.classList.contains('active')) renderPortfolio();
    if (document.getElementById('tab-favorites')?.classList.contains('active')) renderFavorites();
    toast('Backup imported', true);
  };
  reader.readAsText(file);
}

// Snapshot current total value into history (call after any state-changing event)
function recordSnapshot() {
  portfolio.history.push({ t: new Date().toISOString(), v: totalValue() });
  if (portfolio.history.length > 2000) portfolio.history.splice(0, portfolio.history.length - 2000);
}

// ═══ API ════════════════════════════════════════════════════
// Race several proxy strategies concurrently — take the first to succeed.
// Public CORS proxies are individually flaky (rate limits, outages, or
// rejecting the null origin a file:// page sends), so more independent
// candidates means fewer stocks fall through to demo mode.
async function apiFetch(url) {
  const candidates = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    `https://thingproxy.freeboard.io/fetch/${url}`,
  ];
  const tryOne = async u => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const r = await fetch(u, { signal: controller.signal });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      // allorigins wraps in {contents} when served as /get (not /raw); handle both
      return j?.contents ? JSON.parse(j.contents) : j;
    } finally {
      clearTimeout(timer);
    }
  };
  return Promise.any(candidates.map(tryOne));
}

// Use v8/chart for a single-stock quote — more reliable than v7/quote
async function fetchStockQuote(symbol) {
  const url = `${YF2}/v8/finance/chart/${symbol}?range=1d&interval=1d&includePrePost=false`;
  const json = await apiFetch(url);
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error('no data');
  const price    = meta.regularMarketPrice;
  const prev     = meta.chartPreviousClose ?? meta.previousClose ?? price;
  const change   = +(price - prev).toFixed(4);
  const changePct = prev > 0 ? +((change / prev) * 100).toFixed(4) : 0;
  return {
    symbol,
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: changePct,
    regularMarketPreviousClose: prev,
    regularMarketVolume: meta.regularMarketVolume ?? 0,
    longName: meta.longName ?? SYMBOL_MAP[symbol] ?? symbol,
    shortName: meta.shortName ?? symbol,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow:  meta.fiftyTwoWeekLow  ?? null,
    marketCap: null,
  };
}

async function fetchChartData(symbol, range, interval) {
  const url = `${YF2}/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;
  const json = await apiFetch(url);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No chart data');

  const ts     = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  const pts = ts.map((t, i) => ({ t: new Date(t * 1000), v: closes[i] }))
               .filter(p => p.v != null && !isNaN(p.v));
  if (!pts.length) throw new Error('Empty chart');
  return pts;
}

// ═══ INIT ═══════════════════════════════════════════════════
async function init() {
  refreshHeader();
  setupSearch();
  await loadMarket();
}

async function loadMarket() {
  document.getElementById('market-body').innerHTML =
    '<div class="loader"><div class="spin"></div> Fetching market data…</div>';
  document.getElementById('err-box').innerHTML = '';
  setPill('⏳ Loading…', '#8b949e', '#30363d');

  // Fetch all stocks concurrently; each falls back to demo price on failure
  const results = await Promise.allSettled(
    STOCKS.map(s => fetchStockQuote(s.symbol))
  );

  let liveCount = 0;
  results.forEach((r, i) => {
    const sym = STOCKS[i].symbol;
    if (r.status === 'fulfilled') {
      quotes[sym] = r.value;
      liveCount++;
    } else {
      quotes[sym] = getDemoQuote(sym);  // always have a price
    }
  });

  if (liveCount === 0) {
    setPill('📴 Demo mode', '#e3b341', 'rgba(227,179,65,0.15)');
    document.getElementById('err-box').innerHTML =
      `<div class="err-bar">📴 Live data unreachable — showing simulated prices. Prices update daily and are consistent within a session. Your portfolio trades are still saved.</div>`;
  } else if (liveCount < STOCKS.length) {
    setPill(`🟡 Partial live (${liveCount}/${STOCKS.length})`, '#e3b341', 'rgba(227,179,65,0.15)');
  } else {
    setPill('🟢 Live data', '#3fb950', 'rgba(63,185,80,0.12)');
  }

  // Now that quotes are in, take a portfolio value snapshot for the history chart
  recordSnapshot();
  savePortfolio();

  renderMarket();
  if (document.getElementById('tab-favorites')?.classList.contains('active')) renderFavorites();
}

function setPill(text, color, bg) {
  const p = document.getElementById('data-pill');
  if (!p) return;
  p.textContent = text;
  p.style.color = color;
  p.style.background = bg;
  p.style.borderColor = color + '55';
}

// ═══ RENDER MARKET ══════════════════════════════════════════
function renderMarket() {
  const ranked = STOCKS
    .filter(s => quotes[s.symbol])
    .map(s => ({ ...s, q: quotes[s.symbol] }))
    .sort((a, b) => (b.q.regularMarketChangePercent ?? 0) - (a.q.regularMarketChangePercent ?? 0));

  if (!ranked.length) {
    document.getElementById('market-body').innerHTML =
      '<div class="loader" style="color:var(--muted)">No data available</div>';
    return;
  }

  const gainers = ranked.slice(0, 10);
  const losers  = [...ranked].reverse().slice(0, 10);

  document.getElementById('market-body').innerHTML = `
    <div class="market-grid">
      ${mkMCard('Top Gainers', 'dot-g', gainers)}
      ${mkMCard('Top Losers',  'dot-r', losers)}
    </div>`;
}

function mkMCard(title, dotCls, stocks) {
  return `
    <div class="mcard">
      <div class="mcard-head"><span class="dot ${dotCls}"></span>${title}</div>
      ${stocks.map(s => mkSRow(s)).join('')}
    </div>`;
}

function mkSRow({ symbol, name, q }) {
  const chg  = q.regularMarketChangePercent ?? 0;
  const pr   = q.regularMarketPrice ?? 0;
  const pos  = chg >= 0;
  const sign = pos ? '+' : '';
  return `
    <div class="srow" onclick="openStock('${symbol}')">
      ${starBtn(symbol)}
      <div>
        <div class="srow-sym">${symbol}</div>
        <div class="srow-name">${name}</div>
      </div>
      <div class="srow-price">$${pr.toFixed(2)}</div>
      <div class="badge ${pos ? 'badge-g' : 'badge-r'}">${sign}${chg.toFixed(2)}%</div>
    </div>`;
}

// ═══ FAVORITES ══════════════════════════════════════════════
function starBtn(symbol, size) {
  const fav = isFavorite(symbol);
  const style = size ? ` style="font-size:${size}px"` : '';
  return `<button class="star-btn ${fav ? 'on' : ''}" data-symbol="${symbol}"
            onclick="event.stopPropagation(); toggleFavorite('${symbol}')"
            title="${fav ? 'Remove from favorites' : 'Add to favorites'}"${style}>${fav ? '★' : '☆'}</button>`;
}

function toggleFavorite(symbol) {
  if (favorites.has(symbol)) favorites.delete(symbol);
  else favorites.add(symbol);
  saveFavorites();

  document.querySelectorAll(`.star-btn[data-symbol="${symbol}"]`).forEach(btn => {
    const fav = isFavorite(symbol);
    btn.classList.toggle('on', fav);
    btn.textContent = fav ? '★' : '☆';
    btn.title = fav ? 'Remove from favorites' : 'Add to favorites';
  });

  if (document.getElementById('tab-favorites')?.classList.contains('active')) renderFavorites();
}

function renderFavorites() {
  const body = document.getElementById('favorites-body');
  if (!body) return;

  const list = STOCKS
    .filter(s => favorites.has(s.symbol) && quotes[s.symbol])
    .map(s => ({ ...s, q: quotes[s.symbol] }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  if (!list.length) {
    body.innerHTML = `
      <div class="mcard">
        <div class="empty-state">
          <div class="empty-icon">⭐</div>
          <div>No favorites yet — click the star on any stock to watch it here</div>
        </div>
      </div>`;
    return;
  }

  body.innerHTML = `<div class="mcard">${list.map(s => mkSRow(s)).join('')}</div>`;
}

// ═══ SEARCH ═════════════════════════════════════════════════
function setupSearch() {
  const inp = document.getElementById('search');
  const dd  = document.getElementById('search-dd');

  inp.addEventListener('input', () => {
    const q = inp.value.trim().toUpperCase();
    if (!q) { dd.classList.remove('open'); return; }

    const matches = STOCKS.filter(s =>
      s.symbol.includes(q) || s.name.toUpperCase().includes(q)
    ).slice(0, 8);

    if (!matches.length) { dd.classList.remove('open'); return; }

    dd.innerHTML = matches.map(s => {
      const qt  = quotes[s.symbol];
      const pr  = qt?.regularMarketPrice;
      const chg = qt?.regularMarketChangePercent;
      const pos = (chg ?? 0) >= 0;
      return `
        <div class="sd-item" onclick="pickSearch('${s.symbol}')">
          <div>
            <div class="sd-sym">${s.symbol}</div>
            <div class="sd-name">${s.name}</div>
          </div>
          <div class="sd-right">
            <div class="sd-price">${pr != null ? '$' + pr.toFixed(2) : '—'}</div>
            <div class="sd-chg ${pos ? 'pos' : 'neg'}">${chg != null ? (pos ? '+' : '') + chg.toFixed(2) + '%' : '—'}</div>
          </div>
        </div>`;
    }).join('');
    dd.classList.add('open');
  });

  inp.addEventListener('blur', () =>
    setTimeout(() => dd.classList.remove('open'), 150));
}

function pickSearch(symbol) {
  document.getElementById('search').value = '';
  document.getElementById('search-dd').classList.remove('open');
  openStock(symbol);
}

// ═══ STOCK PANEL ════════════════════════════════════════════
async function openStock(symbol) {
  openSymbol = symbol;
  tradeMode  = 'buy';
  activeRange = '1M';

  document.getElementById('overlay').classList.add('open');
  document.getElementById('panel-inner').innerHTML = buildPanelShell(symbol);

  // Load chart right away
  await loadChart(symbol, activeRange);
}

function buildPanelShell(symbol) {
  const q    = quotes[symbol];
  const name = SYMBOL_MAP[symbol] || symbol;

  if (!q) {
    return `
      <div class="p-sym-row"><div class="p-sym">${symbol}</div>${starBtn(symbol, 20)}</div>
      <div class="p-name">${name}</div>
      <div class="chart-placeholder"><div class="spin"></div> Loading…</div>`;
  }

  const pr   = q.regularMarketPrice ?? 0;
  const chg  = q.regularMarketChangePercent ?? 0;
  const chgA = q.regularMarketChange ?? 0;
  const pos  = chg >= 0;

  const holding = portfolio.holdings[symbol];

  return `
    <div class="p-sym-row"><div class="p-sym">${symbol}</div>${starBtn(symbol, 20)}</div>
    <div class="p-name">${q.longName || q.shortName || name}</div>

    <div class="p-price-row">
      <div class="p-price">$${pr.toFixed(2)}</div>
      <div class="p-badge ${pos ? 'badge-g' : 'badge-r'}">
        ${chgA >= 0 ? '+' : ''}$${Math.abs(chgA).toFixed(2)} (${pos ? '+' : ''}${chg.toFixed(2)}%)
      </div>
    </div>

    <div class="time-row" id="time-row">
      ${Object.keys(RANGES).map(r =>
        `<button class="t-btn ${r === activeRange ? 'active' : ''}" onclick="changeRange('${r}')">${r}</button>`
      ).join('')}
    </div>

    <div id="chart-area">
      <div class="chart-placeholder"><div class="spin"></div></div>
    </div>

    <div class="info-grid">
      <div class="igrid-item">
        <div class="igrid-label">Prev Close</div>
        <div class="igrid-val">$${(q.regularMarketPreviousClose ?? 0).toFixed(2)}</div>
      </div>
      <div class="igrid-item">
        <div class="igrid-label">Volume</div>
        <div class="igrid-val">${fmtBig(q.regularMarketVolume)}</div>
      </div>
      <div class="igrid-item">
        <div class="igrid-label">52W High</div>
        <div class="igrid-val">$${(q.fiftyTwoWeekHigh ?? 0).toFixed(2)}</div>
      </div>
      <div class="igrid-item">
        <div class="igrid-label">52W Low</div>
        <div class="igrid-val">$${(q.fiftyTwoWeekLow ?? 0).toFixed(2)}</div>
      </div>
      <div class="igrid-item">
        <div class="igrid-label">Mkt Cap</div>
        <div class="igrid-val">${fmtCap(q.marketCap)}</div>
      </div>
      <div class="igrid-item">
        <div class="igrid-label">Your Shares</div>
        <div class="igrid-val" id="owned-shares">${holding?.shares ?? 0}</div>
      </div>
    </div>

    <div class="trade-box">
      <div class="trade-tabs">
        <button class="tr-tab buy active" id="tab-buy"  onclick="switchTrade('buy')">Buy</button>
        <button class="tr-tab sell"       id="tab-sell" onclick="switchTrade('sell')">Sell</button>
      </div>
      <div id="trade-form">${buildTradeForm(symbol, 'buy')}</div>
    </div>`;
}

function buildTradeForm(symbol, mode) {
  const q     = quotes[symbol];
  const pr    = q?.regularMarketPrice ?? 0;
  const h     = portfolio.holdings[symbol];
  const maxQ  = mode === 'buy' ? Math.floor(portfolio.cash / (pr || 1)) : (h?.shares ?? 0);
  const label = mode === 'buy' ? 'Max affordable: ' : 'Owned: ';

  return `
    <div class="tfield">
      <div class="tfield-label">
        <span>Shares</span>
        <span>${label}${maxQ}</span>
      </div>
      <input id="qty" class="t-input" type="number" min="1" max="${maxQ}" placeholder="0"
             oninput="updateSummary('${symbol}','${mode}')">
    </div>
    <div class="trade-row"><span>Est. Total</span><span id="est-total">$0.00</span></div>
    <div class="trade-row"><span>Cash After</span><span id="cash-after">${fmtUSD(portfolio.cash)}</span></div>
    <button id="exec-btn" class="btn-action btn-${mode}" onclick="execTrade('${symbol}','${mode}')">
      ${mode === 'buy' ? 'Buy' : 'Sell'} ${symbol}
    </button>`;
}

function updateSummary(symbol, mode) {
  const qty  = parseInt(document.getElementById('qty')?.value) || 0;
  const pr   = quotes[symbol]?.regularMarketPrice ?? 0;
  const tot  = qty * pr;
  const after = mode === 'buy' ? portfolio.cash - tot : portfolio.cash + tot;

  const estEl   = document.getElementById('est-total');
  const afterEl = document.getElementById('cash-after');
  if (estEl)   estEl.textContent   = fmtUSD(tot);
  if (afterEl) {
    afterEl.textContent  = fmtUSD(after);
    afterEl.style.color  = after < 0 ? 'var(--red)' : 'var(--text)';
  }
}

function switchTrade(mode) {
  tradeMode = mode;
  document.getElementById('tab-buy').classList.toggle('active',  mode === 'buy');
  document.getElementById('tab-sell').classList.toggle('active', mode === 'sell');
  document.getElementById('trade-form').innerHTML = buildTradeForm(openSymbol, mode);
}

// ═══ CHART (stock detail panel) ═══════════════════════════════
async function changeRange(r) {
  activeRange = r;
  document.querySelectorAll('.t-btn').forEach(b => b.classList.toggle('active', b.textContent === r));
  document.getElementById('chart-area').innerHTML =
    '<div class="chart-placeholder"><div class="spin"></div></div>';
  await loadChart(openSymbol, r);
}

async function loadChart(symbol, range) {
  const key = `${symbol}_${range}`;

  if (!chartCache[key]) {
    try {
      const { range: r, interval } = RANGES[range];
      chartCache[key] = await fetchChartData(symbol, r, interval);
    } catch (e) {
      document.getElementById('chart-area').innerHTML =
        '<div class="chart-placeholder" style="color:var(--muted)">Chart unavailable</div>';
      return;
    }
  }

  drawChart(chartCache[key], range);
}

function drawChart(pts, range) {
  const el = document.getElementById('chart-area');
  if (!el) return;

  if (activeChart) { activeChart.destroy(); activeChart = null; }

  el.innerHTML = '<div class="chart-wrap"><canvas id="the-chart"></canvas></div>';
  const canvas = document.getElementById('the-chart');
  if (!canvas) return;

  const first = pts[0].v;
  const last  = pts[pts.length - 1].v;
  const up    = last >= first;
  const line  = up ? '#3fb950' : '#f85149';
  const fill  = up ? 'rgba(63,185,80,0.06)' : 'rgba(248,81,73,0.06)';

  // Labels — thin them out for readability
  const labels = pts.map(p => fmtChartLabel(p.t, range));
  const data   = pts.map(p => p.v);

  activeChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: line,
        borderWidth: 1.5,
        backgroundColor: fill,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHoverBackgroundColor: line,
        tension: 0.15,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          titleFont: { size: 11 },
          bodyFont: { size: 13, weight: '600' },
          callbacks: {
            title: items => fmtChartLabel(pts[items[0].dataIndex].t, range, true),
            label: item  => ' $' + item.raw.toFixed(2),
          }
        }
      },
      scales: {
        x: {
          border: { display: false },
          grid:   { color: 'rgba(48,54,61,0.35)' },
          ticks:  {
            color: '#8b949e',
            font:  { size: 10 },
            maxTicksLimit: 6,
            maxRotation: 0,
          }
        },
        y: {
          position: 'right',
          border:   { display: false },
          grid:     { color: 'rgba(48,54,61,0.35)' },
          ticks:    {
            color: '#8b949e',
            font:  { size: 10 },
            callback: v => '$' + v.toFixed(0),
          }
        }
      }
    }
  });
}

function fmtChartLabel(d, range, full = false) {
  if (range === '1D')
    return full
      ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (range === '1Y' || range === 'YTD')
    return full
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  return full
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ═══ TRADING ════════════════════════════════════════════════
function execTrade(symbol, mode) {
  const qty = parseInt(document.getElementById('qty')?.value);
  if (!qty || qty <= 0) { toast('Enter a share quantity', false); return; }

  const q  = quotes[symbol];
  const pr = q?.regularMarketPrice;
  if (!pr) { toast('Price unavailable', false); return; }

  const tot = qty * pr;

  if (mode === 'buy') {
    if (tot > portfolio.cash) { toast('Insufficient cash', false); return; }
    portfolio.cash -= tot;
    const h = portfolio.holdings[symbol] ??= { shares: 0, avgCost: 0 };
    const prevTotal = h.shares * h.avgCost;
    h.shares   += qty;
    h.avgCost   = (prevTotal + tot) / h.shares;
    portfolio.txs.push({ type: 'buy', symbol, shares: qty, price: pr, total: tot, date: new Date().toISOString() });
    toast(`Bought ${qty} × ${symbol} @ $${pr.toFixed(2)}`, true);
  } else {
    const h = portfolio.holdings[symbol];
    if (!h || h.shares < qty) { toast(`Only ${h?.shares ?? 0} shares owned`, false); return; }
    portfolio.cash += tot;
    h.shares -= qty;
    if (h.shares === 0) delete portfolio.holdings[symbol];
    portfolio.txs.push({ type: 'sell', symbol, shares: qty, price: pr, total: tot, date: new Date().toISOString() });
    toast(`Sold ${qty} × ${symbol} @ $${pr.toFixed(2)}`, true);
  }

  recordSnapshot();
  savePortfolio();
  refreshHeader();

  // Refresh form + owned-shares
  document.getElementById('trade-form').innerHTML = buildTradeForm(symbol, mode);
  const os = document.getElementById('owned-shares');
  if (os) os.textContent = portfolio.holdings[symbol]?.shares ?? 0;

  // If the portfolio tab is open behind the panel, keep its chart/holdings in sync
  if (document.getElementById('tab-portfolio')?.classList.contains('active')) renderPortfolio();
}

// ═══ PORTFOLIO VALUE CHART ═══════════════════════════════════
function filterHistory(range) {
  const days = PF_RANGES[range];
  if (!Number.isFinite(days)) return portfolio.history;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return portfolio.history.filter(p => new Date(p.t).getTime() >= cutoff);
}

function changePfRange(r) {
  pfRange = r;
  document.querySelectorAll('#pf-time-row .t-btn').forEach(b => b.classList.toggle('active', b.textContent === r));
  drawPortfolioChart();
}

function drawPortfolioChart() {
  const el = document.getElementById('pf-chart-area');
  if (!el) return;

  if (portfolioChart) { portfolioChart.destroy(); portfolioChart = null; }

  const pts = filterHistory(pfRange);
  if (pts.length < 2) {
    el.innerHTML = '<div class="chart-placeholder" style="color:var(--muted)">Not enough history yet — check back after a few trades or sessions</div>';
    return;
  }

  el.innerHTML = '<div class="chart-wrap" style="height:220px"><canvas id="pf-chart"></canvas></div>';
  const canvas = document.getElementById('pf-chart');
  if (!canvas) return;

  const first = pts[0].v;
  const last  = pts[pts.length - 1].v;
  const up    = last >= first;
  const line  = up ? '#3fb950' : '#f85149';
  const fill  = up ? 'rgba(63,185,80,0.06)' : 'rgba(248,81,73,0.06)';

  const labels = pts.map(p => fmtPfLabel(new Date(p.t)));
  const data   = pts.map(p => p.v);

  portfolioChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: line,
        borderWidth: 1.5,
        backgroundColor: fill,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHoverBackgroundColor: line,
        tension: 0.15,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          titleFont: { size: 11 },
          bodyFont: { size: 13, weight: '600' },
          callbacks: {
            title: items => new Date(pts[items[0].dataIndex].t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            label: item  => ' ' + fmtUSD(item.raw),
          }
        }
      },
      scales: {
        x: {
          border: { display: false },
          grid:   { color: 'rgba(48,54,61,0.35)' },
          ticks:  { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 6, maxRotation: 0 }
        },
        y: {
          position: 'right',
          border: { display: false },
          grid:   { color: 'rgba(48,54,61,0.35)' },
          ticks:  { color: '#8b949e', font: { size: 10 }, callback: v => '$' + Math.round(v).toLocaleString('en-US') }
        }
      }
    }
  });
}

function fmtPfLabel(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ═══ PORTFOLIO RENDER ═══════════════════════════════════════
function renderPortfolio() {
  const totVal  = totalValue();
  const pnl     = totVal - START_CASH;
  const pnlPct  = (pnl / START_CASH * 100).toFixed(2);
  const invested = totVal - portfolio.cash;

  document.getElementById('p-stats').innerHTML = `
    <div class="pstat-card">
      <div class="hstat-label">Total Value</div>
      <div class="hstat-value">${fmtUSD(totVal)}</div>
    </div>
    <div class="pstat-card">
      <div class="hstat-label">Cash</div>
      <div class="hstat-value">${fmtUSD(portfolio.cash)}</div>
    </div>
    <div class="pstat-card">
      <div class="hstat-label">Invested</div>
      <div class="hstat-value">${fmtUSD(invested)}</div>
    </div>
    <div class="pstat-card">
      <div class="hstat-label">Total P&L</div>
      <div class="hstat-value ${pnl >= 0 ? 'pos' : 'neg'}">
        ${pnl >= 0 ? '+' : ''}${fmtUSD(pnl)}<br>
        <span style="font-size:12px">(${pnl >= 0 ? '+' : ''}${pnlPct}%)</span>
      </div>
    </div>`;

  document.getElementById('p-chart').innerHTML = `
    <div class="chart-card">
      <div class="card-head">
        <span>Portfolio Value Over Time</span>
        <div class="time-row" id="pf-time-row" style="margin:0">
          ${Object.keys(PF_RANGES).map(r =>
            `<button class="t-btn ${r === pfRange ? 'active' : ''}" onclick="changePfRange('${r}')">${r}</button>`
          ).join('')}
        </div>
      </div>
      <div id="pf-chart-area" style="height:220px;padding:14px 18px">
        <div class="chart-wrap" style="height:220px"><canvas id="pf-chart"></canvas></div>
      </div>
    </div>`;
  drawPortfolioChart();

  const entries = Object.entries(portfolio.holdings);
  const hEl = document.getElementById('p-holdings');

  if (!entries.length) {
    hEl.innerHTML = `
      <div class="holdings-card">
        <div class="card-head">Holdings</div>
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <div>No holdings yet — head to the Market tab to start</div>
        </div>
      </div>`;
  } else {
    hEl.innerHTML = `
      <div class="holdings-card">
        <div class="card-head">
          <span>Holdings (${entries.length})</span>
          <button class="btn-reset" onclick="confirmReset()">Reset Portfolio</button>
        </div>
        <div class="htable-head">
          <div>Symbol</div>
          <div class="tr">Shares</div>
          <div class="tr">Avg Cost</div>
          <div class="tr">Value / P&L</div>
        </div>
        ${entries.map(([sym, h]) => {
          const pr  = quotes[sym]?.regularMarketPrice ?? h.avgCost;
          const mv  = h.shares * pr;
          const cost = h.shares * h.avgCost;
          const pl  = mv - cost;
          const plP = (pl / cost * 100).toFixed(2);
          return `
            <div class="hrow" onclick="openStock('${sym}')">
              <div>
                <div style="font-weight:700">${sym}</div>
                <div style="font-size:11px;color:var(--muted)">${SYMBOL_MAP[sym] || sym}</div>
              </div>
              <div class="tr">${h.shares}</div>
              <div class="tr">$${h.avgCost.toFixed(2)}</div>
              <div class="tr">
                <div>${fmtUSD(mv)}</div>
                <div class="${pl >= 0 ? 'pos' : 'neg'}" style="font-size:11px">
                  ${pl >= 0 ? '+' : ''}${fmtUSD(pl)} (${pl >= 0 ? '+' : ''}${plP}%)
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  // Transactions
  const txEl = document.getElementById('p-tx');
  const recent = [...portfolio.txs].reverse().slice(0, 20);
  if (recent.length) {
    txEl.innerHTML = `
      <div class="tx-card">
        <div class="card-head">Recent Transactions</div>
        ${recent.map(tx => `
          <div class="tx-row">
            <span class="tx-type ${tx.type === 'buy' ? 'tx-b' : 'tx-s'}">${tx.type}</span>
            <span style="font-weight:600">${tx.symbol}</span>
            <span class="tx-muted">${tx.shares} sh @ $${tx.price.toFixed(2)}</span>
            <span style="font-weight:600;font-variant-numeric:tabular-nums">${fmtUSD(tx.total)}</span>
            <span class="tx-muted">${fmtDate(tx.date)}</span>
          </div>`).join('')}
      </div>`;
  } else {
    txEl.innerHTML = '';
  }
}

// ═══ MISC UI ════════════════════════════════════════════════
function showTab(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.querySelector(`[onclick="showTab('${name}')"]`).classList.add('active');
  if (name === 'portfolio') renderPortfolio();
  if (name === 'favorites') renderFavorites();
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('overlay')) closePanel();
}

function closePanel() {
  document.getElementById('overlay').classList.remove('open');
  if (activeChart) { activeChart.destroy(); activeChart = null; }
  openSymbol = null;
}

function refreshHeader() {
  const tot = totalValue();
  const pnl = tot - START_CASH;
  document.getElementById('h-cash').textContent  = fmtUSD(portfolio.cash);
  document.getElementById('h-total').textContent = fmtUSD(tot);
  const pnlEl = document.getElementById('h-pnl');
  pnlEl.textContent = (pnl >= 0 ? '+' : '') + fmtUSD(pnl);
  pnlEl.className   = 'hstat-value ' + (pnl >= 0 ? 'pos' : 'neg');
}

function totalValue() {
  let v = portfolio.cash;
  for (const [sym, h] of Object.entries(portfolio.holdings))
    v += h.shares * (quotes[sym]?.regularMarketPrice ?? h.avgCost);
  return v;
}

function confirmReset() {
  if (!confirm('Reset your entire portfolio back to $100,000? This cannot be undone.')) return;
  portfolio = { cash: START_CASH, holdings: {}, txs: [], history: [] };
  recordSnapshot();
  savePortfolio();
  refreshHeader();
  renderPortfolio();
  toast('Portfolio reset — $100,000 cash ready', true);
}

function toast(msg, ok) {
  const c  = document.getElementById('toasts');
  const el = Object.assign(document.createElement('div'), {
    className: `toast ${ok ? 'ok' : 'err'}`,
    innerHTML: `${ok ? '✓' : '✗'} ${msg}`,
  });
  c.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ═══ FORMAT HELPERS ═════════════════════════════════════════
function fmtUSD(n) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBig(n) {
  if (!n) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function fmtCap(n) {
  if (!n) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(1)  + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(1)  + 'M';
  return '$' + n;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ═══ KICK OFF ════════════════════════════════════════════════
init();
