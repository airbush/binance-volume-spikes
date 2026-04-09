// ===============================================
// BINANCE VOLUME SPIKE DETECTOR (Telegram only)
// ===============================================
// Runs every 5 minutes via GitHub Actions
// 300% volume spike | Min $500k previous volume | USDT perpetual only

import axios from 'axios';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '+50244051732';
const SPIKE_THRESHOLD = 300;
const MIN_PREV_VOLUME_USDT = 500000;

async function checkBinanceVolumeSpikes() {
  console.log(`[${new Date().toISOString()}] Starting Binance volume spike check...`);

  // 1. Get all active USDT perpetual symbols
  const infoRes = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
  const symbols = infoRes.data.symbols
    .filter(s => s.status === 'TRADING' && 
                 s.contractType === 'PERPETUAL' && 
                 s.quoteAsset === 'USDT')
    .map(s => s.symbol);

  console.log(`Found ${symbols.length} USDT perpetual pairs`);

  // 2. Fetch 1h klines in chunks
  const chunkSize = 50;
  let alertsData = [];

  for (let i = 0; i < symbols.length; i += chunkSize) {
    const batch = symbols.slice(i, i + chunkSize);
    const requests = batch.map(symbol => 
      axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=2`, { timeout: 10000 })
        .catch(() => null)
    );

    const responses = await Promise.all(requests);

    responses.forEach((res, idx) => {
      if (!res || !res.data || res.data.length !== 2) return;
      const data = res.data;
      const symbol = batch[idx];

      const prevVol = parseFloat(data[0][7]);
      const curVol  = parseFloat(data[1][7]);
      const curTime = data[1][0];

      const openPrice  = parseFloat(data[1][1]);
      const closePrice = parseFloat(data[1][4]);
      const priceChangePct = openPrice > 0 ? ((closePrice - openPrice) / openPrice) * 100 : 0;

      if (prevVol >= MIN_PREV_VOLUME_USDT && curVol > 0) {
        const increasePercent = ((curVol - prevVol) / prevVol) * 100;

        if (increasePercent >= SPIKE_THRESHOLD) {
          alertsData.push({
            symbol,
            increasePercent,
            priceChangePct,
            curVol
          });
        }
      }
    });

    await new Promise(r => setTimeout(r, 150)); // gentle on Binance
  }

  // 3. Sort biggest spikes first
  alertsData.sort((a, b) => b.increasePercent - a.increasePercent);

  const triggeredAlerts = alertsData.map(d => 
    `🔥 ${d.symbol}: +${d.increasePercent.toFixed(0)}% vol | ${d.priceChangePct.toFixed(1)}% price (Vol: $${d.curVol.toLocaleString('en-US')})`
  );

  // 4. Send Telegram alert if any spikes found
  if (triggeredAlerts.length > 0) {
    const count = triggeredAlerts.length;
    const tgText = `🚨 Binance Volume Spike Alert (${count} pairs)\n\n` +
                   triggeredAlerts.join("\n") +
                   `\n\n🔍 Check dashboard: https://airbushtrading.netlify.app/`;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: tgText,
      parse_mode: 'HTML'
    });

    console.log(`✅ Sent Telegram alert — ${count} pairs spiked!`);
  } else {
    console.log('No spikes above threshold this run.');
  }
}

// Run the function
checkBinanceVolumeSpikes().catch(err => {
  console.error('Error:', err.message);
});
