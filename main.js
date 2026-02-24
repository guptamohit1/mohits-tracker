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
    PROXIES: [
        { url: 'https://api.allorigins.win/get?url=', wraps: true },
        { url: 'https://corsproxy.io/?', wraps: false }
    ],
    INTERVAL: 10000,   // 10 seconds — live feel
    GRAMS_PER_OZ: 28.3 // oz → grams (User requested 28.3)
};

/* ══════════════════════════════════════════════
   STATE
══════════════════════════════════════════════ */
const S = {
    firstLoad: true, // Track if it's the first render for instant load
    xau: { cur: 0, prev: 0, anchor1530: 0 },
    xag: { cur: 0, prev: 0, anchor1530: 0 },
    usdinr: { cur: 0, prev: 0 },
    goldBees: { cur: 0, prev: 0 },
    silverBees: { cur: 0, prev: 0 },
    inGold: { cur: 0, prev: 0 },   // IVZINGOLD.NS  — real India gold price per gram
    inSilver: { cur: 0, prev: 0 }  // SILVERIETF.NS — real India silver price per gram
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

    // India prices
    ingoldPrice: document.getElementById('ingold-price'),
    ingoldChangeRow: document.getElementById('ingold-change-row'),
    ingoldChange: document.getElementById('ingold-change'),
    ingoldPct: document.getElementById('ingold-pct'),
    goldPremium: document.getElementById('gold-premium'),
    insilverPrice: document.getElementById('insilver-price'),
    insilverChangeRow: document.getElementById('insilver-change-row'),
    insilverChange: document.getElementById('insilver-change'),
    insilverPct: document.getElementById('insilver-pct'),
    silverPremium: document.getElementById('silver-premium'),

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

    // Theme
    html: document.documentElement,
    themeIcon: document.getElementById('theme-icon'),
    themeBtn: document.getElementById('theme-toggle')
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
    const url = `${CFG.API}${symbol}?interval=${interval}&range=${range}`;

    // Try direct
    try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('status ' + r.status);
        const d = await r.json();
        if (d.chart?.result?.[0]) return d.chart.result[0];
        throw new Error('no result');
    } catch (e) { /* silent */ }

    // Try proxies
    for (const p of CFG.PROXIES) {
        try {
            const r = await fetch(p.url + encodeURIComponent(url));
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

    console.error('[AurumTrack] All fetches failed for', symbol);
    return null;
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
    // 09:45–10:15 UTC window (15:15–15:45 IST) — wide bracket
    const TARGET_UTC = 10 * 60; // 10:00 UTC in minutes
    let bestGap = Infinity, bestPrice = null;

    for (let i = timestamps.length - 1; i >= 0; i--) {
        if (closes[i] === null || closes[i] === undefined) continue;
        const d = new Date(timestamps[i] * 1000);
        const dsn = d.getUTCDate() * 1440 + d.getUTCHours() * 60 + d.getUTCMinutes();

        // Re-normalise to per-day: check only hours 9-11 UTC
        const utcH = d.getUTCHours();
        const utcM = d.getUTCMinutes();
        if (utcH < 9 || utcH > 11) continue;

        const candleMin = utcH * 60 + utcM;
        const gap = Math.abs(candleMin - TARGET_UTC);
        if (gap < bestGap && gap <= 20) { // within 20 mins
            bestGap = gap;
            bestPrice = closes[i];
        }
    }
    return bestPrice; // may be null on weekends/holidays
}

function processUSD(sym, raw) {
    const closes = raw.indicators.quote[0].close;
    const timestamps = raw.timestamp;
    const prev = raw.meta.chartPreviousClose ?? raw.meta.previousClose;
    const cur = raw.meta.regularMarketPrice ?? lastValid(closes);

    const obj = sym === 'GC=F' ? S.xau : S.xag;
    obj.cur = cur;
    obj.prev = prev;
    obj.anchor1530 = findAnchor1530(timestamps, closes) ?? prev;
    console.log(`[AurumTrack] ${sym} cur=$${cur} prev=$${prev} anchor1530=$${obj.anchor1530}`);
}

function processBees(sym, raw) {
    const prev = raw.meta.chartPreviousClose ?? raw.meta.previousClose;
    const cur = raw.meta.regularMarketPrice ?? lastValid(raw.indicators.quote[0].close);
    const obj = sym === 'GOLDBEES.NS' ? S.goldBees : S.silverBees;
    obj.cur = cur;
    obj.prev = prev;
}

function processForex(raw) {
    S.usdinr.cur = raw.meta.regularMarketPrice ?? 0;
    S.usdinr.prev = raw.meta.chartPreviousClose ?? 0;
}

/* ══════════════════════════════════════════════
   FETCH ALL
══════════════════════════════════════════════ */
async function fetchAll() {
    const symbols = [
        { sym: 'GC=F', interval: '5m', range: '5d', type: 'usd' },
        { sym: 'SI=F', interval: '5m', range: '5d', type: 'usd' },
        { sym: 'USDINR=X', interval: '1d', range: '5d', type: 'fx' },
        { sym: 'GOLDBEES.NS', interval: '1d', range: '5d', type: 'bees' },
        { sym: 'SILVERBEES.NS', interval: '1d', range: '5d', type: 'bees' },
        { sym: 'IVZINGOLD.NS', interval: '1d', range: '5d', type: 'ingold' },
        { sym: 'SILVERIETF.NS', interval: '1d', range: '5d', type: 'insilver' }
    ];

    // Incremental loading: process each symbol as it returns
    symbols.forEach(async (item) => {
        try {
            const raw = await fetchYahoo(item.sym, item.interval, item.range);
            if (!raw) return;

            if (item.type === 'usd') processUSD(item.sym, raw);
            else if (item.type === 'fx') processForex(raw);
            else if (item.type === 'bees') processBees(item.sym, raw);
            else if (item.type === 'ingold') {
                S.inGold.cur = raw.meta.regularMarketPrice ?? 0;
                S.inGold.prev = raw.meta.chartPreviousClose ?? 0;
            }
            else if (item.type === 'insilver') {
                S.inSilver.cur = raw.meta.regularMarketPrice ?? 0;
                S.inSilver.prev = raw.meta.chartPreviousClose ?? 0;
            }

            renderUI();
            EL.lastUpdated.textContent = istString(istNow());
        } catch (e) {
            console.error(`[AurumTrack] Error fetching ${item.sym}:`, e);
        }
    });

    // After first batch of triggers, mark firstLoad as false after a short delay
    // to allow initial values to "snap" into place without duration
    setTimeout(() => { S.firstLoad = false; }, 2000);
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
    caretIcon.className = `fa-solid fa-caret-up caret${diff < 0 ? ' down' : ''}`;
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
        if (p < 1) requestAnimationFrame(step);
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

    // ── India Market prices ──
    if (S.inGold.cur) {
        animateTo(EL.ingoldPrice, S.inGold.cur, 0);
        renderChange(EL.ingoldChangeRow, EL.ingoldChangeRow.querySelector('.caret'),
            EL.ingoldChange, EL.ingoldPct, S.inGold.cur, S.inGold.prev, 2);

        // Premium calculation
        if (S.xau.cur && S.usdinr.cur) {
            const intlInr = (S.xau.cur * S.usdinr.cur) / CFG.GRAMS_PER_OZ;
            const diff = S.inGold.cur - intlInr;
            const sign = diff >= 0 ? '+' : '';
            EL.goldPremium.textContent = `${sign}${fmt(diff, 0)} INR`;
            EL.goldPremium.className = `inr-gram-value premium ${diff >= 0 ? 'up' : 'down'}`;
        }
    }

    if (S.inSilver.cur) {
        animateTo(EL.insilverPrice, S.inSilver.cur, 0);
        renderChange(EL.insilverChangeRow, EL.insilverChangeRow.querySelector('.caret'),
            EL.insilverChange, EL.insilverPct, S.inSilver.cur, S.inSilver.prev, 0);

        if (S.xag.cur && S.usdinr.cur) {
            const intlInr = (S.xag.cur * S.usdinr.cur) / CFG.GRAMS_PER_OZ;
            const diff = S.inSilver.cur - intlInr;
            const sign = diff >= 0 ? '+' : '';
            EL.silverPremium.textContent = `${sign}${fmt(diff, 0)} INR`;
            EL.silverPremium.className = `inr-gram-value premium ${diff >= 0 ? 'up' : 'down'}`;
        }
    }

    // ── Gap Prediction ──
    renderGap(S.xau, S.goldBees, EL.expGold, EL.goldAnchor, EL.goldNow, EL.goldGapPct);
    renderGap(S.xag, S.silverBees, EL.expSilver, EL.silverAnchor, EL.silverNow, EL.silverGapPct);

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
            inGold: S.inGold,
            inSilver: S.inSilver
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

    const diffPct = (usdState.cur - usdState.anchor1530) / usdState.anchor1530;
    const expected = beesState.cur * (1 + diffPct);

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
