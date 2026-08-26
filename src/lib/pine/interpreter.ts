// @ts-nocheck
import { ASTNode, Program, BlockStatement, Expression, Statement } from './types';
import { Environment, Value } from './environment';
import { Bar } from '../market-data/types';

export interface StrategyContext {
  position_size: number;
  entry: (id: string, direction: 'long' | 'short', qty?: number, stop?: number, limit?: number, entryPrice?: number) => void;
  close: (id: string) => void;
  exit: (id: string, stop?: number, limit?: number) => void;
  cancel: (id: string) => void;
}

export class InterpreterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterpreterError';
  }
}

class BreakException extends Error {
  constructor() {
    super('Break');
    this.name = 'BreakException';
  }
}

export class Interpreter {
  private program: Program;
  private bars: Bar[];
  private currentBarIndex: number = 0;
  private opsCount: number = 0;
  private MAX_OPS_PER_BAR = 10000;
  
  // State for built-in functions — keyed by callSite index
  private statefulFunctions: Map<string, any> = new Map();
  
  // Per-bar call counter so each ta.sma() call gets a unique stable key
  private smaCallCounter: number = 0;
  private crossCallCounter: number = 0;
  
  // Indicator series collected during backtest (exported for chart rendering)
  public indicatorSeries: Map<string, (number | null)[]> = new Map();
  
  public drawings: {
    boxes: any[];
    lines: any[];
    labels: any[];
    tables: any[];
  } = { boxes: [], lines: [], labels: [], tables: [] };
  
  public strategy: StrategyContext;
  public globalEnv: Environment;

  constructor(program: Program, bars: Bar[], strategyCtx: StrategyContext) {
    this.program = program;
    this.bars = bars;
    this.strategy = strategyCtx;
    this.globalEnv = new Environment();
  }

