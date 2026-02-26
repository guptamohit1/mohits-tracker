/**
 * AurumTrack v2 — Main Application Logic
 * Features:
 *  - GC=F (Gold), SI=F (Silver), USDINR=X, GOLDBEES.NS, SILVERBEES.NS
 *  - INR per gram = (USDprice × USDINR) ÷ 28.3 (oz to grams)
 *    NOTE: Conversion factor is set to 28.3g per ounce as requested by user.
 *  - 1D percentage = (current − chartPreviousClose) / chartPreviousClose × 100
 *  - MCX Gold/Silver Mini derived = same as INR/gram formula
 *  - 30s auto-refresh + live IST clock + countdown
 *  - 15:30 IST anchor for gap prediction
 */

'use strict';

/* ══════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════ */
const CFG = {
    API: 'https://query1.finance.yahoo.com/v8/finance/chart/',
    TV_API: 'https://scanner.tradingview.com/',
    PROXIES: [
        { url: 'https://api.allorigins.win/get?url=', wraps: true },
        { url: 'https://corsproxy.io/?', wraps: false }
    ],
    INTERVAL: 5000,    // 5 seconds — more aggressive for live feel
    GRAMS_PER_OZ: 28.3 // oz → grams (User requested 28.3)
};

/* ══════════════════════════════════════════════
   STATE
══════════════════════════════════════════════ */
const S = {
    firstLoad: true, // Track if it's the first render for instant load
    source: 'tradingview',
    xau: { cur: 0, prev: 0, anchor1530: 0 },
    xag: { cur: 0, prev: 0, anchor1530: 0 },
    usdinr: { cur: 0, prev: 0 },
    goldBees: { cur: 0, prev: 0 },
    silverBees: { cur: 0, prev: 0 },
    xauM: { cur: 0, prev: 0 },
    xagM: { cur: 0, prev: 0 }
};

/* ══════════════════════════════════════════════
   DOM CACHE
══════════════════════════════════════════════ */
const EL = {
    // Live bar
    clock: document.getElementById('live-clock'),
    countdown: document.getElementById('countdown'),
    lastUpdated: document.getElementById('last-updated-time'),
    nseStatus: document.getElementById('nse-status'),

    // Gold USD
    xauPrice: document.getElementById('xau-price'),
    xauChangeRow: document.getElementById('xau-change-row'),
    xauChange: document.getElementById('xau-change'),
    xauPct: document.getElementById('xau-pct'),
    xauInrGram: document.getElementById('xau-inr-gram'),

    // Silver USD
    xagPrice: document.getElementById('xag-price'),
    xagChangeRow: document.getElementById('xag-change-row'),
    xagChange: document.getElementById('xag-change'),
    xagPct: document.getElementById('xag-pct'),
    xagInrGram: document.getElementById('xag-inr-gram'),

    // USD/INR
    usdinrPrice: document.getElementById('usdinr-price'),
    usdinrChangeRow: document.getElementById('usdinr-change-row'),
    usdinrChange: document.getElementById('usdinr-change'),
    usdinrPct: document.getElementById('usdinr-pct'),

    // Gold BeES
    gbPrice: document.getElementById('goldbees-price'),
    gbChangeRow: document.getElementById('goldbees-change-row'),
    gbChange: document.getElementById('goldbees-change'),
    gbPct: document.getElementById('goldbees-pct'),

    // Silver BeES
    sbPrice: document.getElementById('silverbees-price'),
    sbChangeRow: document.getElementById('silverbees-change-row'),
    sbChange: document.getElementById('silverbees-change'),
    sbPct: document.getElementById('silverbees-pct'),

    silverBeesPct: document.getElementById('silverbees-pct'),

    // Gap prediction - Gold
    expGold: document.getElementById('expected-goldbees'),
    goldAnchor: document.getElementById('gold-anchor'),
    goldNow: document.getElementById('gold-now'),
    goldGapPct: document.getElementById('gold-gap-pct'),

    // Gap prediction - Silver
    expSilver: document.getElementById('expected-silverbees'),
    silverAnchor: document.getElementById('silver-anchor'),
    silverNow: document.getElementById('silver-now'),
    silverGapPct: document.getElementById('silver-gap-pct'),
    goldGapCard: document.getElementById('gold-gap-card'),
    silverGapCard: document.getElementById('silver-gap-card'),

    // Theme
    html: document.documentElement,
    themeIcon: document.getElementById('theme-icon'),
    themeBtn: document.getElementById('theme-toggle'),

    // MCX
    xaumPrice: document.getElementById('xaum-price'),
    xaumChangeRow: document.getElementById('xaum-change-row'),
    xaumChange: document.getElementById('xaum-change'),
    xaumPct: document.getElementById('xaum-pct'),
    xagmPrice: document.getElementById('xagm-price'),
    xagmChangeRow: document.getElementById('xagm-change-row'),
    xagmChange: document.getElementById('xagm-change'),
    xagmPct: document.getElementById('xagm-pct')
};

