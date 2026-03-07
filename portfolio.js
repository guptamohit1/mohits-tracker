/**
 * Portfolio P&L Tracker Logic
 * Features:
 *  - Natural Language Parsing (e.g., "I bought 50 units of Gold BeES at 58.20")
 *  - LocalStorage Persistence
 *  - Real-time P&L calculation
 *  - Multi-lot support
 */

'use strict';

const CONFIG = {
    API: 'https://scanner.tradingview.com/india/scan',
    INTERVAL: 10000, // 10s for portfolio updates
};

const STATE = {
    portfolio: JSON.parse(localStorage.getItem('mohit_portfolio')) || [],
    prices: {
        'Gold BeES': { cur: 0, sym: 'NSE:GOLDBEES' },
        'Silver BeES': { cur: 0, sym: 'NSE:SILVERBEES' },
        'Tata Gold': { cur: 0, sym: 'NSE:TATAGOLD' },
        'Tata Silver': { cur: 0, sym: 'NSE:TATSILV' }
    }
};

const ELEMENTS = {
    form: document.getElementById('transaction-form'),
    inputAction: document.getElementById('input-action'),
    inputUnits: document.getElementById('input-units'),
    inputAsset: document.getElementById('input-asset'),
    inputPrice: document.getElementById('input-price'),
    container: document.getElementById('portfolio-container'),
    list: document.getElementById('transaction-list'),
    clock: document.getElementById('live-clock'),
    countdown: document.getElementById('countdown'),
    lastUpdated: document.getElementById('last-updated-time'),
    html: document.documentElement,
    themeIcon: document.getElementById('theme-icon'),
    themeBtn: document.getElementById('theme-toggle')
};

/* ══════════════════════════════════════════════
   CORE LOGIC - DATA & ACTIONS
   ══════════════════════════════════════════════ */

function savePortfolio() {
    localStorage.setItem('mohit_portfolio', JSON.stringify(STATE.portfolio));
}

function calculateHoldings() {
    const holdings = {};
    Object.keys(STATE.prices).forEach(asset => {
        holdings[asset] = { units: 0, totalCost: 0, avgCost: 0, realizedPnl: 0 };
    });

    STATE.portfolio.forEach(tx => {
        const h = holdings[tx.asset];
        if (!h) return;

        if (tx.type === 'buy') {
            h.totalCost += tx.units * tx.price;
            h.units += tx.units;
            h.avgCost = h.totalCost / h.units;
        } else {
            // Realized Profit = (Sell Price - Current Avg Cost) * Absolute Units Sold
            const absoluteUnits = Math.abs(tx.units);
            const realized = (tx.price - (h.avgCost || 0)) * absoluteUnits;

            h.realizedPnl += realized;
            h.units -= absoluteUnits;
            h.totalCost -= (absoluteUnits * (h.avgCost || 0));

            // Attach realized pnl to the transaction object in memory for history rendering
            tx.realizedPnl = realized;

            if (h.units <= 0) {
                h.units = 0;
                h.totalCost = 0;
                h.avgCost = 0;
            } else {
                h.avgCost = h.totalCost / h.units;
            }
        }
    });

    return holdings;
}

function calculateAnalytics() {
    const monthly = {};
    STATE.portfolio.forEach(tx => {
        if (tx.type === 'sell' && tx.realizedPnl !== undefined) {
            const date = new Date(tx.date);
            const monthKey = date.toLocaleString('default', { month: 'long', year: 'numeric' });
            if (!monthly[monthKey]) monthly[monthKey] = 0;
            monthly[monthKey] += tx.realizedPnl;
        }
    });
    return monthly;
}

function addTransaction(action, asset, units, price) {
    STATE.portfolio.push({
        id: Date.now(),
        asset: asset,
        units: units,
        price: price,
        date: new Date().toISOString(),
        type: action
    });

    savePortfolio();
    renderAll();
}

function deleteTransaction(id) {
    STATE.portfolio = STATE.portfolio.filter(t => t.id !== id);
    savePortfolio();
    renderAll();
}

/* ══════════════════════════════════════════════
   PRICE FETCHING
   ══════════════════════════════════════════════ */
// ... (fetch logic remains same)

async function fetchPrices() {
    const tickers = Object.values(STATE.prices).map(p => p.sym);
    try {
        const r = await fetch(CONFIG.API, {
            method: 'POST',
            body: JSON.stringify({
                symbols: { tickers },
                columns: ["close"]
            })
        });
        if (r.ok) {
            const res = await r.json();
            if (res.data) {
                res.data.forEach(item => {
                    const price = item.d[0];
                    const asset = Object.keys(STATE.prices).find(k => STATE.prices[k].sym === item.s);
                    if (asset) STATE.prices[asset].cur = price;
                });
            }
        }
    } catch (e) {
        console.error("TV Fetch Error", e);
    }
}

async function updatePrices() {
    await fetchPrices();

    ELEMENTS.lastUpdated.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
    renderAll();
}

/* ══════════════════════════════════════════════
   RENDERING
   ══════════════════════════════════════════════ */

function fmt(n, dec = 2) {
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec
    }).format(n);
}

function renderAll() {
    renderPortfolio();
    renderAnalytics();
    renderHistory();
}

