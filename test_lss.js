const fs = require('fs');
const { BacktestEngine } = require('./src/lib/backtester/engine.ts');
let code = fs.readFileSync('lss_debug.txt', 'utf8');
code = code.replace('while array.size(lvls) > maxN', 'log("trim: maxN=" + str.tostring(maxN) + " size=" + str.tostring(array.size(lvls)))\n    while array.size(lvls) > maxN');
code += '\nif bar_index < 20\n    log("BAR: " + str.tostring(bar_index) + " lookL: " + str.tostring(lookLong) + " bFvg: " + str.tostring(bullFVG) + " expBars: " + str.tostring(expireBars))';

const bars = [];
for (let i = 0; i < 1000; i++) {
  // Let's create a clear sweep and FVG
  let o = 100, h = 110, l = 90, c = 105;
  
  if (i === 10) { // Forms Pivot Low
    l = 50; c = 60; // Huge drop
  }
  if (i === 11) { // Sweeps the pivot low!
    o = 60; h = 80; l = 45; c = 75; // low < 50, close > 50
  }
  if (i === 12) { // Up candle
    o = 75; h = 100; l = 70; c = 95;
  }
  if (i === 13) { // Forms FVG!
    o = 95; h = 120; l = 85; c = 115; 
    // FVG low = 85, high[2] (i=11) is 80. So bullFVG is true! 85 > 80.
  }
  if (i === 14) { // Retrace into FVG
    o = 115; h = 115; l = 82; c = 90;
    // low <= fTop (82 <= 85), close > fBot (90 > 80)
  }

  bars.push({
    time: 1600000000 + i * 60000,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 1000
  });
}

console.log("TEST BARS:", bars.slice(10, 15).map(b => b.high));

const engine = new BacktestEngine();
engine.run(code, bars).then(result => {
    console.log('Trades:', result.trades.length);
}).catch(console.error);