  public runBar(barIndex: number): Environment {
    this.currentBarIndex = barIndex;
    this.opsCount = 0;
    this.smaCallCounter = 0;
    this.crossCallCounter = 0;
    
    // We create a new environment for each bar, but initialize it with 
    // the series data for the current bar context.
    const env = this.globalEnv;
    
    // Add built-ins
    const currentBar = this.bars[barIndex];
    env.set('open', currentBar.open);
    env.set('high', currentBar.high);
    env.set('low', currentBar.low);
    env.set('close', currentBar.close);
    env.set('volume', currentBar.volume);
    env.set('time', currentBar.time);
    env.set('null', null);
    
    // Setup built-ins ONLY on the first bar to save performance
    if (barIndex === 0) {
        // Add built-in objects
        env.set('color', {
          new: (hex: string, transp: number) => hex,
          black: '#000000',
          white: '#ffffff',
          gray: '#808080',
          red: '#ff0000',
          green: '#00ff00',
          blue: '#0000ff'
        });
        env.set('size', {
          small: 'small',
          normal: 'normal',
          large: 'large'
        });
        env.set('str', {
          tostring: (val: any) => String(val),
          format: (fmt: string, ...args: any[]) => fmt
        });
        
        // Add Pine Script Mocks
        env.set('array', {
          new_string: () => [], new_int: () => [], new_float: () => [], new_bool: () => [], new_box: () => [], new_line: () => [],
          push: (arr: any[], val: any) => arr.push(val),
          shift: (arr: any[]) => arr.shift(),
          set: (arr: any[], idx: number, val: any) => { arr[idx] = val; },
          get: (arr: any[], idx: number) => arr[idx],
          size: (arr: any[]) => arr.length,
          indexof: (arr: any[], val: any) => arr.indexOf(val)
        });
        
        env.set('box', { 
          new: (left: any, top: any, right: any, bottom: any, border_color?: any, bgcolor?: any, text?: any, text_color?: any, text_size?: any, text_halign?: any, text_valign?: any) => {
             const b = { id: 'box_'+Math.random(), type: 'box', left, top, right, bottom, border_color, bgcolor, text, text_color, text_size, text_halign, text_valign };
             this.drawings.boxes.push(b);
             return b;
          },
          set_right: (b: any, right: any) => { if(b) b.right = right; }
        });
        
        env.set('line', { 
          new: (x1: any, y1: any, x2: any, y2: any, color?: any, width?: any, style?: any) => {
             const l = { id: 'line_'+Math.random(), type: 'line', x1, y1, x2, y2, color, width, style };
             this.drawings.lines.push(l);
             return l;
          },
          set_x2: (l: any, x2: any) => { if(l) l.x2 = x2; },
          style_dashed: 'dashed' 
        });
        
        env.set('label', { 
          new: (x: any, y: any, text: any, style?: any, color?: any, textcolor?: any, size?: any) => {
             const l = { id: 'label_'+Math.random(), type: 'label', x, y, text, style, color, textcolor, size };
             this.drawings.labels.push(l);
             return l;
          },
          style_label_up: 'up', style_label_down: 'down', style_label_right: 'right' 
        });
        
        env.set('table', { 
          new: (position: any, columns: any, rows: any, bgcolor?: any, border_width?: any, border_color?: any) => {
             const t = { id: 'table_'+Math.random(), type: 'table', position, columns, rows, bgcolor, border_width, border_color, cells: {} as any };
             this.drawings.tables.push(t);
             return t;
          },
          cell: (t: any, col: any, row: any, text: any, text_color?: any, text_size?: any, bgcolor?: any) => {
             if (t) {
                if (!t.cells[row]) t.cells[row] = {};
                t.cells[row][col] = { text, text_color, text_size, bgcolor };
             }
          }
        });
        env.set('position', { top_right: 'top_right', bottom_right: 'bottom_right' });
        env.set('text', { align_right: 'right', align_top: 'top', align_bottom: 'bottom' });
        env.set('size', { tiny: '10px', small: '12px', normal: '14px', large: '18px' });
        env.set('color', { 
          new: (col: any, transp: any) => {
            // Pine transparency: 0 = solid, 100 = invisible
            const t = Math.max(0, Math.min(100, transp || 0));
            const alpha = 1 - (t / 100);
            if (typeof col === 'string') {
              if (col.startsWith('#')) {
                const r = parseInt(col.slice(1,3), 16) || 0;
                const g = parseInt(col.slice(3,5), 16) || 0;
                const b = parseInt(col.slice(5,7), 16) || 0;
                return `rgba(${r},${g},${b},${alpha})`;
              }
              return col; // named color fallback
            }
            return 'rgba(0,0,0,0)';
          },
          white: 'white', black: 'black', gray: 'gray', red: 'red', green: 'green', blue: 'blue' 
        });
        env.set('log', (msg: any) => console.log('PINE LOG:', msg));
        env.set('alert', Object.assign((msg: string) => {
          try {
            console.log('ALERT RECEIVED:', msg);
            const payload = JSON.parse(msg);
            if (payload && payload.action) {
               const dir = payload.action.toLowerCase() === 'buy' ? 'long' : (payload.action.toLowerCase() === 'sell' ? 'short' : null);
               console.log('dir:', dir, 'hasStrategy:', !!this.strategy);
               if (dir && this.strategy) {
                 // @ts-ignore - tp/sl supported by backtest engine
                 this.strategy.entry(`webhook_${dir}_${barIndex}`, dir, 1, payload.tp, payload.sl, payload.entry_price);
                 console.log('called strategy.entry');
               }
            }
          } catch (e) {
            console.log('ALERT PARSE ERROR:', e.message);
          }
        }, { freq_once_per_bar: 'freq_once_per_bar' }));
        
        env.set('input', {
          int: (def: any) => def,
          float: (def: any) => def,
          bool: (def: any) => def,
          color: (def: any) => def,
          session: (def: any) => def
        });
        
        env.set('syminfo', { ticker: 'MOCK_TICKER' });
        env.set('timeframe', { period: '5' });
        env.set('math', { min: Math.min, max: Math.max });
        env.set('year', (t: any) => new Date(t).getFullYear());
        env.set('month', (t: any) => new Date(t).getMonth() + 1);
        
        // Add strategy context object reference
        env.set('strategy', this.strategy as any);
        env.set('indicator', () => null);
        env.set('alertcondition', () => null);
    }
    
    env.set('barstate', {
      isconfirmed: true,
      islast: barIndex === this.bars.length - 1,
    });
    env.set('bar_index', barIndex);

    this.eval(this.program, env);
    return env;
  }