/* ══════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════ */
function fmt(n, dec = 2) {
    if (!n && n !== 0) return '——';
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec
    }).format(n);
}

function fmtInrGram(n) {
    if (!n && n !== 0) return '——';
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(n);
}

function istNow() {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utcMs + 5.5 * 3600 * 1000);
}

function istString(d) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

/**
 * Returns true if NSE market is currently in session (09:15 - 15:30 IST, Mon-Fri).
 */
function isNseOpen() {
    const ist = istNow();
    const d = ist.getDay();
    const min = ist.getHours() * 60 + ist.getMinutes();
    return (d >= 1 && d <= 5) && (min >= 555 && min < 930); // 555m = 09:15, 930m = 15:30
}


/* ══════════════════════════════════════════════
   THEME
══════════════════════════════════════════════ */
function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    applyTheme(saved);

    EL.themeBtn.addEventListener('click', () => {
        const next = EL.html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        localStorage.setItem('theme', next);
    });
}

function applyTheme(theme) {
    EL.html.setAttribute('data-theme', theme);
    EL.themeIcon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
}

/* ══════════════════════════════════════════════
   LIVE CLOCK
══════════════════════════════════════════════ */
function startLiveClock() {
    function tick() {
        const ist = istNow();
        EL.clock.textContent = istString(ist) + ' IST';
        updateNseStatus(ist);
    }
    tick();
    setInterval(tick, 1000);
}

function updateNseStatus(ist) {
    const d = ist.getDay();
    const min = ist.getHours() * 60 + ist.getMinutes();
    let txt, cls;

    if (d === 0 || d === 6) { txt = 'NSE: Weekend'; cls = 'closed'; }
    else if (min < 540) { txt = 'NSE: Closed'; cls = 'closed'; }
    else if (min < 555) { txt = 'NSE: Pre-open ⏰'; cls = 'pre'; }
    else if (min < 930) { txt = 'NSE: Open 🟢'; cls = 'open'; }
    else { txt = 'NSE: Closed'; cls = 'closed'; }

    EL.nseStatus.textContent = txt;
    EL.nseStatus.className = cls;

    // Update live dots based on market status
    updateLiveDots(min, d);
}

/**
 * Sets pulsing green/red dots on each section label.
 * - International (TVC:GOLD/SILVER): 24/5 — Mon-Fri roughly 00:00-23:00 UTC
 * - MCX: Mon-Fri 09:00-23:30 IST (210-1410 min IST)
 * - NSE BeES + Prediction: Mon-Fri 09:15-15:30 IST (555-930 min)
 */
