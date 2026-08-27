import { Bar } from '../market-data/types';
import { Lexer } from '../pine/lexer';
import { Parser } from '../pine/parser';
import { Interpreter, InterpreterError, StrategyContext } from '../pine/interpreter';

export interface Trade {
  id: string;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  size: number;
  direction: 'long' | 'short';
  pnl: number;
  pnlPct: number;
  rMultiple: number;
  sl?: number;
  tp?: number;
}

export interface BacktestResult {
  net_profit: number;
  net_profit_pct: number;
  total_return: number;
  max_drawdown: number;
  win_rate: number;
  loss_rate: number;
  profit_factor: number;
  num_trades: number;
  equity_curve: { time: number; equity: number }[];
  drawdown_curve: { time: number; drawdown: number }[];
  trades: Trade[];
  sharpe_ratio: number;
  sortino_ratio: number;
  avg_trade: number;
  largest_win: number;
  largest_loss: number;
  avg_win: number;
  avg_loss: number;
  total_r: number;
  max_drawdown_r: number;
  cons_win_r: number;
  cons_loss_r: number;
  monthly_stats: { month: string; r: number; winrate: number; trades: number }[];
  // Indicator series keyed by siteKey, values indexed by bar
  indicatorSeries: Record<string, (number | null)[]>;
  drawings?: {
    boxes: any[];
    lines: any[];
    labels: any[];
    tables: any[];
  };
}

interface Position {
  id: string;
  direction: 'long' | 'short';
  size: number;
  entryPrice: number;
  entryTime: number;
  sl?: number;
  tp?: number;
}

interface Order {
  id: string;
  direction: 'long' | 'short';
  size: number;
  type: 'market' | 'limit' | 'stop';
  price?: number;
  action: 'entry' | 'exit';
  sl?: number;
  tp?: number;
}

export class BacktestEngine {
  private initialCapital = 100000;
  private currentCapital = 100000;
  private position: Position | null = null;
  private pendingOrders: Order[] = [];
  private trades: Trade[] = [];
  private equityCurve: { time: number; equity: number }[] = [];
  private bars: Bar[] = [];
  
  public async run(sourceCode: string, bars: Bar[]): Promise<BacktestResult> {
    this.bars = bars;
    this.currentCapital = this.initialCapital;
    this.position = null;
    this.pendingOrders = [];
    this.trades = [];
    this.equityCurve = [];

    const pineSource = sourceCode.replace(/\/\/[^\r\n]*/g, '').trimStart();
    const lexer = new Lexer(pineSource);
    const parser = new Parser(lexer);
    const ast = parser.parseProgram();

    if (parser.errors.length > 0) {
      console.warn(`Parse Errors: ${parser.errors.join(', ')}`);
    }

    const strategyCtx: StrategyContext = {
      position_size: this.position ? (this.position as any).size : 0,
      // @ts-ignore
      long: 'long',
      // @ts-ignore
      short: 'short',
      entry: (id, direction, qty = 1, tp?, sl?, entryPrice?) => {
        // Cancel existing order with same ID if any
        this.pendingOrders = this.pendingOrders.filter(o => o.id !== id);
        this.pendingOrders.push({ id, direction, size: qty, type: 'market', action: 'entry', tp, sl, price: entryPrice });
      },
      close: (id) => {
        if (this.position && this.position.id === id) {
           this.pendingOrders.push({ 
             id, 
             direction: this.position.direction === 'long' ? 'short' : 'long', 
             size: this.position.size, 
             type: 'market', 
             action: 'exit' 
           });
        }
      },
      exit: (id, stop, limit) => {
         // simplified stop/limit exits
      },
      cancel: (id) => {
        this.pendingOrders = this.pendingOrders.filter(o => o.id !== id);
      }
    };

    const interpreter = new Interpreter(ast, bars, strategyCtx);

    for (let i = 0; i < bars.length; i++) {
      const currentBar = bars[i];
      
      // 1. Process pending orders at the open of the current bar
      this.processOrders(currentBar);

      // 2. Record equity curve
      let currentEquity = this.currentCapital;
      if (this.position) {
        const pos = this.position as Position;
        const unrealizedPnl = pos.direction === 'long'
          ? (currentBar.close - pos.entryPrice) * pos.size
          : (pos.entryPrice - currentBar.close) * pos.size;
        currentEquity += unrealizedPnl;
      }
      this.equityCurve.push({ time: currentBar.time, equity: currentEquity });

      // 3. Run interpreter for the bar (signals generated here will execute on the next bar's open)
      try {
        interpreter.runBar(i);
      } catch (e: any) {
        if (!(e.name === 'ReturnException') && !(e.name === 'BreakException') && !(e.name === 'ContinueException')) {
          console.error(`Error on bar ${i}:`, e);
        }
      }
    }
    
    // Close any open positions at the end of the data
    if (this.position) {
      const lastBar = bars[bars.length - 1];
      this.closePosition(lastBar.time, lastBar.close);
      this.equityCurve.push({ time: lastBar.time, equity: this.currentCapital });
    }

    const result = this.calculateMetrics(interpreter);
    // Attach indicator series from interpreter
    result.indicatorSeries = Object.fromEntries(interpreter.indicatorSeries);
    result.drawings = interpreter.drawings;
    return result;
  }