  private eval(node: ASTNode, env: Environment): Value {
    this.opsCount++;
    if (this.opsCount > this.MAX_OPS_PER_BAR) {
      throw new InterpreterError('Execution limit exceeded on current bar');
    }

    switch (node.type as string) {
      case 'Program':
        return this.evalProgram(node as Program, env);
      case 'BlockStatement':
        return this.evalBlockStatement(node as BlockStatement, env);
      case 'ExpressionStatement':
        return this.eval((node as any).expression, env);
      case 'VariableDeclaration': {
        const varNode = node as any;
        if (varNode.isVar && this.globalEnv.get(varNode.identifier.name) !== undefined) {
           const existingVal = this.globalEnv.get(varNode.identifier.name)!;
           env.set(varNode.identifier.name, existingVal);
           return existingVal;
        }
        const val = this.eval(varNode.value, env);
        if (varNode.isVar) {
            this.globalEnv.set(varNode.identifier.name, val);
        }
        env.set(varNode.identifier.name, val);
        return val;
      }
      case 'FunctionDeclaration':
        return this.evalFunctionDeclaration(node as any, env);
      case 'Assignment': {
        const name = (node as any).identifier.name;
        const val = this.eval((node as any).value, env);
        const op = (node as any).operator;
        
        let finalVal = val;
        if (op && op !== '=' && op !== ':=') {
          const current = env.get(name) ?? 0;
          switch (op) {
            case '+=': finalVal = (current as number) + (val as number); break;
            case '-=': finalVal = (current as number) - (val as number); break;
            case '*=': finalVal = (current as number) * (val as number); break;
            case '/=': finalVal = (current as number) / (val as number); break;
          }
        }
        
        // Try to update existing var; if not found, declare it (handles := and reassignment)
        if (!env.update(name, finalVal)) {
          env.set(name, finalVal);
        }
        
        // If this variable is tracked in globalEnv (i.e. a var), we MUST update it there too so it persists
        if (this.globalEnv.get(name) !== undefined) {
           this.globalEnv.set(name, finalVal);
        }
        
        return finalVal;
      }
      case 'IfStatement':
        return this.evalIfStatement(node as any, env);
      case 'ForStatement':
        return this.evalForStatement(node as any, env);
      case 'WhileStatement':
        return this.evalWhileStatement(node as any, env);
      case 'BreakStatement':
        throw new BreakException();
      case 'Identifier':
        return this.evalIdentifier(node as any, env);
      case 'Literal':
        return (node as any).value;
      case 'BinaryExpression':
        return this.evalBinaryExpression(node as any, env);
      case 'UnaryExpression':
        return this.evalUnaryExpression(node as any, env);
      case 'FunctionCall':
        return this.evalFunctionCall(node as any, env);
      case 'MemberExpression':
        return this.evalMemberExpression(node as any, env);
      case 'ArrayAccess':
        return this.evalArrayAccess(node as any, env);
      case 'TernaryExpression':
        return this.evalTernaryExpression(node as any, env);
      default:
        throw new InterpreterError(`Unknown node type: ${node.type}`);
    }
  }

  private evalProgram(program: Program, env: Environment): Value {
    let result: Value = null;
    try {
      for (const stmt of program.body) {
        result = this.eval(stmt, env);
      }
    } catch (e: any) {
      if (e instanceof BreakException) {
        throw new InterpreterError('Break statement outside loop');
      }
      throw e;
    }
    return result;
  }

  private evalBlockStatement(block: BlockStatement, env: Environment): Value {
    let result: Value = null;
    const blockEnv = new Environment(env);
    for (const stmt of block.statements) {
      result = this.eval(stmt, blockEnv);
    }
    return result;
  }