function updateLiveDots(minIST, dayOfWeek) {
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    function setDot(id, isActive) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('active', isActive);
        el.classList.toggle('inactive', !isActive);
    }

    // International gold/silver (COMEX/TVC) — continuous Mon-Fri
    setDot('dot-international', isWeekday);

    // MCX: Mon–Fri 09:00–23:30 IST
    const mcxOpen = isWeekday && minIST >= 540 && minIST < 1410;
    setDot('dot-mcx', mcxOpen);

    // NSE BeES: Mon–Fri 09:15–15:30 IST
    const nseOpen = isWeekday && minIST >= 555 && minIST < 930;
    setDot('dot-bees', nseOpen);

    // Prediction: active after market close (data is meaningful after 15:30)
    const predActive = isWeekday && minIST >= 930;
    setDot('dot-prediction', predActive);
}

/* ══════════════════════════════════════════════
   COUNTDOWN
══════════════════════════════════════════════ */
let cd = CFG.INTERVAL / 1000;
function startCountdown() {
    cd = CFG.INTERVAL / 1000;
    setInterval(() => {
        cd = Math.max(0, cd - 1);
        EL.countdown.textContent = cd;
    }, 1000);
}
function resetCountdown() {
    cd = CFG.INTERVAL / 1000;
    EL.countdown.textContent = cd;
}

/* ══════════════════════════════════════════════
   FETCH
══════════════════════════════════════════════ */
async function fetchYahoo(symbol, interval = '5m', range = '5d') {
    // Add cache-buster to URL
    const url = `${CFG.API}${symbol}?interval=${interval}&range=${range}&_=${Date.now()}`;

    // Try direct
    try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('status ' + r.status);
        const d = await r.json();
        if (d.chart?.result?.[0]) return d.chart.result[0];
        throw new Error('no result');
    } catch (e) { /* silent */ }

    // Try proxies with cache busting
    for (const p of CFG.PROXIES) {
        try {
            const proxyUrl = p.url + encodeURIComponent(url);
            const r = await fetch(proxyUrl, { cache: 'no-store' });
            if (!r.ok) throw new Error('status ' + r.status);
            let d;
            if (p.wraps) {
                const w = await r.json();
                d = JSON.parse(w.contents);
            } else {
                d = await r.json();
            }
            if (d.chart?.result?.[0]) return d.chart.result[0];
        } catch (e) { /* try next */ }
    }

    console.error('[AurumTrack] All Yahoo fetches failed for', symbol);
    return null;
}

async function fetchTradingView(market, tickers) {
    const url = `${CFG.TV_API}${market}/scan`;
    const body = {
        symbols: { tickers },
        columns: ["close", "change", "change_abs", "name"]
    };

    try {
        const r = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error('TV status ' + r.status);
        return await r.json();
    } catch (e) {
        console.error(`[AurumTrack] TradingView fetch failed for ${market}:`, e);
        return null;
    }
}

/* ══════════════════════════════════════════════
   DATA PROCESSING
══════════════════════════════════════════════ */
function lastValid(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null && arr[i] !== undefined && !isNaN(arr[i])) return arr[i];
    }
    return null;
}

/**
 * Find the price closest to 15:30 IST (10:00 UTC) from the 5-min chart data.
 * Scans within ±15 minutes of 10:00 UTC, returns the closest valid close.
 */
function findAnchor1530(timestamps, closes) {
    const TARGET_UTC = 10 * 60; // 10:00 UTC = 15:30 IST
    let bestIdx = -1;
    let minDiff = 30; // Max 30 min window

    // Iterate through timestamps to find the closest candle to 10:00 UTC
    // We look for the most recent one (last day available)
    for (let i = timestamps.length - 1; i >= 0; i--) {
        if (closes[i] === null || closes[i] === undefined) continue;
        const d = new Date(timestamps[i] * 1000);
        const candleMin = d.getUTCHours() * 60 + d.getUTCMinutes();
        const diff = Math.abs(candleMin - TARGET_UTC);

        if (diff <= 5) { // Prioritize exact or near-exact matches (within 5 mins)
            return closes[i];
        }

        if (diff < minDiff) {
            minDiff = diff;
            bestIdx = i;
        }
    }
    return bestIdx !== -1 ? closes[bestIdx] : null;
}

