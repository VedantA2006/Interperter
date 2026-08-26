import { Bar } from '../market-data/types';
import { BacktestEngine, BacktestResult } from './engine';

export interface RobustnessScore {
  compositeScore: number; // 0 to 100
  inSampleReturn: number;
  outOfSampleReturn: number;
  drawdownPenalty: number;
  stabilityScore: number;
  details: any;
}

export class RobustnessSuite {
  
  /**
   * Split data into 70% In-Sample and 30% Out-Of-Sample.
   * Returns a score based on how well the OOS performance holds up compared to IS.
   */
  static async runInOutSampleTest(sourceCode: string, bars: Bar[]): Promise<{ isResult: BacktestResult, oosResult: BacktestResult, degradationPct: number }> {
    const splitIndex = Math.floor(bars.length * 0.7);
    const isBars = bars.slice(0, splitIndex);
    const oosBars = bars.slice(splitIndex);
    
    const engine1 = new BacktestEngine();
    const isResult = await engine1.run(sourceCode, isBars);
    
    const engine2 = new BacktestEngine();
    const oosResult = await engine2.run(sourceCode, oosBars);
    
    // Calculate degradation in Profit Factor
    const isPf = isResult.profit_factor === Infinity ? 10 : isResult.profit_factor;
    const oosPf = oosResult.profit_factor === Infinity ? 10 : oosResult.profit_factor;
    
    const degradationPct = isPf > 0 ? ((isPf - oosPf) / isPf) * 100 : 100;
    
    return { isResult, oosResult, degradationPct };
  }

  /**
   * Calculates a composite multi-factor score for strategy ranking.
   */
  static calculateMultiFactorScore(result: BacktestResult): number {
    // We want to penalize high drawdown and reward high profit factor and win rate.
    // Score components (0-100 scale ideally)
    
    // 1. Return Component (Capped at 100 for scoring purposes)
    const returnScore = Math.min(Math.max(result.total_return, 0), 100);
    
    // 2. Drawdown Component (Inverts DD. 0 DD = 100 score, 50% DD = 0 score)
    const drawdownScore = Math.max(100 - (result.max_drawdown * 200), 0);
    
    // 3. Profit Factor Component (1.0 = 0 score, 3.0+ = 100 score)
    const pf = result.profit_factor === Infinity ? 5 : result.profit_factor;
    const pfScore = Math.min(Math.max((pf - 1) * 50, 0), 100);
    
    // 4. Consistency / Win Rate
    const wrScore = result.win_rate * 100;
    
    // Weights
    const wReturn = 0.3;
    const wDrawdown = 0.3;
    const wPf = 0.3;
    const wWr = 0.1;
    
    const composite = (returnScore * wReturn) + 
                      (drawdownScore * wDrawdown) + 
                      (pfScore * wPf) + 
                      (wrScore * wWr);
                      
    return isNaN(composite) ? 0 : composite;
  }

  /**
   * Runs a Monte Carlo simulation by randomly sampling the sequence of trades.
   * Useful to determine the probability of a specific maximum drawdown (Risk of Ruin).
   */
  static runMonteCarloSimulation(result: BacktestResult, simulations: number = 1000): { medianDrawdown: number, worstDrawdown: number, riskOfRuinPct: number } {
    if (result.trades.length === 0) {
      return { medianDrawdown: 0, worstDrawdown: 0, riskOfRuinPct: 0 };
    }

    const allDrawdowns: number[] = [];
    let ruinCount = 0;
    const ruinThreshold = 0.20; // 20% drawdown is considered ruin for this context

    for (let i = 0; i < simulations; i++) {
      // Create a randomized sequence of the same trades (bootstrap resampling with replacement)
      let simulatedEquity = 10000; // Starting capital
      let peak = 10000;
      let maxDrawdown = 0;

      for (let j = 0; j < result.trades.length; j++) {
        // Pick a random trade from the original list
        const randomTrade = result.trades[Math.floor(Math.random() * result.trades.length)];
        
        simulatedEquity += randomTrade.pnl;
        if (simulatedEquity > peak) {
          peak = simulatedEquity;
        }
        
        const currentDrawdown = (peak - simulatedEquity) / peak;
        if (currentDrawdown > maxDrawdown) {
          maxDrawdown = currentDrawdown;
        }
      }

      allDrawdowns.push(maxDrawdown);
      if (maxDrawdown >= ruinThreshold) {
        ruinCount++;
      }
    }

    allDrawdowns.sort((a, b) => a - b);
    const medianDrawdown = allDrawdowns[Math.floor(allDrawdowns.length / 2)];
    const worstDrawdown = allDrawdowns[allDrawdowns.length - 1];
    const riskOfRuinPct = (ruinCount / simulations) * 100;

    return { medianDrawdown, worstDrawdown, riskOfRuinPct };
  }
}
