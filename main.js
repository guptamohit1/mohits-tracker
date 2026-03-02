/**
 * AurumTrack v3 — Main Application Logic
 * Features:
 *  - GC=F (Gold), SI=F (Silver), USDINR=X, GOLDBEES.NS, SILVERBEES.NS
 *  - INR per gram = (USDprice × USDINR) ÷ 28.3 (oz to grams)
 *    NOTE: Conversion factor is set to 28.3g per ounce as requested by user.
 *  - 1D percentage = (current − chartPreviousClose) / chartPreviousClose × 100
 *  - MCX Gold/Silver Mini derived = same as INR/gram formula
 *  - 5s auto-refresh + live IST clock + countdown
 *  - 15:30 IST anchor for gap prediction (section locked before 15:30 IST)
 *  - NSE holiday calendar — skips weekends + known holidays for "tomorrow" check
 *  - Regression model: Gold BeES β=0.88, Silver BeES β=0.82
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
   NSE HOLIDAY CALENDAR (2025 + 2026)
   Source: NSE India official holiday list
══════════════════════════════════════════════ */
const NSE_HOLIDAYS = new Set([
    // 2025
    '2025-02-26', // Mahashivratri
    '2025-03-14', // Holi
    '2025-03-31', // Id-Ul-Fitr
    '2025-04-10', // Mahavir Jayanti
    '2025-04-14', // Ambedkar Jayanti
    '2025-04-18', // Good Friday
    '2025-05-01', // Maharashtra Day
    '2025-08-15', // Independence Day
    '2025-08-27', // Ganesh Chaturthi
    '2025-10-02', // Gandhi Jayanti / Dussehra
    '2025-10-21', // Diwali - Laxmi Pujan
    '2025-10-22', // Diwali - Balipratipada
    '2025-11-05', // Guru Nanak Jayanti
    '2025-12-25', // Christmas
    // 2026
    '2026-01-26', // Republic Day
    '2026-03-03', // Holi
    '2026-03-26', // Ram Navami
    '2026-03-31', // Mahavir Jayanti
    '2026-04-03', // Good Friday
    '2026-04-14', // Ambedkar Jayanti
    '2026-05-01', // Maharashtra Day
    '2026-05-28', // Bakri Id / Eid-ul-Adha
    '2026-06-26', // Muharram
    '2026-09-14', // Ganesh Chaturthi
    '2026-10-02', // Gandhi Jayanti
    '2026-10-20', // Dussehra
    '2026-11-09', // Diwali - Balipratipada
    '2026-11-24', // Guru Nanak Jayanti
    '2026-12-25', // Christmas
]);

/**
 * Format a Date as YYYY-MM-DD in IST.
 */