function processUSD(sym, raw) {
    const closes = raw.indicators.quote[0].close;
    const timestamps = raw.timestamp;
    // Prefer regularMarketPreviousClose for percentage matching
    const prev = raw.meta.regularMarketPreviousClose ?? raw.meta.previousClose ?? raw.meta.chartPreviousClose;
    const cur = raw.meta.regularMarketPrice ?? lastValid(closes);

    const obj = sym === 'GC=F' ? S.xau : S.xag;

    // IMPORTANT: If source is Yahoo, update both current and anchor.
    // If source is TV, we ONLY update the anchor from Yahoo data.
    if (S.source === 'yahoo') {
        obj.cur = cur;
        obj.prev = prev;
    }

    const anchor = findAnchor1530(timestamps, closes);
    if (anchor) {
        obj.anchor1530 = anchor;
        console.log(`[AurumTrack] Updated ${sym} anchor1530: $${anchor}`);
    } else if (!obj.anchor1530) {
        obj.anchor1530 = prev; // Fallback
    }

    console.log(`[AurumTrack] ${sym} Yahoo sync: cur=$${cur} prev=$${prev} anchor=$${obj.anchor1530}`);
}

function processBees(sym, raw) {
    const prev = raw.meta.regularMarketPreviousClose ?? raw.meta.previousClose ?? raw.meta.chartPreviousClose;
    const cur = raw.meta.regularMarketPrice ?? lastValid(raw.indicators.quote[0].close);
    const obj = sym === 'GOLDBEES.NS' ? S.goldBees : S.silverBees;
    obj.cur = cur;
    obj.prev = prev;
}

function processForex(raw) {
    S.usdinr.cur = raw.meta.regularMarketPrice ?? 0;
    S.usdinr.prev = raw.meta.regularMarketPreviousClose ?? raw.meta.previousClose ?? raw.meta.chartPreviousClose ?? 0;
}

function processTVData(res) {
    if (!res?.data) return;
    res.data.forEach(item => {
        const [cur, pct, diff] = item.d;
        // TradingView change is already absolute diff, pct is percentage
        // To match Yahoo, we "derive" a prev close
        const prev = cur - diff;

        if (item.s === 'TVC:GOLD') { S.xau.cur = cur; S.xau.prev = prev; }
        else if (item.s === 'TVC:SILVER') { S.xag.cur = cur; S.xag.prev = prev; }
        else if (item.s === 'FX_IDC:USDINR') { S.usdinr.cur = cur; S.usdinr.prev = prev; }
        else if (item.s === 'NSE:GOLDBEES') { S.goldBees.cur = cur; S.goldBees.prev = prev; }
        else if (item.s === 'NSE:SILVERBEES') { S.silverBees.cur = cur; S.silverBees.prev = prev; }
        else if (item.s === 'MCX:GOLDM1!') { S.xauM.cur = cur; S.xauM.prev = prev; }
        else if (item.s === 'MCX:SILVERM1!') { S.xagM.cur = cur; S.xagM.prev = prev; }
    });
}

