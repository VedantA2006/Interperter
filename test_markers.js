const http = require('http');

async function test() {
  const dataRes = await fetch('http://localhost:3000/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId: 2, viewTimeframe: '5m' })
  });
  const dataJson = await dataRes.json();
  const data = dataJson.bars;
  
  const btRes = await fetch('http://localhost:3000/api/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId: 2, timeframe: '5m', sourceCode: `
//@version=5
strategy("Custom", overlay=true)
sma = ta.sma(close, 20)
if ta.crossover(close, sma)
    strategy.entry("LONG", strategy.long)
if ta.crossunder(close, sma)
    strategy.close("LONG")
` })
  });
  const btJson = await btRes.json();
  console.log(btJson);
  const trades = btJson.metrics?.trades || [];
  
  const toSec = (time) => {
    if (typeof time === 'string') return new Date(time).getTime() / 1000;
    if (typeof time === 'number') return time > 1e10 ? Math.floor(time / 1000) : time;
    return time;
  };
  
  const dataTimes = new Set(data.map(d => toSec(d.time)));
  let match = 0;
  for (const t of trades) {
    if (dataTimes.has(toSec(t.entryTime))) match++;
  }
  console.log('Total trades:', trades.length);
  console.log('Matches:', match);
  if (trades.length > 0) {
    console.log('Sample data time:', toSec(data[30].time));
    console.log('Sample trade time:', toSec(trades[0].entryTime));
  }
}
test().catch(console.error);
