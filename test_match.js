const fs=require('fs');
const code=fs.readFileSync('src/app/page.tsx','utf8').match(/const DEFAULT_CODE = \`([\s\S]*?)\`/)[1];
fetch('http://localhost:3000/api/backtest',{method:'POST',body:JSON.stringify({datasetId:2,timeframe:'5m',sourceCode:code}),headers:{'content-type':'application/json'}})
.then(r=>r.json())
.then(d=>{
  const trades=d.metrics.trades; 
  const bars=d.bars; 
  const dataTimes=new Set(bars.map(b=>b.time)); 
  
  let match=0; 
  for(let t of trades) { 
    if(dataTimes.has(t.entryTime)) match++; 
    if(dataTimes.has(t.exitTime)) match++; 
  } 
  console.log('Matches:',match,'out of',trades.length*2, 'trades.'); 
  console.log('Example trade time:', trades[0].entryTime); 
  console.log('Example bar time matches?', dataTimes.has(trades[0].entryTime));
})