/* ══════════════════════════════════════════════
   FETCH ALL
══════════════════════════════════════════════ */
async function fetchAll() {
    if (S.source === 'yahoo') {
        const symbols = [
            { sym: 'GC=F', interval: '1m', range: '5d', type: 'usd' },
            { sym: 'SI=F', interval: '1m', range: '5d', type: 'usd' },
            { sym: 'USDINR=X', interval: '1m', range: '5d', type: 'fx' },
            { sym: 'GOLDBEES.NS', interval: '1m', range: '5d', type: 'bees' },
            { sym: 'SILVERBEES.NS', interval: '1m', range: '5d', type: 'bees' }
        ];

        // Fetch all Yahoo symbols in parallel for faster initial load
        await Promise.all(symbols.map(async (item) => {
            try {
                const raw = await fetchYahoo(item.sym, item.interval, item.range);
                if (!raw) return;
                if (item.type === 'usd') processUSD(item.sym, raw);
                else if (item.type === 'fx') processForex(raw);
                else if (item.type === 'bees') processBees(item.sym, raw);
            } catch (e) { console.error(`[AurumTrack] Error fetching ${item.sym}:`, e); }
        }));
        renderUI();
        EL.lastUpdated.textContent = istString(istNow());
    } else {
        // TradingView Scanning — fetch all markets in PARALLEL for fast load
        const tvRequests = [
            { m: 'india', t: ["NSE:GOLDBEES", "NSE:SILVERBEES"] },
            { m: 'cfd', t: ["TVC:GOLD", "TVC:SILVER"] },
            { m: 'forex', t: ["FX_IDC:USDINR"] },
            { m: 'global', t: ["MCX:GOLDM1!", "MCX:SILVERM1!"] }
        ];

        // Phase 1: Fetch all TradingView endpoints in parallel (fast — usually < 1s)
        const tvResults = await Promise.all(
            tvRequests.map(req => fetchTradingView(req.m, req.t))
        );
        tvResults.forEach(res => { if (res) processTVData(res); });

        // Render immediately with TV data — don't wait for Yahoo anchors
        renderUI();
        EL.lastUpdated.textContent = istString(istNow());

        // Phase 2: Fetch Yahoo anchors in background (for 15:30 prediction)
        // Do this after rendering so it doesn't delay the UI
        Promise.all([
            fetchYahoo('GC=F', '5m', '5d'),
            fetchYahoo('SI=F', '5m', '5d')
        ]).then(([goldRaw, silverRaw]) => {
            if (goldRaw) processUSD('GC=F', goldRaw);
            if (silverRaw) processUSD('SI=F', silverRaw);
            // Re-render to update prediction cards with fresh anchor
            renderUI();
        }).catch(e => console.error('[AurumTrack] Yahoo anchor fetch failed:', e));
    }

    setTimeout(() => { S.firstLoad = false; }, 1000);
}

/* ══════════════════════════════════════════════
   RENDER
══════════════════════════════════════════════ */
function renderChange(rowEl, caretIcon, changeEl, pctEl, cur, prev, decimals = 2) {
    if (!cur || !prev) return;
    const diff = cur - prev;
    const pct = (diff / prev) * 100;
    const sign = diff >= 0 ? '+' : '';
    const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';

    rowEl.className = `card-change ${cls}`;
    // Fix: use fa-caret-down icon when negative, fa-caret-up when positive
    if (diff < 0) {
        caretIcon.className = 'fa-solid fa-caret-down caret';
    } else {
        caretIcon.className = 'fa-solid fa-caret-up caret';
    }
    changeEl.textContent = `${sign}${fmt(diff, decimals)}`;
    pctEl.textContent = `(${sign}${fmt(pct)}%)`;
}

function animateTo(el, target, dec = 2) {
    if (target === undefined || target === null || isNaN(target)) return;
    const startText = el.textContent.replace(/[^0-9.-]/g, '');
    const start = parseFloat(startText) || 0;

    if (Math.abs(start - target) < 0.001) {
        el.textContent = fmt(target, dec);
        return;
    }

    // If it's the first load or we have no starting text, skip animation for instant update
    if (S.firstLoad || !startText || startText === '') {
        el.textContent = fmt(target, dec);
        return;
    }

    const dur = 800, t0 = performance.now();
    function step(now) {
        const p = Math.min((now - t0) / dur, 1);
        const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
        el.textContent = fmt(start + e * (target - start), dec);
        if (p < 1) {
            requestAnimationFrame(step);
        } else {
            // Add pulse effect once animation finishes
            el.classList.add('updated');
            setTimeout(() => el.classList.remove('updated'), 600);
        }
    }
    requestAnimationFrame(step);
}

