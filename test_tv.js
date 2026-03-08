const https = require('https');
const data = JSON.stringify({
    symbols: { tickers: ["NSE:GOLDBEES", "NSE:TATAGOLD"], query: { types: [] } },
    columns: ["close", "change_abs", "change_abs_1d", "change_percent", "change_percent_1d"]
});

const req = https.request('https://scanner.tradingview.com/india/scan', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'Mozilla/5.0'
    }
}, (res) => {
    let responseData = '';
    res.on('data', d => responseData += d);
    res.on('end', () => console.log(responseData));
});

req.write(data);
req.end();