  private evalIfStatement(node: any, env: Environment): Value {
    const condition = this.eval(node.condition, env);
    if (this.isTruthy(condition)) {
      return this.eval(node.consequence, env);
    } else if (node.alternative) {
      return this.eval(node.alternative, env);
    }
    return null;
  }

  private evalTernaryExpression(node: any, env: Environment): Value {
    const condition = this.eval(node.condition, env);
    if (this.isTruthy(condition)) {
      return this.eval(node.consequence, env);
    } else {
      return this.eval(node.alternative, env);
    }
  }

  private evalFunctionDeclaration(node: any, env: Environment): Value {
    const func = (...args: any[]) => {
      const funcEnv = new Environment(env);
      node.parameters.forEach((param: any, i: number) => {
        funcEnv.set(param.name, args[i]);
      });
      return this.evalBlockStatement(node.body, funcEnv);
    };
    env.set(node.identifier.name, func);
    return null;
  }

  private evalWhileStatement(node: any, env: Environment): Value {
    const blockEnv = new Environment(env);
    let result: Value = null;
    try {
      while (this.isTruthy(this.eval(node.condition, blockEnv))) {
        result = this.evalBlockStatement(node.body, blockEnv);
      }
    } catch (e: any) {
      if (e instanceof BreakException) {
        // Stop loop and catch break
      } else {
        throw e;
      }
    }
    return result;
  }

  private evalForStatement(node: any, env: Environment): Value {
    const startValue = this.eval(node.startValue, env);
    const endValue = this.eval(node.endValue, env);
    
    if (typeof startValue !== 'number' || typeof endValue !== 'number') {
      throw new InterpreterError('For loop bounds must be numbers');
    }
    
    const blockEnv = new Environment(env);
    let result: Value = null;
    
    try {
      const step = startValue <= endValue ? 1 : -1;
      const condition = (i: number) => step > 0 ? i <= endValue : i >= endValue;
      for (let i = startValue; condition(i); i += step) {
        blockEnv.set(node.identifier.name, i);
        result = this.evalBlockStatement(node.body, blockEnv);
      }
    } catch (e: any) {
      if (e instanceof BreakException) {
        // Stop loop
      } else {
        throw e;
      }
    }
    
    return result;
  }

  private evalIdentifier(node: any, env: Environment): Value {
    const val = env.get(node.name);
    if (val === undefined) {
      // Return null for unknown identifiers instead of crashing —
      // many Pine scripts reference variables conditionally
      return null;
    }
    return val;
  }

  private evalBinaryExpression(node: any, env: Environment): Value {
    if (node.operator === '=') {
      return this.eval(node.right, env);
    }
    
    const left = this.eval(node.left, env);
    const right = this.eval(node.right, env);

    // Null-safe: treat null as 0 for arithmetic, false for logic
    const L = (left ?? 0) as number;
    const R = (right ?? 0) as number;

    switch (node.operator) {
      case '+': return L + R;
      case '-': return L - R;
      case '*': return L * R;
      case '/': return R === 0 ? null : L / R;
      case '%': return R === 0 ? null : L % R;
      case '<':  return L < R;
      case '>':  return L > R;
      case '<=': return L <= R;
      case '>=': return L >= R;
      case '==': return left === right;
      case '!=': return left !== right;
      case 'and': return this.isTruthy(left) && this.isTruthy(right);
      case 'or':  return this.isTruthy(left) || this.isTruthy(right);
      default:   return null;
    }
  }

  private evalUnaryExpression(node: any, env: Environment): Value {
    const right = this.eval(node.argument, env);
    switch (node.operator) {
      case '-': return -(right as number);
      case 'not': return !this.isTruthy(right);
      default:
        throw new InterpreterError(`Unknown operator: ${node.operator}`);
    }
  }