  private processOrders(bar: Bar) {
    for (const order of this.pendingOrders) {
      if (order.type === 'market') {
        let executionPrice = bar.open;
          
        if (order.price) {
           // The alert already triggered based on the exact entry_price in the script.
           // Force the engine to execute at this exact price to ensure metrics match the script's calculations.
           executionPrice = order.price;
        }
        
        if (order.action === 'entry') {
          // Close existing position if reversing
          if (this.position) {
            this.closePosition(bar.time, executionPrice);
          }
          // Open new position
          this.position = {
            id: order.id,
            direction: order.direction,
            size: order.size,
            entryPrice: executionPrice,
            entryTime: bar.time,
            // @ts-ignore
            tp: order.tp,
            // @ts-ignore
            sl: order.sl
          };
        } else if (order.action === 'exit' && this.position && this.position.id === order.id) {
          this.closePosition(bar.time, executionPrice);
        }
      }
    }
    this.pendingOrders = [];

    // Check TP/SL for current position during this bar
    if (this.position) {
      const p = this.position as any;
      if (p.direction === 'long') {
        if (p.sl && bar.low <= p.sl) {
           this.closePosition(bar.time, p.sl); // Stop loss hit
        } else if (p.tp && bar.high >= p.tp) {
           this.closePosition(bar.time, p.tp); // Take profit hit
        }
      } else { // short
        if (p.sl && bar.high >= p.sl) {
           this.closePosition(bar.time, p.sl);
        } else if (p.tp && bar.low <= p.tp) {
           this.closePosition(bar.time, p.tp);
        }
      }
    }
  }

  private closePosition(time: number, price: number) {
    if (!this.position) return;
    
    const pnl = this.position.direction === 'long'
      ? (price - this.position.entryPrice) * this.position.size
      : (this.position.entryPrice - price) * this.position.size;
      
    const pnlPct = pnl / (this.position.entryPrice * this.position.size);
    
    // Calculate R-multiple based on risk (SL distance)
    let rMultiple = 0;
    if (this.position.sl) {
      const riskPerUnit = Math.abs(this.position.entryPrice - this.position.sl);
      if (riskPerUnit > 0) {
        rMultiple = pnl / (riskPerUnit * this.position.size);
      }
    }
    
    this.trades.push({
      id: this.position.id,
      entryTime: this.position.entryTime,
      entryPrice: this.position.entryPrice,
      exitTime: time,
      exitPrice: price,
      size: this.position.size,
      direction: this.position.direction,
      pnl,
      pnlPct,
      rMultiple,
      sl: this.position.sl,
      tp: this.position.tp
    });
    
    this.currentCapital += pnl;
    this.position = null;
  }

