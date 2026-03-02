/**
 * Arbitrage / Spread Analysis Logic
 * Calculates the gap between MCX and COMEX prices
 */

'use strict';

const CFG = {
    API: 'https://query1.finance.yahoo.com/v8/finance/chart/',
    TV_API: 'https://scanner.tradingview.com/',
    INTERVAL: 5000,
    GRAMS_PER_OZ: 28.3
};

const S = {
    firstLoad: true,
    gold: { mcx: 0, comex: 0, usdinr: 0 },
    silver: { mcx: 0, comex: 0, usdinr: 0 }
};

const EL = {
    clock: document.getElementById('live-clock'),
    countdown: document.getElementById('countdown'),
    lastUpdated: document.getElementById('last-updated-time'),

    mcxGold: document.getElementById('mcx-gold-price'),
    comexGold: document.getElementById('comex-gold-inr'),
    goldPct: document.getElementById('gold-spread-pct'),
    goldAbs: document.getElementById('gold-spread-abs'),
    goldStatus: document.getElementById('gold-arb-status'),

    mcxSilver: document.getElementById('mcx-silver-price'),
    comexSilver: document.getElementById('comex-silver-inr'),
    silverPct: document.getElementById('silver-spread-pct'),
    silverAbs: document.getElementById('silver-spread-abs'),
    silverStatus: document.getElementById('silver-arb-status')
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

function istNow() {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utcMs + 5.5 * 3600 * 1000);
}

function istString(d) {
    return d.toTimeString().split(' ')[0];
}

/* ══════════════════════════════════════════════
   FETCH
══════════════════════════════════════════════ */
async function fetchTradingView(market, tickers) {
    const url = `${CFG.TV_API}${market}/scan`;
    const body = {
        symbols: { tickers },
        columns: ["close", "name"]
    };

    try {
        const r = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        return await r.json();
    } catch (e) {
        console.error(`TV fetch failed for ${market}:`, e);
        return null;
    }
}

async function updateData() {
    const tvRequests = [
        { m: 'cfd', t: ["TVC:GOLD", "TVC:SILVER"] },
        { m: 'forex', t: ["FX_IDC:USDINR"] },
        { m: 'global', t: ["MCX:GOLDM1!", "MCX:SILVERM1!"] }
    ];

    try {
        const results = await Promise.all(tvRequests.map(req => fetchTradingView(req.m, req.t)));

        results.forEach(res => {
            if (!res?.data) return;
            res.data.forEach(item => {
                const val = item.d[0];
                if (item.s === 'TVC:GOLD') S.gold.comex = val;
                if (item.s === 'TVC:SILVER') S.silver.comex = val;
                if (item.s === 'FX_IDC:USDINR') {
                    S.gold.usdinr = val;
                    S.silver.usdinr = val;
                }
                if (item.s === 'MCX:GOLDM1!') S.gold.mcx = val;
                if (item.s === 'MCX:SILVERM1!') S.silver.mcx = val;
            });
        });

        calculateAndRender();
        EL.lastUpdated.textContent = istString(istNow());
        S.firstLoad = false;
    } catch (e) {
        console.error('Update failed:', e);
    }
}

/* ══════════════════════════════════════════════
   LOGIC & RENDER
══════════════════════════════════════════════ */
function calculateAndRender() {
    renderArb('gold', S.gold, EL.mcxGold, EL.comexGold, EL.goldPct, EL.goldAbs, EL.goldStatus);
    renderArb('silver', S.silver, EL.mcxSilver, EL.comexSilver, EL.silverPct, EL.silverAbs, EL.silverStatus);
}

function renderArb(id, data, mcxEl, comexInrEl, pctEl, absEl, statusEl) {
    if (!data.mcx || !data.comex || !data.usdinr) return;

    // Normalize MCX prices to per-gram
    // MCX Gold Mini is for 10g, MCX Silver Mini is for 1kg (1000g)
    const mcxPerGram = id === 'gold' ? (data.mcx / 10) : (data.mcx / 1000);

    const parityInrG = (data.comex * data.usdinr) / CFG.GRAMS_PER_OZ;
    const absSpread = mcxPerGram - parityInrG;
    const pctSpread = (absSpread / parityInrG) * 100;

    animateTo(mcxEl, mcxPerGram, 0);
    animateTo(comexInrEl, parityInrG, 0);

    const sign = absSpread >= 0 ? '+' : '';
    const colorClass = absSpread >= 0 ? 'up' : 'down';
    const statusText = absSpread >= 0 ? 'Premium' : 'Discount';
    const statusClass = absSpread >= 0 ? 'premium' : 'discount';

    pctEl.textContent = `${sign}${fmt(pctSpread, 2)}%`;
    pctEl.className = `spread-pct ${colorClass}`;

    absEl.textContent = `${sign}₹${fmt(Math.abs(absSpread), 2)} / gram`;
    absEl.className = `spread-abs ${colorClass}`;

    statusEl.textContent = statusText;
    statusEl.className = `arb-badge ${statusClass}`;
}

function animateTo(el, target, dec = 2) {
    if (S.firstLoad) {
        el.textContent = `₹${fmt(target, dec)}`;
        return;
    }

    const startText = el.textContent.replace(/[^0-9.-]/g, '');
    const start = parseFloat(startText) || 0;

    const dur = 800, t0 = performance.now();
    function step(now) {
        const p = Math.min((now - t0) / dur, 1);
        const e = 1 - Math.pow(1 - p, 3);
        const current = start + e * (target - start);
        el.textContent = `₹${fmt(current, dec)}`;
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

/* ══════════════════════════════════════════════
   LIFECYCLE
══════════════════════════════════════════════ */
function startLiveClock() {
    setInterval(() => {
        EL.clock.textContent = istString(istNow()) + ' IST';
    }, 1000);
}

let cd = CFG.INTERVAL / 1000;
function startCountdown() {
    setInterval(() => {
        cd--;
        if (cd < 0) {
            cd = CFG.INTERVAL / 1000;
            updateData();
        }
        EL.countdown.textContent = Math.ceil(cd);
    }, 1000);
}

function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const themeIcon = document.getElementById('theme-icon');
    themeIcon.className = saved === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';

    document.getElementById('theme-toggle').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        themeIcon.className = next === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    startLiveClock();
    updateData();
    startCountdown();
});