  private evalFunctionCall(node: any, env: Environment): Value {
    // In our simplified Pine, we support specific built-ins like ta.sma()
    // For function calls, we use the string representation as a hacky key for state tracking
    // A better AST would assign unique IDs to each call node
    
    // Evaluate the callee to see if it's a member expression like ta.sma
    if (node.callee.type === 'MemberExpression') {
      const obj = (node.callee.object as any).name;
      const prop = (node.callee.property as any).name;
      
      const args = node.arguments.map((a: any) => this.eval(a, env));
      
      if (obj === 'ta' && prop === 'sma') {
        return this.callSma(args);
      } else if (obj === 'ta' && prop === 'ema') {
        return this.callEma(args);
      } else if (obj === 'ta' && prop === 'rsi') {
        return this.callRsi(args);
      } else if (obj === 'ta' && prop === 'crossover') {
         return this.callCrossover(args);
      } else if (obj === 'ta' && prop === 'crossunder') {
         return this.callCrossunder(args);
      } else if (obj === 'strategy') {
        const strat = env.get('strategy') as unknown as StrategyContext;
        if (prop === 'entry') {
          strat.entry(args[0] as string, args[1] as 'long'|'short', args[2] as number, args[3] as number, args[4] as number, args[5] as number);
          return null;
        } else if (prop === 'close') {
          strat.close(args[0] as string);
          return null;
        }
      } else if (obj === 'ta') {
         if (prop === 'pivothigh') return this.callPivotHigh(args);
         if (prop === 'pivotlow') return this.callPivotLow(args);
         if (prop === 'atr') return this.callAtr(args);
      }
      
      // Try to get the object from environment
      const envObj = env.get(obj);
      if (envObj && typeof envObj[prop] === 'function') {
        return envObj[prop](...args);
      }
      
    } else if (node.callee.type === 'Identifier') {
      const funcName = (node.callee as any).name;
      if (funcName === 'strategy') {
        // strategy("Title", overlay=true)
        return null; // No-op for now, it's just configuration
      }
      
      const args = node.arguments.map((a: any) => this.eval(a, env));
      
      if (funcName === 'time') {
        const barTime = this.bars[this.currentBarIndex]?.time || 0;
        if (args.length >= 2 && typeof args[1] === 'string') {
           const sessionStr = args[1];
           let tz = "America/New_York";
           if (args.length >= 3 && typeof args[2] === 'string') tz = args[2];
           
           const fmtKey = 'fmt_' + tz;
           if (!this.statefulFunctions.has(fmtKey)) {
              this.statefulFunctions.set(fmtKey, new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }));
           }
           const fmt = this.statefulFunctions.get(fmtKey);
           const parts = fmt.formatToParts(new Date(barTime));
           let h = 0, m = 0;
           for (const p of parts) {
             if (p.type === 'hour') h = parseInt(p.value, 10);
             if (p.type === 'minute') m = parseInt(p.value, 10);
           }
           if (h === 24) h = 0;
           const currMin = h * 60 + m;
           
           const partsSplit = sessionStr.split('-');
           if (partsSplit.length === 2) {
             const startStr = partsSplit[0];
             const endStr = partsSplit[1];
             const startMin = parseInt(startStr.slice(0, 2), 10) * 60 + parseInt(startStr.slice(2, 4), 10);
             const endMin = parseInt(endStr.slice(0, 2), 10) * 60 + parseInt(endStr.slice(2, 4), 10);
             let inSession = false;
             if (startMin <= endMin) {
               inSession = currMin >= startMin && currMin <= endMin;
             } else {
               inSession = currMin >= startMin || currMin <= endMin;
             }
             if (!inSession) return null;
           }
        }
        return barTime;
      }
      if (funcName === 'na') {
        return args[0] === null || args[0] === undefined;
      }
      