function renderPortfolio() {
    const holdings = calculateHoldings();
    ELEMENTS.container.innerHTML = '';

    for (const [asset, data] of Object.entries(holdings)) {
        if (data.units === 0 && data.realizedPnl === 0) continue;

        const curPrice = STATE.prices[asset].cur || data.avgCost;
        const curVal = data.units * curPrice;
        const unrealizedPnl = curVal - (data.units * data.avgCost);
        const unrealizedPct = data.units > 0 ? (unrealizedPnl / (data.units * data.avgCost)) * 100 : 0;
        const isUp = unrealizedPnl >= 0;

        const isGold = asset.toLowerCase().includes('gold');
        const isSilver = asset.toLowerCase().includes('silver');

        const card = document.createElement('div');
        card.className = 'portfolio-card';
        card.innerHTML = `
            <div class="asset-info">
                <div class="asset-icon ${isGold ? 'gold' : isSilver ? 'silver' : 'other'}">
                    <i class="fa-solid fa-box-archive"></i>
                </div>
                <div>
                    <div class="asset-title">${asset}</div>
                    <div class="pnl-summary">
                        <span class="pnl-badge-inline ${isUp ? 'up' : 'down'}">
                            Unrealized: ${isUp ? '+' : ''}₹${fmt(unrealizedPnl)} (${unrealizedPct.toFixed(2)}%)
                        </span>
                    </div>
                </div>
            </div>
            
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">Holdings</span>
                    <span class="stat-value">${fmt(data.units, 0)} Units</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Avg. Cost</span>
                    <span class="stat-value">₹${fmt(data.avgCost)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Current Value</span>
                    <span class="stat-value large">₹${fmt(curVal)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Realized Profit</span>
                    <span class="stat-value ${data.realizedPnl >= 0 ? 'text-up' : 'text-down'}">₹${fmt(data.realizedPnl)}</span>
                </div>
            </div>
        `;
        ELEMENTS.container.appendChild(card);
    }

    if (ELEMENTS.container.innerHTML === '') {
        ELEMENTS.container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-parachute-box"></i>
                <p>No active holdings. Add a transaction above to start tracking.</p>
            </div>
        `;
    }
}

function renderAnalytics() {
    const monthly = calculateAnalytics();
    const analyticsContainer = document.getElementById('analytics-container');
    if (!analyticsContainer) return;

    analyticsContainer.innerHTML = '';
    const months = Object.keys(monthly).sort((a, b) => new Date(b) - new Date(a));

    if (months.length === 0) {
        analyticsContainer.innerHTML = '<div class="empty-analytics">No closed trades yet.</div>';
        return;
    }

    months.forEach(month => {
        const profit = monthly[month];
        const card = document.createElement('div');
        card.className = 'analytics-card';
        card.innerHTML = `
            <div class="analytics-month">${month}</div>
            <div class="analytics-profit ${profit >= 0 ? 'up' : 'down'}">
                ${profit >= 0 ? '+' : ''}₹${fmt(profit)}
            </div>
        `;
        analyticsContainer.appendChild(card);
    });
}

function renderHistory() {
    if (STATE.portfolio.length === 0) {
        ELEMENTS.list.innerHTML = '';
        return;
    }

    const sorted = [...STATE.portfolio].sort((a, b) => new Date(b.date) - new Date(a.date));

    ELEMENTS.list.innerHTML = sorted.map(tx => {
        const pnlBadge = tx.type === 'sell' && tx.realizedPnl !== undefined ?
            `<span class="tx-pnl ${tx.realizedPnl >= 0 ? 'up' : 'down'}">${tx.realizedPnl >= 0 ? '+' : ''}₹${fmt(tx.realizedPnl)}</span>`
            : '';

        return `
            <div class="transaction-item">
                <div class="tx-info">
                    <div class="tx-asset-row">
                        <span class="tx-asset">${tx.asset}</span>
                        <span class="tx-type ${tx.type}">${tx.type.toUpperCase()}</span>
                    </div>
                    <div class="tx-details">${fmt(tx.units, 0)} units @ ₹${fmt(tx.price)} • ${new Date(tx.date).toLocaleDateString()}</div>
                </div>
                <div class="tx-actions">
                    ${pnlBadge}
                    <button class="btn-delete" onclick="deleteTransaction(${tx.id})" title="Delete entry">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/* ══════════════════════════════════════════════
   EVENTS & INITIALIZATION
   ══════════════════════════════════════════════ */

ELEMENTS.form.addEventListener('submit', (e) => {
    e.preventDefault();

    const action = ELEMENTS.inputAction.value;
    const asset = ELEMENTS.inputAsset.value;
    const units = parseFloat(ELEMENTS.inputUnits.value);
    const price = parseFloat(ELEMENTS.inputPrice.value);

    if (units > 0 && price > 0) {
        addTransaction(action, asset, units, price);

        // Reset inputs but keep asset/action as is for convenience
        ELEMENTS.inputUnits.value = '';
        ELEMENTS.inputPrice.value = '';

        // Visual feedback
        ELEMENTS.form.style.opacity = '0.5';
        setTimeout(() => ELEMENTS.form.style.opacity = '1', 300);
    }
});

// Global scope for onclick
window.deleteTransaction = deleteTransaction;

// Theme logic
function initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    ELEMENTS.themeIcon.className = saved === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';

    ELEMENTS.themeBtn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        ELEMENTS.themeIcon.className = next === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    });
}

function startClock() {
    setInterval(() => {
        const now = new Date();
        const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
        const ist = new Date(utcMs + 5.5 * 3600 * 1000);
        const hh = String(ist.getHours()).padStart(2, '0');
        const mm = String(ist.getMinutes()).padStart(2, '0');
        const ss = String(ist.getSeconds()).padStart(2, '0');
        ELEMENTS.clock.textContent = `${hh}:${mm}:${ss} IST`;
    }, 1000);
}

let cd = CONFIG.INTERVAL / 1000;
function startCountdown() {
    setInterval(() => {
        cd--;
        if (cd < 0) {
            cd = CONFIG.INTERVAL / 1000;
            updatePrices();
        }
        ELEMENTS.countdown.textContent = cd;
    }, 1000);
}

// Init
initTheme();
startClock();
startCountdown();
updatePrices();
renderAll();
