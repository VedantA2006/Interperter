import { SyntheticProvider } from './lib/market-data/synthetic-provider';
import { BacktestEngine } from './lib/backtester/engine';

async function run() {
  console.log('--- AI Pine Platform Verification (v2) ---');
  
  const provider = new SyntheticProvider();
  const startTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const bars = await provider.getHistoricalData('XAUUSD', '1h', startTime, Date.now());
  console.log(`Generated ${bars.length} bars.`);
  
  const strategyCode = `
//@version=5
strategy("Crossover Strategy", overlay=true)

fast = ta.sma(close, 10)
slow = ta.sma(close, 20)

if fast != null and slow != null
    if ta.crossover(fast, slow)
        strategy.entry("Long", strategy.long)
    if ta.crossover(slow, fast)
        strategy.close("Long")
`;
  
  console.log('\nStrategy Code:');
  console.log(strategyCode);
  
  console.log('\nRunning Backtest Engine...');
  const engine = new BacktestEngine();
  
  try {
    const result = await engine.run(strategyCode, bars);
    console.log('\n--- Backtest Results ---');
    console.log(`Net Profit:      $${result.net_profit.toFixed(2)}`);
    console.log(`Total Return:    ${result.total_return.toFixed(2)}%`);
    console.log(`Max Drawdown:    ${(result.max_drawdown * 100).toFixed(2)}%`);
    console.log(`Win Rate:        ${(result.win_rate * 100).toFixed(2)}%`);
    console.log(`Profit Factor:   ${result.profit_factor.toFixed(2)}`);
    console.log(`Total Trades:    ${result.num_trades}`);
  } catch (error) {
    console.error('\n[ERROR] Backtest Failed:', error);
  }
}

run();