      const func = env.get(funcName);
      if (typeof func === 'function') {
        return func(...args);
      }
    }
    // Unknown call — return null instead of crashing
    return null;
  }

  private evalMemberExpression(node: any, env: Environment): Value {
    const obj = this.eval(node.object, env);
    const propName = node.property?.name;
    if (obj === null || obj === undefined) return null;
    if (typeof obj === 'object') {
      return (obj as any)[propName] ?? null;
    }
    return null;
  }

  private evalArrayAccess(node: any, env: Environment): Value {
    // Handling history access like close[1]
    const objName = (node.object as any).name;
    const index = this.eval(node.index, env) as number;
    
    if (['open', 'high', 'low', 'close', 'volume', 'time'].includes(objName)) {
      const targetIndex = this.currentBarIndex - index;
      if (targetIndex < 0) return null; // Or throw error/return NaN depending on preference
      return (this.bars[targetIndex] as any)[objName];
    }
    
    throw new InterpreterError(`Array access only supported for price series`);
  }

  private isTruthy(val: Value): boolean {
    if (val === null || val === false || val === 0 || val === '') return false;
    return true;
  }
  
  // -- Built-in Indicators Implementation --
  // Note: We use call stack/args conceptually to identify state, but in a real parser we'd assign an ID to the AST node
  // For this simplified version, we'll track state based on a hash of the function name.
  // In a robust implementation, the AST generator assigns a unique ID to every function call node.
  
  private callSma(args: any[], varName?: string): number | null {
    const siteKey = `sma_${this.smaCallCounter++}`;
    const val = args[0] as number;
    const period = args[1] as number;
    
    if (!this.statefulFunctions.has(siteKey)) {
      this.statefulFunctions.set(siteKey, { series: [], period: 0 });
    }
    const state = this.statefulFunctions.get(siteKey);
    state.period = period;
    
    if (state.series.length <= this.currentBarIndex) {
      state.series.push(val);
    }
    
    const series: number[] = state.series;
    if (series.length < period) {
      this.recordIndicator(siteKey, null);
      return null;
    }
    
    let sum = 0;
    for (let i = series.length - period; i < series.length; i++) {
      sum += series[i];
    }
    const result = sum / period;
    this.recordIndicator(siteKey, result);
    return result;
  }
  
  private callEma(args: any[]): number | null {
    const siteKey = `ema_${this.smaCallCounter++}`;
    const val = args[0] as number;
    const period = args[1] as number;
    const k = 2 / (period + 1);
    
    if (!this.statefulFunctions.has(siteKey)) {
      this.statefulFunctions.set(siteKey, { prev: null });
    }
    const state = this.statefulFunctions.get(siteKey);
    const result = state.prev === null ? val : val * k + state.prev * (1 - k);
    state.prev = result;
    this.recordIndicator(siteKey, result);
    return result;
  }
  
  private recordIndicator(key: string, val: number | null) {
    if (!this.indicatorSeries.has(key)) {
      this.indicatorSeries.set(key, []);
    }
    const arr = this.indicatorSeries.get(key)!;
    while (arr.length < this.currentBarIndex) arr.push(null);
    arr.push(val);
  }
  
  private callCrossover(args: any[]): boolean {
    const siteKey = `cross_${this.crossCallCounter++}`;
    const curr1 = args[0] as number | null;
    const curr2 = args[1] as number | null;
    
    if (!this.statefulFunctions.has(siteKey)) {
      this.statefulFunctions.set(siteKey, { prev1: null, prev2: null });
    }
    const state = this.statefulFunctions.get(siteKey);
    const { prev1, prev2 } = state;
    state.prev1 = curr1;
    state.prev2 = curr2;
    
    if (prev1 === null || prev2 === null || curr1 === null || curr2 === null) return false;
    return prev1 <= prev2 && curr1 > curr2;
  }
  
  private callCrossunder(args: any[]): boolean {
    const siteKey = `crossunder_${this.crossCallCounter++}`;
    const curr1 = args[0] as number | null;
    const curr2 = args[1] as number | null;
    
    if (!this.statefulFunctions.has(siteKey)) {
      this.statefulFunctions.set(siteKey, { prev1: null, prev2: null });
    }
    const state = this.statefulFunctions.get(siteKey);
    const { prev1, prev2 } = state;
    state.prev1 = curr1;
    state.prev2 = curr2;
    
    if (prev1 === null || prev2 === null || curr1 === null || curr2 === null) return false;
    return prev1 >= prev2 && curr1 < curr2;
  }
  
  private callRsi(args: any[]): number | null {
    const siteKey = `rsi_${this.smaCallCounter++}`;
    const val = args[0] as number;
    const period = args[1] as number;
    
    if (!this.statefulFunctions.has(siteKey)) {
      this.statefulFunctions.set(siteKey, { series: [], avgGain: 0, avgLoss: 0 });
    }
    const state = this.statefulFunctions.get(siteKey);
    if (state.series.length <= this.currentBarIndex) state.series.push(val);
    
    const s: number[] = state.series;
    if (s.length < period + 1) { this.recordIndicator(siteKey, null); return null; }
    
    const changes = s.slice(-period).map((v, i, a) => i === 0 ? 0 : v - a[i - 1]);
    const gains  = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
    const avgGain = gains.reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    this.recordIndicator(siteKey, rsi);
    return rsi;
  }
  
  private callPivotHigh(args: any[]): number | null {
     const siteKey = `ph_${this.smaCallCounter++}`;
     const val = args[0] as number;
     const leftbars = (args[1] as number) ?? 10;
     const rightbars = (args[2] as number) ?? 10;
     
     if (!this.statefulFunctions.has(siteKey)) {
       this.statefulFunctions.set(siteKey, { series: [] });
     }
     const state = this.statefulFunctions.get(siteKey);
     
     if (state.series.length <= this.currentBarIndex) {
       state.series.push(val);
     }
     
     const s: number[] = state.series;
     const pivotIndex = this.currentBarIndex - rightbars;
     
     if (pivotIndex < leftbars || pivotIndex < 0) return null;
     
     const pivotVal = s[pivotIndex];
     
     for (let i = 1; i <= leftbars; i++) {
        if (s[pivotIndex - i] >= pivotVal) return null;
     }
     
     for (let i = 1; i <= rightbars; i++) {
        if (s[pivotIndex + i] > pivotVal) return null;
     }
     
     return pivotVal;
  }
  
  private callPivotLow(args: any[]): number | null {
     const siteKey = `pl_${this.smaCallCounter++}`;
     const val = args[0] as number;
     const leftbars = (args[1] as number) ?? 10;
     const rightbars = (args[2] as number) ?? 10;
     
     if (!this.statefulFunctions.has(siteKey)) {
       this.statefulFunctions.set(siteKey, { series: [] });
     }
     const state = this.statefulFunctions.get(siteKey);
     
     if (state.series.length <= this.currentBarIndex) {
       state.series.push(val);
     }
     
     const s: number[] = state.series;
     const pivotIndex = this.currentBarIndex - rightbars;
     
     if (pivotIndex < leftbars || pivotIndex < 0) return null;
     
     const pivotVal = s[pivotIndex];
     
     for (let i = 1; i <= leftbars; i++) {
        if (s[pivotIndex - i] <= pivotVal) return null;
     }
     
     for (let i = 1; i <= rightbars; i++) {
        if (s[pivotIndex + i] < pivotVal) return null;
     }
     
     return pivotVal;
  }
  
  private callAtr(args: any[]): number | null {
     const period = (args[0] as number) || 14;
     const siteKey = `atr_${this.smaCallCounter++}`;
     
     if (!this.statefulFunctions.has(siteKey)) {
       this.statefulFunctions.set(siteKey, { series: [], prevAtr: null });
     }
     const state = this.statefulFunctions.get(siteKey);
     const bar = this.bars[this.currentBarIndex];
     const prevBar = this.currentBarIndex > 0 ? this.bars[this.currentBarIndex - 1] : null;
     
     let tr = bar.high - bar.low;
     if (prevBar) {
       tr = Math.max(bar.high - bar.low, Math.abs(bar.high - prevBar.close), Math.abs(bar.low - prevBar.close));
     }
     
     if (state.series.length <= this.currentBarIndex) {
       state.series.push(tr);
     }
     
     const s: number[] = state.series;
     if (s.length < period) return null;
     
     let atr = 0;
     if (state.prevAtr === null) {
       let sum = 0;
       for (let i = 0; i < period; i++) sum += s[i];
       atr = sum / period;
     } else {
       atr = (tr + (period - 1) * state.prevAtr) / period;
     }
     
     state.prevAtr = atr;
     return atr;
  }
}