function renderUI() {
    // ── Gold USD ──
    if (S.xau.cur) {
        animateTo(EL.xauPrice, S.xau.cur, 2);
        renderChange(EL.xauChangeRow, EL.xauChangeRow.querySelector('.caret'),
            EL.xauChange, EL.xauPct, S.xau.cur, S.xau.prev, 2);
        // INR per gram  = (Price_USD × USDINR) ÷ 28.3
        if (S.usdinr.cur) {
            const inrGram = (S.xau.cur * S.usdinr.cur) / CFG.GRAMS_PER_OZ;
            EL.xauInrGram.textContent = fmtInrGram(inrGram);
        }
    }

    // ── Silver USD ──
    if (S.xag.cur) {
        animateTo(EL.xagPrice, S.xag.cur, 2);
        renderChange(EL.xagChangeRow, EL.xagChangeRow.querySelector('.caret'),
            EL.xagChange, EL.xagPct, S.xag.cur, S.xag.prev, 2);
        if (S.usdinr.cur) {
            const inrGram = (S.xag.cur * S.usdinr.cur) / CFG.GRAMS_PER_OZ;
            EL.xagInrGram.textContent = fmtInrGram(inrGram);
        }
    }

    // ── USD/INR ──
    if (S.usdinr.cur) {
        animateTo(EL.usdinrPrice, S.usdinr.cur, 2);
        renderChange(EL.usdinrChangeRow, EL.usdinrChangeRow.querySelector('.caret'),
            EL.usdinrChange, EL.usdinrPct, S.usdinr.cur, S.usdinr.prev, 4);
    }

    // ── Gold BeES ──
    if (S.goldBees.cur) {
        animateTo(EL.gbPrice, S.goldBees.cur, 2);
        renderChange(EL.gbChangeRow, EL.gbChangeRow.querySelector('.caret'),
            EL.gbChange, EL.gbPct, S.goldBees.cur, S.goldBees.prev, 2);
    }

    // ── Silver BeES ──
    if (S.silverBees.cur) {
        animateTo(EL.sbPrice, S.silverBees.cur, 2);
        renderChange(EL.sbChangeRow, EL.sbChangeRow.querySelector('.caret'),
            EL.sbChange, EL.sbPct, S.silverBees.cur, S.silverBees.prev, 2);
    }

    // ── MCX Mini ──
    if (S.xauM.cur) {
        animateTo(EL.xaumPrice, S.xauM.cur, 0);
        renderChange(EL.xaumChangeRow, EL.xaumChangeRow.querySelector('.caret'),
            EL.xaumChange, EL.xaumPct, S.xauM.cur, S.xauM.prev, 0);
    }
    if (S.xagM.cur) {
        animateTo(EL.xagmPrice, S.xagM.cur, 0);
        renderChange(EL.xagmChangeRow, EL.xagmChangeRow.querySelector('.caret'),
            EL.xagmChange, EL.xagmPct, S.xagM.cur, S.xagM.prev, 0);
    }

    // ── Gap Prediction ──
    renderGap(S.xau, S.goldBees, EL.expGold, EL.goldAnchor, EL.goldNow, EL.goldGapPct);
    renderGap(S.xag, S.silverBees, EL.expSilver, EL.silverAnchor, EL.silverNow, EL.silverGapPct);

    // Update Source Labels and Badges
    const labels = document.querySelectorAll('.source-label');
    const isTV = S.source === 'tradingview';
    const mapping = isTV ? {
        'xau-price': 'TVC:GOLD',
        'xag-price': 'TVC:SILVER',
        'usdinr-price': 'FX_IDC:USDINR',
        'goldbees-price': 'NSE:GOLDBEES',
        'silverbees-price': 'NSE:SILVERBEES',
        'xaum-price': 'MCX:GOLDM1!',
        'xagm-price': 'MCX:SILVERM1!'
    } : {
        'xau-price': 'COMEX · GC=F',
        'xag-price': 'COMEX · SI=F',
        'usdinr-price': 'Forex pair',
        'goldbees-price': 'GOLDBEES.NS · Nippon',
        'silverbees-price': 'SILVERBEES.NS · Mirae',
        'xaum-price': 'MCX:GOLDM1!',
        'xagm-price': 'MCX:SILVERM1!'
    };

    Object.keys(mapping).forEach(id => {
        const card = document.getElementById(id)?.closest('.card');
        if (card) {
            const label = card.querySelector('.source-label');
            if (label) label.textContent = mapping[id];

            // Highlight TV badge if active
            const badge = card.querySelector('.badge');
            if (badge) {
                if (isTV) {
                    badge.textContent = 'TV';
                    badge.classList.add('badge-derived');
                } else {
                    if (id.includes('bees')) badge.textContent = 'ETF';
                    else if (id.includes('inr')) badge.textContent = 'INR';
                    else if (id.includes('xaum') || id.includes('xagm')) badge.textContent = 'MCX';
                    else badge.textContent = 'USD';
                    badge.classList.remove('badge-derived');
                }
            }
        }
    });

    // Save to cache
    saveCache();
}

