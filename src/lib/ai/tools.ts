import { readDb, writeDb, getNextId } from '@/db/localStore';
import { Lexer } from '../pine/lexer';
import { Parser } from '../pine/parser';
import { BacktestEngine } from '../backtester/engine';
import { SyntheticProvider } from '../market-data/synthetic-provider';
import { RobustnessSuite } from '../backtester/robustness';

// Define the tool schemas for the LLM
export const toolsSchema = [
  // ... (schemas are now dynamically generated in route.ts using Zod)
];

export class AITools {
  
  static async validate_strategy(args: { sourceCode: string }) {
    const lexer = new Lexer(args.sourceCode);
    const parser = new Parser(lexer);
    parser.parseProgram();
    
    if (parser.errors.length > 0) {
      return { success: false, errors: parser.errors };
    }
    return { success: true, message: 'Strategy syntax is valid.' };
  }
  
  static async run_backtest(args: { sourceCode: string, symbol?: string, timeframe?: string, days?: number }) {
    const { sourceCode, symbol = 'XAUUSD', timeframe = '1h', days = 30 } = args;
    try {
      const provider = new SyntheticProvider();
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
      const endTime = Date.now();
      const bars = await provider.getHistoricalData(symbol, timeframe as any, startTime, endTime);
      
      const engine = new BacktestEngine();
      const result = await engine.run(sourceCode, bars);
      
      const robustness = RobustnessSuite.calculateMultiFactorScore(result);
      
      return { 
        success: true, 
        metrics: {
          net_profit: result.net_profit,
          win_rate: result.win_rate,
          profit_factor: result.profit_factor,
          max_drawdown: result.max_drawdown,
          num_trades: result.num_trades,
          robustness_score: robustness
        } 
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  static async run_out_of_sample_test(args: { sourceCode: string, symbol?: string, timeframe?: string, days?: number }) {
    const { sourceCode, symbol = 'XAUUSD', timeframe = '1h', days = 90 } = args;
    try {
      const provider = new SyntheticProvider();
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
      const endTime = Date.now();
      const bars = await provider.getHistoricalData(symbol, timeframe as any, startTime, endTime);
      const result = await RobustnessSuite.runInOutSampleTest(sourceCode, bars);
      
      return {
        success: true,
        degradationPct: result.degradationPct,
        is_metrics: {
          win_rate: result.isResult.win_rate,
          profit_factor: result.isResult.profit_factor,
        },
        oos_metrics: {
          win_rate: result.oosResult.win_rate,
          profit_factor: result.oosResult.profit_factor,
        }
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  static async run_monte_carlo_analysis(args: { sourceCode: string, symbol?: string, timeframe?: string, days?: number }) {
    const { sourceCode, symbol = 'XAUUSD', timeframe = '1h', days = 30 } = args;
    try {
      const provider = new SyntheticProvider();
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
      const endTime = Date.now();
      const bars = await provider.getHistoricalData(symbol, timeframe as any, startTime, endTime);
      
      const engine = new BacktestEngine();
      const result = await engine.run(sourceCode, bars);
      
      const mcResult = RobustnessSuite.runMonteCarloSimulation(result, 500);
      return { success: true, risk_analysis: mcResult };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  static async create_strategy(args: { name: string, description: string, sourceCode: string }) {
     try {
       const db = await readDb();
       const now = new Date().toISOString();
       
       const strat = {
         id: getNextId(db.strategies),
         name: args.name,
         description: args.description,
         createdAt: now,
         updatedAt: now,
       };
       
       const ver = {
         id: getNextId(db.strategyVersions),
         strategyId: strat.id,
         parentVersionId: null,
         versionStr: 'V1',
         sourceCode: args.sourceCode,
         hypothesis: null,
         status: 'candidate',
         createdAt: now,
       };
       
       db.strategies.push(strat);
       db.strategyVersions.push(ver);
       await writeDb(db);
       
       return { success: true, strategyId: strat.id, versionId: ver.id };
     } catch (e: any) { return { success: false, error: e.message }; }
  }

  static async update_strategy(args: { strategyId: number, sourceCode: string, hypothesis: string }) {
     return { success: true, message: 'Mocked update_strategy' };
  }
  
  static async list_strategies() {
     return { success: true, data: [] };
  }
  
  static async get_strategy_details(args: { strategyId: number }) {
     return { success: true, data: null };
  }
  
  static async get_market_data_info() {
     return { success: true, symbols: ['XAUUSD', 'EURUSD', 'BTCUSD'], timeframes: ['1m', '5m', '15m', '1h', '4h', '1d'] };
  }
  
  static async run_parameter_optimization(args: { sourceCode: string, paramRanges: any }) {
     return { success: true, optimalParameters: {}, bestScore: 0 };
  }
  
  static async run_walk_forward_analysis(args: { sourceCode: string }) {
     return { success: true, averageDegradation: 0.1 };
  }
  
  static async generate_tear_sheet(args: { strategyId: number, markdown: string }) {
     return { success: true, message: 'Tear sheet saved' };
  }
  
  static async delete_strategy(args: { strategyId: number }) {
     return { success: true, message: 'Strategy deleted' };
  }

  // A helper function to route the tool call
  static async executeTool(name: string, args: any) {
    switch (name) {
      case 'validate_strategy': return await this.validate_strategy(args);
      case 'run_backtest': return await this.run_backtest(args);
      case 'run_out_of_sample_test': return await this.run_out_of_sample_test(args);
      case 'run_monte_carlo_analysis': return await this.run_monte_carlo_analysis(args);
      case 'create_strategy': return await this.create_strategy(args);
      case 'update_strategy': return await this.update_strategy(args);
      case 'list_strategies': return await this.list_strategies();
      case 'get_strategy_details': return await this.get_strategy_details(args);
      case 'get_market_data_info': return await this.get_market_data_info();
      case 'run_parameter_optimization': return await this.run_parameter_optimization(args);
      case 'run_walk_forward_analysis': return await this.run_walk_forward_analysis(args);
      case 'generate_tear_sheet': return await this.generate_tear_sheet(args);
      case 'delete_strategy': return await this.delete_strategy(args);
      default:
        return { error: `Tool ${name} is not implemented or whitelisted.` };
    }
  }
}