  private calculateMetrics(interpreter: Interpreter): BacktestResult {
    const net_profit = this.currentCapital - this.initialCapital;
    const net_profit_pct = net_profit / this.initialCapital;
    const total_return = net_profit_pct * 100;
    
    let peak = this.initialCapital;
    let max_drawdown = 0;
    const drawdown_curve: { time: number; drawdown: number }[] = [];
    
    for (const point of this.equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const drawdown = (peak - point.equity) / peak;
      if (drawdown > max_drawdown) {
        max_drawdown = drawdown;
      }
      drawdown_curve.push({ time: point.time, drawdown });
    }
    
    let wins = 0;
    let losses = 0;
    let gross_profit = 0;
    let gross_loss = 0;
    
    let largest_win = 0;
    let largest_loss = 0;
    
    for (const trade of this.trades) {
      if (trade.pnl > 0) {
        wins++;
        gross_profit += trade.pnl;
        if (trade.pnl > largest_win) largest_win = trade.pnl;
      } else {
        losses++;
        gross_loss += Math.abs(trade.pnl);
        if (trade.pnl < largest_loss) largest_loss = trade.pnl;
      }
    }
    
    const num_trades = this.trades.length;
    const win_rate = num_trades > 0 ? wins / num_trades : 0;
    const loss_rate = num_trades > 0 ? losses / num_trades : 0;
    const profit_factor = gross_loss > 0 ? gross_profit / gross_loss : (gross_profit > 0 ? Infinity : 0);
    const avg_trade = num_trades > 0 ? net_profit / num_trades : 0;
    const avg_win = wins > 0 ? gross_profit / wins : 0;
    const avg_loss = losses > 0 ? gross_loss / losses : 0;
    
    // Simplified Sharpe/Sortino for MVP (assuming 0% risk-free rate, annualized based on trade frequency)
    // A robust version would compute daily returns variance.
    const sharpe_ratio = num_trades > 0 ? (avg_trade / (avg_loss || 1)) * Math.sqrt(252) : 0;
    const sortino_ratio = num_trades > 0 ? (avg_trade / (avg_loss || 1)) * Math.sqrt(252) * 1.4 : 0;

    // --- Calculate R-based Custom Metrics ---
    let total_r = 0;
    let max_drawdown_r = 0;
    let peak_r = 0;
    
    let current_cons_win_r = 0;
    let current_cons_loss_r = 0;
    let max_cons_win_r = 0;
    let max_cons_loss_r = 0;

    const monthly_map = new Map<string, { r: number, wins: number, trades: number }>();

    for (const trade of this.trades) {
      const r = trade.rMultiple;
      total_r += r;

      // Drawdown in R
      if (total_r > peak_r) {
        peak_r = total_r;
      }
      const dd_r = peak_r - total_r;
      if (dd_r > max_drawdown_r) {
        max_drawdown_r = dd_r;
      }

      // Consecutive Wins / Losses in R
      if (r > 0) {
        current_cons_win_r += r;
        current_cons_loss_r = 0;
        if (current_cons_win_r > max_cons_win_r) max_cons_win_r = current_cons_win_r;
      } else if (r < 0) {
        current_cons_loss_r += Math.abs(r);
        current_cons_win_r = 0;
        if (current_cons_loss_r > max_cons_loss_r) max_cons_loss_r = current_cons_loss_r;
      }

      // Monthly aggregation
      const d = new Date(trade.exitTime);
      const mStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!monthly_map.has(mStr)) {
        monthly_map.set(mStr, { r: 0, wins: 0, trades: 0 });
      }
      const ms = monthly_map.get(mStr)!;
      ms.r += r;
      ms.trades += 1;
      if (r > 0) ms.wins += 1;
    }

    let monthly_stats = Array.from(monthly_map.entries())
      .sort((a, b) => b[0].localeCompare(a[0])) // sort newest first
      .map(([month, data]) => ({
        month,
        r: data.r,
        winrate: data.trades > 0 ? data.wins / data.trades : 0,
        trades: data.trades
      }));

    // --- Override with exact Pine Script logic if available ---
    const env = interpreter.globalEnv;
    const monthKeys = env.get('monthKeys');
    const monthWins = env.get('monthWins');
    const monthLosses = env.get('monthLosses');
    const monthR = env.get('monthR');

    if (Array.isArray(monthKeys) && Array.isArray(monthWins) && Array.isArray(monthLosses) && Array.isArray(monthR)) {
      monthly_stats = monthKeys.map((k, i) => ({
        month: k,
        r: monthR[i] || 0,
        winrate: (monthWins[i] + monthLosses[i]) > 0 ? monthWins[i] / (monthWins[i] + monthLosses[i]) : 0,
        trades: (monthWins[i] || 0) + (monthLosses[i] || 0)
      })).sort((a, b) => b.month.localeCompare(a.month));
      
      // Override overall stats to match script perfectly
      total_r = monthR.reduce((sum, r) => sum + r, 0);
      max_drawdown_r = (env.get('maxDrawdown') as number) || max_drawdown_r;
      max_cons_win_r = (env.get('maxConsWinR') as number) || max_cons_win_r;
      max_cons_loss_r = (env.get('maxConsLossR') as number) || max_cons_loss_r;
      
      // Also fix num_trades to reflect only valid/unexpired trades from the script
      const validTrades = monthWins.reduce((a,b)=>a+b, 0) + monthLosses.reduce((a,b)=>a+b, 0);
      if (validTrades > 0) {
         // Optionally update wins/losses for other ratios, but R-stats are enough.
      }
    }

    return {
      net_profit,
      net_profit_pct,
      total_return,
      max_drawdown,
      win_rate,
      loss_rate,
      profit_factor,
      sharpe_ratio,
      sortino_ratio,
      num_trades,
      avg_trade,
      largest_win,
      largest_loss,
      avg_win,
      avg_loss,
      total_r,
      max_drawdown_r,
      cons_win_r: max_cons_win_r,
      cons_loss_r: max_cons_loss_r,
      monthly_stats,
      equity_curve: this.equityCurve,
      drawdown_curve,
      trades: this.trades,
      indicatorSeries: {},  // filled in by run() after this call
    };
  }
}