/* ══════════════════════════════════════════════
   CACHE
 ══════════════════════════════════════════════ */
function saveCache() {
    try {
        localStorage.setItem('market_data', JSON.stringify({
            xau: S.xau,
            xag: S.xag,
            usdinr: S.usdinr,
            goldBees: S.goldBees,
            silverBees: S.silverBees,
            xauM: S.xauM,
            xagM: S.xagM
        }));
    } catch (e) { }
}

function loadCache() {
    try {
        const data = JSON.parse(localStorage.getItem('market_data'));
        if (data) {
            // Restore values to state
            Object.keys(data).forEach(k => {
                if (S[k]) Object.assign(S[k], data[k]);
            });
            S.firstLoad = true;
            renderUI();
            S.firstLoad = false;
        }
    } catch (e) { }
}

function renderGap(usdState, beesState, expEl, anchorEl, nowEl, pctEl) {
    if (!usdState.cur || !usdState.anchor1530 || !beesState.cur) return;

    // Enhanced prediction: use anchor at 15:30 IST and compute expected BeES open tomorrow
    const diffPct = (usdState.cur - usdState.anchor1530) / usdState.anchor1530;

    // Apply dampening (0.92) — BeES doesn't always gap 1:1 with international moves
    const DAMPENING = 0.92;
    const expected = beesState.cur * (1 + diffPct * DAMPENING);

    anchorEl.textContent = `$${fmt(usdState.anchor1530)}`;
    nowEl.textContent = `$${fmt(usdState.cur)}`;

    const sign = diffPct >= 0 ? '+' : '';
    const cls = diffPct > 0 ? 'up' : diffPct < 0 ? 'down' : '';
    pctEl.textContent = `${sign}${fmt(diffPct * 100)}%`;
    pctEl.className = `gap-pct ${cls}`;

    animateTo(expEl, expected, 2);
    expEl.classList.remove('text-up', 'text-down');
    if (expected > beesState.cur) expEl.classList.add('text-up');
    else if (expected < beesState.cur) expEl.classList.add('text-down');
}

/* ══════════════════════════════════════════════
   BOOTSTRAP
══════════════════════════════════════════════ */
/* ══════════════════════════════════════════════
   SOURCE TOGGLE
══════════════════════════════════════════════ */


/* ══════════════════════════════════════════════
   BOOTSTRAP
══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    startLiveClock();
    startCountdown();

    loadCache(); // Load previous values for instant feel

    await fetchAll();

    setInterval(async () => {
        await fetchAll();
        resetCountdown();
    }, CFG.INTERVAL);
});
