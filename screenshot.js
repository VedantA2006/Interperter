const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false }); // visible window
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Markers') || text.includes('Error')) console.log('[BROWSER]', text);
  });
  
  await page.goto('http://localhost:3000');
  await page.waitForSelector('button:has-text("Run Backtest")', { timeout: 15000 });
  
  const select = await page.$('select');
  if (select) { await select.selectOption({ index: 1 }); await page.waitForTimeout(500); }
  
  await page.$eval('button:has-text("Run Backtest")', el => el.click());
  console.log('Waiting for backtest...');
  await page.waitForResponse(r => r.url().includes('/api/backtest') && r.status() === 200, { timeout: 30000 });
  console.log('Backtest done!');
  
  await page.waitForTimeout(3000); // extra time for rendering
  
  // Click 5D  
  const btn5D = await page.$('button:has-text("5D")');
  if (btn5D) { await btn5D.click(); await page.waitForTimeout(1000); }
  
  await page.screenshot({ path: 'chart_screenshot.png' });
  console.log('Screenshot saved');
  await browser.close();
})();