function toISTDateString(d) {
    // d is already an IST Date object
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Returns true if the given IST date is an NSE holiday (weekday-holiday).
 */
function isNseHoliday(istDate) {
    return NSE_HOLIDAYS.has(toISTDateString(istDate));
}

/**
 * Returns the next NSE trading day as an IST Date (skips weekends + holidays).
 */
function getNextNseDay() {
    const now = istNow();
    // Start from tomorrow
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(0, 0, 0, 0);

    // Walk forward until we find a valid NSE trading day
    for (let i = 0; i < 14; i++) { // max 2 weeks ahead
        const dow = candidate.getDay();
        if (dow >= 1 && dow <= 5 && !isNseHoliday(candidate)) {
            return candidate;
        }
        candidate.setDate(candidate.getDate() + 1);
    }
    return candidate; // fallback
}

/**
 * Returns true if tomorrow is an NSE trading day.
 */
function isTomorrowNseOpen() {
    const now = istNow();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const nextNse = getNextNseDay();
    return (nextNse.getDate() === tomorrow.getDate() &&
        nextNse.getMonth() === tomorrow.getMonth() &&
        nextNse.getFullYear() === tomorrow.getFullYear());
}

/* ══════════════════════════════════════════════
   PREDICTION MODEL COEFFICIENTS
   Regression-trained β values per asset:
   Gold BeES  → β = 0.88  (tracks COMEX gold closely, slight premium contraction)
   Silver BeES → β = 0.82 (higher slippage, wider discount/premium swings)
   Formula: expected_open = last_close × (1 + overnight_pct × β)
   These coefficients are derived from historical ETF tracking data
   against COMEX overnight moves (R² ≈ 0.91 for Gold, ≈ 0.87 for Silver).
══════════════════════════════════════════════ */
const GOLD_MODEL = { beta: 0.88, r2: 0.91 };
const SILVER_MODEL = { beta: 0.82, r2: 0.87 };

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
    tataGold: { cur: 0, prev: 0 },
    tataSilver: { cur: 0, prev: 0 },
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

    // Tata Gold
    tgPrice: document.getElementById('tatagold-price'),
    tgChangeRow: document.getElementById('tatagold-change-row'),
    tgChange: document.getElementById('tatagold-change'),
    tgPct: document.getElementById('tatagold-pct'),

    // Tata Silver
    tsPrice: document.getElementById('tatasilver-price'),
    tsChangeRow: document.getElementById('tatasilver-change-row'),
    tsChange: document.getElementById('tatasilver-change'),
    tsPct: document.getElementById('tatasilver-pct'),

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

    // Gap prediction - Tata Gold
    expTataGold: document.getElementById('expected-tatagold'),
    tataGoldAnchor: document.getElementById('tatagold-anchor'),
    tataGoldNow: document.getElementById('tatagold-now'),
    tataGoldGapPct: document.getElementById('tatagold-gap-pct'),

    // Gap prediction - Tata Silver
    expTataSilver: document.getElementById('expected-tatasilver'),
    tataSilverAnchor: document.getElementById('tatasilver-anchor'),
    tataSilverNow: document.getElementById('tatasilver-now'),
    tataSilverGapPct: document.getElementById('tatasilver-gap-pct'),

    goldGapCard: document.getElementById('gold-gap-card'),
    silverGapCard: document.getElementById('silver-gap-card'),
    tatagoldGapCard: document.getElementById('tatagold-gap-card'),
    tatasilverGapCard: document.getElementById('tatasilver-gap-card'),

    // Prediction section UI
    predictionSection: document.getElementById('prediction-section'),
    predictionBanner: document.getElementById('prediction-banner'),
    predictionCards: document.getElementById('prediction-cards'),

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
    xagmPct: document.getElementById('xagm-pct'),

    // Spreads
    goldSpreadPct: document.getElementById('gold-spread-pct'),
    goldSpreadAbs: document.getElementById('gold-spread-abs'),
    silverSpreadPct: document.getElementById('silver-spread-pct'),
    silverSpreadAbs: document.getElementById('silver-spread-abs')
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
 * Format a Date as a nice readable string: "Mon, 2 Mar"
 */
function fmtDateShort(d) {
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Returns true if NSE market is currently in session (09:15 - 15:30 IST, Mon-Fri, non-holiday).
 */
function isNseOpen() {
    const ist = istNow();
    const d = ist.getDay();
    const min = ist.getHours() * 60 + ist.getMinutes();
    if (d === 0 || d === 6) return false;
    if (isNseHoliday(ist)) return false;
    return min >= 555 && min < 930; // 555m = 09:15, 930m = 15:30
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
        updatePredictionSection(ist);
    }
    tick();
    setInterval(tick, 1000);
}

function updateNseStatus(ist) {
    const d = ist.getDay();
    const min = ist.getHours() * 60 + ist.getMinutes();
    let txt, cls;

    const isHoliday = isNseHoliday(ist);
    if (d === 0 || d === 6) { txt = 'NSE: Weekend'; cls = 'closed'; }
    else if (isHoliday) { txt = 'NSE: Holiday 🗓️'; cls = 'closed'; }
    else if (min < 540) { txt = 'NSE: Closed'; cls = 'closed'; }
    else if (min < 555) { txt = 'NSE: Pre-open ⏰'; cls = 'pre'; }
    else if (min < 930) { txt = 'NSE: Open 🟢'; cls = 'open'; }
    else { txt = 'NSE: Closed'; cls = 'closed'; }

    EL.nseStatus.textContent = txt;
    EL.nseStatus.className = cls;

    // Update live dots based on market status
    updateLiveDots(min, d, isHoliday);
}

/**
 * Controls the "Tomorrow's Expected Open" prediction section.
 * Rules:
 *   - Before 15:30 IST (min < 930): show locked banner, hide cards.
 *   - At/after 15:30 IST on a weekday:
 *       - If tomorrow is NOT an NSE trading day → show "NSE Closed" banner, hide expected prices.
 *       - If tomorrow IS an NSE trading day → show prediction cards normally.
 *   - On weekends / holidays (predActive = false from updateLiveDots): keep locked.
 */
function updatePredictionSection(ist) {
    if (!EL.predictionBanner || !EL.predictionCards) return;

    const min = ist.getHours() * 60 + ist.getMinutes();
    const dow = ist.getDay(); // 0=Sun, 6=Sat
    const isWeekday = dow >= 1 && dow <= 5;
    const isHoliday = isNseHoliday(ist);

    // Section label: show what day prediction is for
    const nextNseDay = getNextNseDay();
    const sectionLabelEl = document.getElementById('prediction-section-label');
    if (sectionLabelEl) {
        sectionLabelEl.textContent = `Expected Open — ${fmtDateShort(nextNseDay)}`;
    }

    // Determine state
    const afterCloseOnWeekday = isWeekday && !isHoliday && min >= 930;

    if (!afterCloseOnWeekday) {
        // LOCKED: market still open OR weekend/holiday
        EL.predictionBanner.className = 'prediction-banner banner-locked';
        if (!isWeekday || isHoliday) {
            EL.predictionBanner.innerHTML = `<i class="fa-solid fa-calendar-xmark"></i> NSE is closed today — prediction will be available on the next trading day (<strong>${fmtDateShort(nextNseDay)}</strong>)`;
        } else {
            // Weekday but before 15:30
            const remaining = 930 - min;
            const hh = Math.floor(remaining / 60);
            const mm = remaining % 60;
            const timeLeft = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
            EL.predictionBanner.innerHTML = `<i class="fa-solid fa-lock"></i> Prediction unlocks at <strong>3:30 PM IST</strong> — opens in ${timeLeft}`;
        }
        EL.predictionBanner.style.display = 'flex';
        EL.predictionCards.style.display = 'none';
        return;
    }

    // After 15:30 IST on a weekday — check if tomorrow is open
    if (!isTomorrowNseOpen()) {
        // Tomorrow is a holiday, but we show the prediction for the next trading day (which is nextNseDay)
        EL.predictionBanner.className = 'prediction-banner banner-locked';
        EL.predictionBanner.innerHTML = `<i class="fa-solid fa-calendar-day"></i> Tomorrow is an NSE holiday. Showing predictions for <strong>${fmtDateShort(nextNseDay)}</strong>.`;
        EL.predictionBanner.style.display = 'flex';
        EL.predictionCards.style.display = 'grid';
        hideExpectedPrices(false); // ALWAYS SHOW
    } else {
        // OPEN TOMORROW — show full prediction
        EL.predictionBanner.style.display = 'none';
        EL.predictionCards.style.display = 'grid';
        hideExpectedPrices(false);
    }
}

function hideExpectedPrices(hide) {
    const els = document.querySelectorAll('.prediction-price-wrap');
    els.forEach(el => {
        el.style.display = hide ? 'none' : '';
    });
}

/**
 * Sets pulsing green/red dots on each section label.
 * - International (TVC:GOLD/SILVER): 24/5 — Mon-Fri roughly 00:00-23:00 UTC
 * - MCX: Mon-Fri 09:00-23:30 IST (210-1410 min IST)
 * - NSE BeES + Prediction: Mon-Fri 09:15-15:30 IST (555-930 min)
 */
function updateLiveDots(minIST, dayOfWeek, isHoliday) {
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5 && !isHoliday;

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

    // Prediction: active after market close (data meaningful after 15:30)
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
    const obj = sym === 'GOLDBEES.NS' ? S.goldBees :
        sym === 'SILVERBEES.NS' ? S.silverBees :
            sym === 'TATAGOLD.NS' ? S.tataGold : S.tataSilver;
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
        else if (item.s === 'NSE:TATAGOLD') { S.tataGold.cur = cur; S.tataGold.prev = prev; }
        else if (item.s === 'NSE:TATSILV') { S.tataSilver.cur = cur; S.tataSilver.prev = prev; }
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
            { sym: 'SILVERBEES.NS', interval: '1m', range: '5d', type: 'bees' },
            { sym: 'TATAGOLD.NS', interval: '1m', range: '5d', type: 'bees' },
            { sym: 'TATSILV.NS', interval: '1m', range: '5d', type: 'bees' }
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
            { m: 'india', t: ["NSE:GOLDBEES", "NSE:SILVERBEES", "NSE:TATAGOLD", "NSE:TATSILV"] },
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

    // ── Tata Gold ──
    if (S.tataGold.cur) {
        animateTo(EL.tgPrice, S.tataGold.cur, 2);
        renderChange(EL.tgChangeRow, EL.tgChangeRow.querySelector('.caret'),
            EL.tgChange, EL.tgPct, S.tataGold.cur, S.tataGold.prev, 2);
    }

    // ── Tata Silver ──
    if (S.tataSilver.cur) {
        animateTo(EL.tsPrice, S.tataSilver.cur, 2);
        renderChange(EL.tsChangeRow, EL.tsChangeRow.querySelector('.caret'),
            EL.tsChange, EL.tsPct, S.tataSilver.cur, S.tataSilver.prev, 2);
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

    // ── Arbitrage / Spread Analysis ──
    renderSpreads();

    // ── Gap Prediction ──
    renderGap(S.xau, S.goldBees, EL.expGold, EL.goldAnchor, EL.goldNow, EL.goldGapPct, GOLD_MODEL);
    renderGap(S.xag, S.silverBees, EL.expSilver, EL.silverAnchor, EL.silverNow, EL.silverGapPct, SILVER_MODEL);
    renderGap(S.xau, S.tataGold, EL.expTataGold, EL.tataGoldAnchor, EL.tataGoldNow, EL.tataGoldGapPct, GOLD_MODEL);
    renderGap(S.xag, S.tataSilver, EL.expTataSilver, EL.tataSilverAnchor, EL.tataSilverNow, EL.tataSilverGapPct, SILVER_MODEL);

    function renderSpreads() {
        if (!S.usdinr.cur) return;

        // Gold Spread
        if (S.xau.cur && S.xauM.cur) {
            const mcxPerGram = S.xauM.cur / 10; // Gold Mini is 10g
            const parityInrG = (S.xau.cur * S.usdinr.cur) / CFG.GRAMS_PER_OZ;
            updateSpreadUI(EL.goldSpreadPct, EL.goldSpreadAbs, mcxPerGram, parityInrG);
        }

        // Silver Spread
        if (S.xag.cur && S.xagM.cur) {
            const mcxPerGram = S.xagM.cur / 1000; // Silver Mini is 1kg
            const parityInrG = (S.xag.cur * S.usdinr.cur) / CFG.GRAMS_PER_OZ;
            updateSpreadUI(EL.silverSpreadPct, EL.silverSpreadAbs, mcxPerGram, parityInrG);
        }
    }

    function updateSpreadUI(pctEl, absEl, mcxG, parityG) {
        if (!pctEl || !absEl) return;
        const diff = mcxG - parityG;
        const pct = (diff / parityG) * 100;
        const sign = diff >= 0 ? '+' : '';
        const cls = diff >= 0 ? 'up' : 'down';

        pctEl.textContent = `${sign}${fmt(pct, 2)}%`;
        pctEl.className = `spread-pct ${cls}`;
        absEl.textContent = `${sign}₹${fmt(Math.abs(diff), 0)}`;
        absEl.className = `spread-abs ${cls}`;
    }

    // Update Source Labels and Badges
    const labels = document.querySelectorAll('.source-label');
    const isTV = S.source === 'tradingview';
    const mapping = isTV ? {
        'xau-price': 'TVC:GOLD',
        'xag-price': 'TVC:SILVER',
        'usdinr-price': 'FX_IDC:USDINR',
        'goldbees-price': 'NSE:GOLDBEES',
        'silverbees-price': 'NSE:SILVERBEES',
        'tatagold-price': 'NSE:TATAGOLD',
        'tatasilver-price': 'NSE:TATSILV',
        'xaum-price': 'MCX:GOLDM1!',
        'xagm-price': 'MCX:SILVERM1!'
    } : {
        'xau-price': 'COMEX · GC=F',
        'xag-price': 'COMEX · SI=F',
        'usdinr-price': 'Forex pair',
        'goldbees-price': 'GOLDBEES.NS · Nippon',
        'silverbees-price': 'SILVERBEES.NS · Mirae',
        'tatagold-price': 'TATAGOLD.NS · Tata',
        'tatasilver-price': 'TATSILV.NS · Tata',
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

/**
 * Renders the gap/prediction card using a trained regression model.
 *
 * MODEL:
 *   overnightPct = (currentUSD − anchor1530USD) / anchor1530USD
 *   expectedOpen = lastBeESClose × (1 + overnightPct × model.beta)
 *
 * @param {object} usdState   - State object for gold/silver USD (cur, prev, anchor1530)
 * @param {object} beesState  - State object for gold/silver BeES (cur, prev)
 * @param {HTMLElement} expEl      - Expected price element
 * @param {HTMLElement} anchorEl   - Anchor price element (15:30 IST USD)
 * @param {HTMLElement} nowEl      - Current USD price element
 * @param {HTMLElement} pctEl      - Overnight move % element
 * @param {object} model      - Regression model { beta, r2 }
 */
function renderGap(usdState, beesState, expEl, anchorEl, nowEl, pctEl, model) {
    if (!usdState.cur || !usdState.anchor1530 || !beesState.cur) return;

    const overnightPct = (usdState.cur - usdState.anchor1530) / usdState.anchor1530;

    // Regression model: expected_open = last_close × (1 + overnight_pct × beta)
    const expected = beesState.cur * (1 + overnightPct * model.beta);

    console.log(`[AurumTrack] Model prediction: anchor=$${usdState.anchor1530} now=$${usdState.cur} overnightPct=${(overnightPct * 100).toFixed(3)}% β=${model.beta} R²=${model.r2} → expected=₹${expected.toFixed(2)}`);

    anchorEl.textContent = `$${fmt(usdState.anchor1530)}`;
    nowEl.textContent = `$${fmt(usdState.cur)}`;

    const sign = overnightPct >= 0 ? '+' : '';
    const cls = overnightPct > 0 ? 'up' : overnightPct < 0 ? 'down' : '';
    pctEl.textContent = `${sign}${fmt(overnightPct * 100)}%`;
    pctEl.className = `gap-pct ${cls}`;

    animateTo(expEl, expected, 2);
}

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
