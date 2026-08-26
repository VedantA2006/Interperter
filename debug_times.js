const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  
  let backtestData = null;
  
  page.on('response', async resp => {
    if (resp.url().includes('/api/backtest') && resp.status() === 200) {
      try {
        backtestData = await resp.json();
      } catch(e) {}
    }
  });
  
  await page.goto('http://localhost:3000');
  await page.waitForSelector('button:has-text("Run Backtest")', { timeout: 15000 });
  
  const select = await page.$('select');
  if (select) { await select.selectOption({ index: 1 }); await page.waitForTimeout(500); }
  
  await page.$eval('button:has-text("Run Backtest")', el => el.click());
  await page.waitForResponse(r => r.url().includes('/api/backtest') && r.status() === 200, { timeout: 30000 });
  
  if (backtestData) {
    console.log('Total candles:', backtestData.bars?.length);
    console.log('Total trades:', backtestData.metrics?.trades?.length);
    
    // Show first 5 bar times
    const bars = backtestData.bars || [];
    const trades = backtestData.metrics?.trades || [];
    console.log('First 3 candle times:', bars.slice(0, 3).map(b => b.time));
    console.log('Last 3 candle times:', bars.slice(-3).map(b => b.time));
    
    if (trades.length > 0) {
      console.log('First 3 trade entryTimes:', trades.slice(0, 3).map(t => ({ entryTime: t.entryTime, exitTime: t.exitTime })));
    }
    
    // Check if trade times match candle times
    const candleTimes = new Set(bars.map(b => {
      const t = b.time;
      return typeof t === 'number' ? (t > 1e10 ? Math.floor(t/1000) : t) : Math.floor(Date.parse(t)/1000);
    }));
    
    let matched = 0;
    trades.forEach(t => {
      const tSec = typeof t.entryTime === 'number' ? (t.entryTime > 1e10 ? Math.floor(t.entryTime/1000) : t.entryTime) : Math.floor(Date.parse(t.entryTime)/1000);
      if (candleTimes.has(tSec)) matched++;
    });
    console.log(`Trades matching candle times: ${matched}/${trades.length}`);
  }
  
  await browser.close();
})();
