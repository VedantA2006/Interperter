import { Bar, MarketDataProvider, Timeframe } from './types';

export class SyntheticProvider implements MarketDataProvider {
  private timeframeToMs(timeframe: Timeframe): number {
    switch (timeframe) {
      case '1m': return 60 * 1000;
      case '5m': return 5 * 60 * 1000;
      case '15m': return 15 * 60 * 1000;
      case '1h': return 60 * 60 * 1000;
      case '4h': return 4 * 60 * 60 * 1000;
      case '1d': return 24 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  }

  // Generates a predictable but pseudo-random sequence of bars
  public async getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    startTime: number,
    endTime: number
  ): Promise<Bar[]> {
    const bars: Bar[] = [];
    const intervalMs = this.timeframeToMs(timeframe);
    
    // Seed the price based on the symbol string just to have something consistent
    let currentPrice = 100;
    for (let i = 0; i < symbol.length; i++) {
      currentPrice += symbol.charCodeAt(i);
    }
    
    // Create bars
    for (let t = startTime; t <= endTime; t += intervalMs) {
      const volatility = currentPrice * 0.005; // 0.5% volatility
      
      // Pseudo-random based on time and price
      const rand1 = (Math.sin(t / 1000000) + 1) / 2; 
      const rand2 = (Math.cos(t / 2000000) + 1) / 2;
      const rand3 = (Math.sin(t / 500000) + 1) / 2;
      
      const change = (rand1 - 0.5) * volatility;
      
      const open = currentPrice;
      const close = currentPrice + change;
      
      // Ensure high and low cover the open/close
      const high = Math.max(open, close) + rand2 * volatility;
      const low = Math.min(open, close) - rand3 * volatility;
      
      const volume = Math.floor(rand1 * 10000) + 1000;
      
      bars.push({
        time: t,
        open,
        high,
        low,
        close,
        volume
      });
      
      currentPrice = close;
    }
    
    return bars;
  }
}
