const http = require('http');
const fs = require('fs');

async function test() {
  const code = fs.readFileSync('src/app/page.tsx', 'utf8').match(/const DEFAULT_CODE = \`([\s\S]*?)\`/)[1];

  const btRes = await fetch('http://localhost:3000/api/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId: 2, timeframe: '5m', sourceCode: code })
  });
  const btJson = await btRes.json();
  const drawings = btJson.metrics?.drawings;
  console.log('Boxes:', drawings?.boxes?.length);
  console.log('Labels:', drawings?.labels?.length);
  if (drawings?.boxes?.length) {
    console.log('Trades:', btJson.metrics?.trades?.length); console.log('Sample trade:', btJson.metrics?.trades[0]); console.log('Sample Label:', drawings.labels[0]);
  }
}
test().catch(console.error);
