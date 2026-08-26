const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  
  page.on('console', msg => console.log('[BROWSER]', msg.text()));
  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));
  
  await page.goto('http://localhost:3000');
  await page.waitForSelector('button:has-text("Run Backtest")', { timeout: 15000 });
  
  // Select first dataset
  const select = await page.$('select');
  if (select) {
    await select.selectOption({ index: 1 });
    await page.waitForTimeout(500);
  }
  
  // Click Run Backtest
  await page.$eval('button:has-text("Run Backtest")', el => el.click());
  console.log('Clicked Run Backtest');
  
  // Wait for the backtest API call to complete
  try {
    console.log('Waiting for backtest network request...');
    await page.waitForResponse(response => 
      response.url().includes('/api/backtest') && response.status() === 200,
      { timeout: 30000 }
    );
    console.log('Backtest request completed successfully!');
  } catch (e) {
    console.log('Backtest request timeout or failed.');
  }

  // Wait a bit more for React to render the new state
  await page.waitForTimeout(3000);
  
  // Check actual SVG content  
  const svgInfo = await page.evaluate(() => {
    const svgEls = document.querySelectorAll('svg');
    let svgEl = Array.from(svgEls).find(s => s.querySelector('.trade-markers'));
    if (!svgEl) return { error: 'No chart SVG found' };
    
    const allText = svgEl.querySelectorAll('text');
    const tradeMarkers = svgEl.querySelectorAll('[id^="trade-marker-"]');
    const tradeBoxes = svgEl.querySelectorAll('[id^="trade-box-"]');
    
    return {
      svgExists: true,
      svgWidth: svgEl.getAttribute('width'),
      svgHeight: svgEl.getAttribute('height'),
      totalTextElements: allText.length,
      tradeMarkerCount: tradeMarkers.length,
      tradeBoxCount: tradeBoxes.length,
      // First few text elements
      firstTexts: Array.from(allText).slice(0, 5).map(t => ({
        id: t.id,
        display: t.style.display,
        content: t.textContent?.trim()
      }))
    };
  });
  
  console.log('SVG info:', JSON.stringify(svgInfo, null, 2));
  
  // Also check if trades state is actually set
  const tradesCount = await page.evaluate(() => {
    // Look for trades count in the UI
    const tradesEl = document.querySelector('[class*="total"]');
    return tradesEl ? tradesEl.textContent : 'not found';
  });
  console.log('Trades count element:', tradesCount);

  await browser.close();
})();
