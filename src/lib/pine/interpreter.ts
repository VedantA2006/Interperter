// @ts-nocheck
import { ASTNode, Program, BlockStatement, Expression, Statement } from './types';
import { Environment, Value } from './environment';
import { Bar } from '../market-data/types';

export interface StrategyContext {
  position_size: number;
  position_avg_price?: number;
  equity?: number;
  netprofit?: number;
  entry: (id: string, direction: 'long' | 'short', qty?: number, tp?: number, sl?: number, entryPrice?: number) => void;
  close: (id: string) => void;
  exit: (id: string, stop?: number, limit?: number) => void;
  closeAll: () => void;
  cancel: (id: string) => void;
}

export class InterpreterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterpreterError';
  }
}

class ReturnException extends Error {
  public value: Value;
  constructor(value: Value) {
    super('Return');
    this.name = 'ReturnException';
    this.value = value;
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
  private MAX_OPS_PER_BAR = 100000;
  
  // Series storage for history tracking
  private seriesStore: Map<string, any[]> = new Map();
  
  // State for built-in functions — keyed by callSite index
  private statefulFunctions: Map<string, any> = new Map();
  
  // Per-bar call counter so each ta.sma() call gets a unique stable key
  private smaCallCounter: number = 0;
  private crossCallCounter: number = 0;
  private plotCallCounter: number = 0;
  
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
  private mtfData?: Record<string, Bar[]>;

  constructor(program: Program, bars: Bar[], strategyCtx: StrategyContext, mtfData?: Record<string, Bar[]>) {
    this.program = program;
    this.bars = bars;
    this.strategy = strategyCtx;
    this.mtfData = mtfData;
    this.globalEnv = new Environment();
  }

  public runBar(barIndex: number): Environment {
    this.currentBarIndex = barIndex;
    this.opsCount = 0;
    this.smaCallCounter = 0;
    this.crossCallCounter = 0;
    this.plotCallCounter = 0;
    
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
        
        env.set('log', (val: any) => console.log('PINE LOG:', val));
        
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
        const wrapMath = (fn: Function, args: any[]) => {
          if (args.some(a => a === null)) return null;
          return fn(...args);
        };
        const wrapMinMax = (fn: Function, args: any[]) => {
          const valid = args.filter(a => a !== null);
          return valid.length > 0 ? fn(...valid) : null;
        };

        env.set('math', {
          min: (...args: any[]) => wrapMinMax(Math.min, args),
          max: (...args: any[]) => wrapMinMax(Math.max, args),
          abs: (x: any) => wrapMath(Math.abs, [x]),
          floor: (x: any) => wrapMath(Math.floor, [x]),
          ceil: (x: any) => wrapMath(Math.ceil, [x]),
          round: (x: any) => wrapMath(Math.round, [x]),
          sqrt: (x: any) => wrapMath(Math.sqrt, [x]),
          pow: (x: any, y: any) => wrapMath(Math.pow, [x, y]),
          log: (x: any) => wrapMath(Math.log, [x]),
          exp: (x: any) => wrapMath(Math.exp, [x]),
          sin: (x: any) => wrapMath(Math.sin, [x]),
          cos: (x: any) => wrapMath(Math.cos, [x]),
          tan: (x: any) => wrapMath(Math.tan, [x])
        });
        env.set('year', (t: any) => new Date(t).getFullYear());
        env.set('month', (t: any) => new Date(t).getMonth() + 1);
        
        env.set('array', {
          new_float: (size?: number, def?: number) => new Array(size || 0).fill(def !== undefined ? def : null),
          new_int: (size?: number, def?: number) => new Array(size || 0).fill(def !== undefined ? def : null),
          new_color: (size?: number, def?: any) => new Array(size || 0).fill(def !== undefined ? def : null),
          new_bool: (size?: number, def?: boolean) => new Array(size || 0).fill(def !== undefined ? def : null),
          new_string: (size?: number, def?: string) => new Array(size || 0).fill(def !== undefined ? def : null),
          new: (size?: number, def?: any) => new Array(size || 0).fill(def !== undefined ? def : null),
          push: (arr: any[], val: any) => { if (Array.isArray(arr)) arr.push(val); },
          pop: (arr: any[]) => Array.isArray(arr) ? arr.pop() : null,
          shift: (arr: any[]) => Array.isArray(arr) ? arr.shift() : null,
          unshift: (arr: any[], val: any) => { if (Array.isArray(arr)) arr.unshift(val); },
          get: (arr: any[], index: number) => Array.isArray(arr) ? arr[index] : null,
          set: (arr: any[], index: number, val: any) => { if (Array.isArray(arr)) arr[index] = val; },
          size: (arr: any[]) => Array.isArray(arr) ? arr.length : 0,
          clear: (arr: any[]) => { if (Array.isArray(arr)) arr.length = 0; },
          min: (arr: any[]) => Array.isArray(arr) && arr.length ? Math.min(...arr.filter(x => x !== null)) : null,
          max: (arr: any[]) => Array.isArray(arr) && arr.length ? Math.max(...arr.filter(x => x !== null)) : null,
          sum: (arr: any[]) => Array.isArray(arr) && arr.length ? arr.reduce((a,b) => a + (b||0), 0) : null,
          avg: (arr: any[]) => {
             if (!Array.isArray(arr) || !arr.length) return null;
             const valid = arr.filter(x => typeof x === 'number');
             return valid.length ? valid.reduce((a,b) => a + b, 0) / valid.length : null;
          },
          indexof: (arr: any[], val: any) => Array.isArray(arr) ? arr.indexOf(val) : -1
        });
        
        env.set('request', {
          security: (symbol: string, timeframe: string, expression: any) => {
             // Mocking request.security to avoid crashes by returning the evaluated expression on current timeframe
             return expression;
          }
        });
        
        // Add strategy context object reference
        env.set('strategy', this.strategy as any);
        env.set('indicator', () => null);
        env.set('alertcondition', () => null);
        env.set('plot', (value: any) => {
          const key = `plot_${this.plotCallCounter++}`;
          this.recordIndicator(key, typeof value === 'number' ? value : null);
          return value;
        });
        env.set('plotshape', (condition: any) => {
          const key = `plotshape_${this.plotCallCounter++}`;
          this.recordIndicator(key, this.isTruthy(condition) ? 1 : null);
          return null;
        });
    }
    
    env.set('barstate', {
      isconfirmed: true,
      islast: barIndex === this.bars.length - 1,
    });
    env.set('bar_index', barIndex);

    this.eval(this.program, env);
    
    // Sweep environment to record final variable values for this bar's series
    // Only tracking numbers, strings, bools, and objects (like UDT instances)
    for (const [key, val] of env.entries()) {
       if (
          typeof val === 'number' || 
          typeof val === 'string' || 
          typeof val === 'boolean' ||
          (typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Date))
       ) {
          if (!this.seriesStore.has(key)) {
             this.seriesStore.set(key, new Array(this.currentBarIndex).fill(null));
          }
          const arr = this.seriesStore.get(key)!;
          while (arr.length <= this.currentBarIndex) arr.push(null);
          arr[this.currentBarIndex] = val;
       }
    }
    
    // Also sweep globalEnv to record `var` variables
    for (const [key, val] of this.globalEnv.entries()) {
       if (
          typeof val === 'number' || 
          typeof val === 'string' || 
          typeof val === 'boolean' ||
          (typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Date))
       ) {
          if (!this.seriesStore.has(key)) {
             this.seriesStore.set(key, new Array(this.currentBarIndex).fill(null));
          }
          const arr = this.seriesStore.get(key)!;
          while (arr.length <= this.currentBarIndex) arr.push(null);
          arr[this.currentBarIndex] = val;
       }
    }
    
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
      case 'SwitchStatement':
        return this.evalSwitchStatement(node as any, env);
      case 'ReturnStatement':
        const returnVal = (node as any).argument ? this.eval((node as any).argument, env) : null;
        throw new ReturnException(returnVal);
      case 'TupleAssignment':
      case 'TupleDeclaration': {
        const identifiers = (node as any).identifiers;
        const val = this.eval((node as any).value, env) as any[];
        
        if (!Array.isArray(val)) {
          throw new InterpreterError('Tuple assignment requires an array value');
        }
        
        for (let i = 0; i < identifiers.length; i++) {
          const name = identifiers[i].name;
          const valItem = i < val.length ? val[i] : null;
          
          if (node.type === 'TupleAssignment') {
            if (!env.update(name, valItem)) env.set(name, valItem);
            if (this.globalEnv.get(name) !== undefined) this.globalEnv.set(name, valItem);
          } else {
            env.set(name, valItem);
          }
        }
        return val;
      }
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
      case 'TypeDeclaration': {
        const typeName = (node as any).identifier.name;
        const fields = (node as any).fields;
        
        const typeObj = {
          new: (...args: any[]) => {
            const instance: any = { _type: typeName };
            fields.forEach((field: any, i: number) => {
              const fieldName = field.identifier.name;
              if (i < args.length && args[i] !== undefined) {
                 instance[fieldName] = args[i];
              } else if (field.defaultValue) {
                 instance[fieldName] = this.eval(field.defaultValue, env);
              } else {
                 instance[fieldName] = null;
              }
            });
            return instance;
          }
        };
        env.set(typeName, typeObj);
        if (this.globalEnv.get(typeName) !== undefined) {
           this.globalEnv.set(typeName, typeObj);
        }
        return null;
      }
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

  private evalSwitchStatement(node: any, env: Environment): Value {
    let matchValue: Value = undefined;
    if (node.expression) {
       matchValue = this.eval(node.expression, env);
    }
    
    for (const c of node.cases) {
      if (node.expression) {
         const caseVal = this.eval(c.condition, env);
         if (caseVal === matchValue) {
           return this.evalBlockStatement(c.consequence, env);
         }
      } else {
         const condition = this.eval(c.condition, env);
         if (this.isTruthy(condition)) {
           return this.evalBlockStatement(c.consequence, env);
         }
      }
    }
    
    if (node.defaultCase) {
      return this.evalBlockStatement(node.defaultCase, env);
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

  private evalMemberExpression(node: any, env: Environment): Value {
    const obj = this.eval(node.object, env) as any;
    if (!obj) return null;
    const propName = node.property.name;
    // In Pine, member access could be a function call wrapper, or direct field access (UDT)
    if (typeof obj[propName] !== 'undefined') {
       return obj[propName];
    }
    return null;
  }

  private evalArrayAccess(node: any, env: Environment): Value {
    const array = this.eval(node.array, env) as any[];
    const index = this.eval(node.index, env) as number;
    if (Array.isArray(array) && typeof index === 'number') {
       return array[index] ?? null;
    }
    return null;
  }

  private evalFunctionDeclaration(node: any, env: Environment): Value {
    const func = (...args: any[]) => {
      const funcEnv = new Environment(env);
      node.parameters.forEach((param: any, i: number) => {
        funcEnv.set(param.name, args[i]);
      });
      try {
        return this.evalBlockStatement(node.body, funcEnv);
      } catch (e: any) {
        if (e instanceof ReturnException) {
          return e.value;
        }
        throw e;
      }
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
    if (['=', ':=', '+=', '-=', '*=', '/='].includes(node.operator)) {
      const rightVal = this.eval(node.right, env) as number | null;
      let targetVal = rightVal;
      
      if (node.operator !== '=' && node.operator !== ':=') {
         const leftVal = this.eval(node.left, env) as number | null;
         if (leftVal === null || rightVal === null) targetVal = null;
         else if (node.operator === '+=') targetVal = leftVal + rightVal;
         else if (node.operator === '-=') targetVal = leftVal - rightVal;
         else if (node.operator === '*=') targetVal = leftVal * rightVal;
         else if (node.operator === '/=') targetVal = rightVal === 0 ? null : leftVal / rightVal;
      }
      
      if (node.left.type === 'Identifier') {
         const name = node.left.name;
         if (node.operator === '=') {
            // let the VariableDeclaration handler deal with = for simple idents, 
            // except if it parsed as a binary expression (which shouldn't happen for var declarations)
            return targetVal; 
         }
         if (env.update(name, targetVal)) {
            if (this.globalEnv.get(name) !== undefined) this.globalEnv.set(name, targetVal);
         } else {
            env.set(name, targetVal);
         }
         return targetVal;
      } else if (node.left.type === 'MemberExpression') {
         const obj = this.eval(node.left.object, env) as any;
         if (obj) obj[node.left.property.name] = targetVal;
         return targetVal;
      } else if (node.left.type === 'ArrayAccess') {
         const arr = this.eval(node.left.array, env) as any[];
         const idx = this.eval(node.left.index, env) as number;
         if (Array.isArray(arr) && typeof idx === 'number') arr[idx] = targetVal;
         return targetVal;
      }
      
      return targetVal;
    }
    
    const left = this.eval(node.left, env);
    const right = this.eval(node.right, env);

    if (node.operator === 'and') return this.isTruthy(left) && this.isTruthy(right);
    if (node.operator === 'or') return this.isTruthy(left) || this.isTruthy(right);
    if (node.operator === '==') return left === right;
    if (node.operator === '!=') return left !== right;

    // Propagate na for arithmetic and comparison
    if (left === null || right === null) return null;

    const L = left as number;
    const R = right as number;

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
      if (obj === 'request' && prop === 'security') {
          const symbol = this.eval(node.arguments[0], env);
          const timeframe = this.eval(node.arguments[1], env) as string;
          
          if (!this.mtfData || !this.mtfData[timeframe]) {
              return this.eval(node.arguments[2], env);
          }
          
          const currentTime = this.bars[this.currentBarIndex].time;
          const mtfBars = this.mtfData[timeframe];
          
          let targetIndex = -1;
          for (let i = 0; i < mtfBars.length; i++) {
              if (mtfBars[i].time <= currentTime) targetIndex = i;
              else break;
          }
          
          if (targetIndex === -1) return null;
          
          const oldBars = this.bars;
          const oldIndex = this.currentBarIndex;
          this.bars = mtfBars;
          this.currentBarIndex = targetIndex;
          
          const mtfBar = mtfBars[targetIndex];
          const oldOpen = env.get('open');
          const oldHigh = env.get('high');
          const oldLow = env.get('low');
          const oldClose = env.get('close');
          const oldVol = env.get('volume');
          const oldTime = env.get('time');
          
          env.set('open', mtfBar.open);
          env.set('high', mtfBar.high);
          env.set('low', mtfBar.low);
          env.set('close', mtfBar.close);
          env.set('volume', mtfBar.volume);
          env.set('time', mtfBar.time);
          
          const result = this.eval(node.arguments[2], env);
          
          this.bars = oldBars;
          this.currentBarIndex = oldIndex;
          env.set('open', oldOpen);
          env.set('high', oldHigh);
          env.set('low', oldLow);
          env.set('close', oldClose);
          env.set('volume', oldVol);
          env.set('time', oldTime);
          
          return result;
      }

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
        } else if (prop === 'close_all') {
          strat.closeAll();
          return null;
        } else if (prop === 'exit') {
          strat.exit(
              args[0] as string, 
              args[1] as string, 
              args[2] as number,
              args[3] as number,
              args[4] as number,
              args[5] as number,
              args[6] as number
          );
          return null;
        }
      } else if (obj === 'ta') {
         if (prop === 'pivothigh') return this.callPivotHigh(args);
         if (prop === 'pivotlow') return this.callPivotLow(args);
         if (prop === 'atr') return this.callAtr(args);
        if (prop === 'highest') return this.callWindow(args, 'highest');
        if (prop === 'lowest') return this.callWindow(args, 'lowest');
        if (prop === 'sum') return this.callWindow(args, 'sum');
        if (prop === 'change') return this.callChange(args);
        if (prop === 'macd') return this.callMacd(args);
        if (prop === 'vwap') return this.callVwap(args);
        if (prop === 'dev') return this.callDev(args);
        if (prop === 'variance') return this.callVariance(args);
        if (prop === 'stdev') return this.callStdev(args);
        if (prop === 'cci') return this.callCci(args);
        if (prop === 'tr') return this.callTr(args);
        if (prop === 'roc') return this.callRoc(args);
        if (prop === 'wma') return this.callWma(args);
        if (prop === 'kc') return this.callKc(args);
        if (prop === 'supertrend') return this.callSupertrend(args);
        if (prop === 'rma') return this.callRma(args);
        if (prop === 'hma') return this.callHma(args);
        if (prop === 'bb') return this.callBb(args);
        if (prop === 'stoch') return this.callStoch(args);
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
      if (funcName === 'nz') {
        const val = args[0];
        const replacement = args.length > 1 ? args[1] : 0;
        return (val === null || val === undefined || Number.isNaN(val)) ? replacement : val;
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
    // Handling history access like close[1] or x[1]
    const lookback = this.eval(node.index, env) as number;
    if (typeof lookback !== 'number' || lookback < 0) return null;
    
    if (node.object.type === 'Identifier') {
      const objName = node.object.name;
      
      // Built-in price series
      if (['open', 'high', 'low', 'close', 'volume', 'time'].includes(objName)) {
        const targetIndex = this.currentBarIndex - lookback;
        if (targetIndex < 0) return null;
        return (this.bars[targetIndex] as any)[objName];
      }
      
      // User-defined series
      const historyArr = this.seriesStore.get(objName);
      if (historyArr) {
         const targetIndex = this.currentBarIndex - lookback;
         if (targetIndex < 0) return null;
         return historyArr[targetIndex] !== undefined ? historyArr[targetIndex] : null;
      }
    } else if (node.object.type === 'FunctionCall') {
       // A robust implementation would use AST IDs. Here we throw a helpful Pine-specific error.
       throw new InterpreterError(`History operator [] directly on function calls is currently unsupported. Please assign the result to a variable first.`);
    }
    
    return null;
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

  private callWindow(args: any[], mode: 'highest' | 'lowest' | 'sum'): number | null {
    const siteKey = `${mode}_${this.smaCallCounter++}`;
    const value = args[0] as number | null;
    const period = Math.max(1, Number(args[1] ?? 1));
    if (!this.statefulFunctions.has(siteKey)) this.statefulFunctions.set(siteKey, { series: [] });
    const state = this.statefulFunctions.get(siteKey);
    if (state.series.length <= this.currentBarIndex) state.series.push(value);
    const values = state.series.slice(-period).filter((item: number | null): item is number => item !== null && item !== undefined);
    if (values.length < period) {
      this.recordIndicator(siteKey, null);
      return null;
    }
    const result = mode === 'highest'
      ? Math.max(...values)
      : mode === 'lowest'
        ? Math.min(...values)
        : values.reduce((total: number, item: number) => total + item, 0);
    this.recordIndicator(siteKey, result);
    return result;
  }

  private callChange(args: any[]): number | null {
    const siteKey = `change_${this.smaCallCounter++}`;
    const value = args[0] as number | null;
    if (!this.statefulFunctions.has(siteKey)) this.statefulFunctions.set(siteKey, { previous: null });
    const state = this.statefulFunctions.get(siteKey);
    const result = state.previous === null || value === null ? null : value - state.previous;
    state.previous = value;
    this.recordIndicator(siteKey, result);
    return result;
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
  
  private callMacd(args: any[]): [number | null, number | null, number | null] {
    const src = args[0] as number;
    const fastLen = (args[1] as number) || 12;
    const slowLen = (args[2] as number) || 26;
    const sigLen = (args[3] as number) || 9;
    
    const fastEma = this.callEma([src, fastLen]);
    const slowEma = this.callEma([src, slowLen]);
    
    let macd = null;
    if (fastEma !== null && slowEma !== null) {
      macd = fastEma - slowEma;
    }
    
    const signal = macd !== null ? this.callEma([macd, sigLen]) : null;
    const hist = macd !== null && signal !== null ? macd - signal : null;
    return [macd, signal, hist];
  }

  private callVwap(args: any[]): number | null {
    const siteKey = `vwap_${this.smaCallCounter++}`;
    const src = args[0] as number; // typically hlc3
    const bar = this.bars[this.currentBarIndex];
    
    if (!this.statefulFunctions.has(siteKey)) {
      this.statefulFunctions.set(siteKey, { sumVol: 0, sumSrcVol: 0, lastSessionStart: 0 });
    }
    const state = this.statefulFunctions.get(siteKey);
    
    // Simplistic VWAP: reset daily (assuming session starts when day changes for this mockup)
    const currentDay = new Date(bar.time).getDate();
    if (state.lastSessionStart !== currentDay) {
      state.sumVol = 0;
      state.sumSrcVol = 0;
      state.lastSessionStart = currentDay;
    }
    
    state.sumVol += bar.volume;
    state.sumSrcVol += (src * bar.volume);
    
    return state.sumVol === 0 ? src : state.sumSrcVol / state.sumVol;
  }

  private callDev(args: any[]): number | null {
    const siteKey = `dev_${this.smaCallCounter++}`;
    const src = args[0] as number;
    const length = args[1] as number;
    
    if (!this.statefulFunctions.has(siteKey)) this.statefulFunctions.set(siteKey, { series: [] });
    const state = this.statefulFunctions.get(siteKey);
    if (state.series.length <= this.currentBarIndex) state.series.push(src);
    
    const values = state.series.slice(-length).filter((v: number | null): v is number => v !== null);
    if (values.length < length) return null;
    
    const mean = values.reduce((a: number, b: number) => a + b, 0) / length;
    const absDiffSum = values.reduce((a: number, b: number) => a + Math.abs(b - mean), 0);
    return absDiffSum / length;
  }

  private callVariance(args: any[]): number | null {
    const siteKey = `var_${this.smaCallCounter++}`;
    const src = args[0] as number;
    const length = Math.max(1, (args[1] as number) || 1);
    
    if (!this.statefulFunctions.has(siteKey)) this.statefulFunctions.set(siteKey, { series: [] });
    const state = this.statefulFunctions.get(siteKey);
    if (state.series.length <= this.currentBarIndex) state.series.push(src);
    
    const values = state.series.slice(-length).filter((v: number | null): v is number => v !== null);
    if (values.length < length) return null;
    
    const mean = values.reduce((a: number, b: number) => a + b, 0) / length;
    const sqDiffSum = values.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0);
    return sqDiffSum / length; // Pine's variance is population variance
  }

  private callStdev(args: any[]): number | null {
    const variance = this.callVariance(args);
    return variance !== null ? Math.sqrt(variance) : null;
  }

  private callCci(args: any[]): number | null {
    const src = args[0] as number;
    const length = args[1] as number;
    const sma = this.callSma([src, length]);
    const dev = this.callDev([src, length]);
    
    if (sma === null || dev === null || dev === 0) return null;
    return (src - sma) / (0.015 * dev);
  }

  private callTr(args: any[]): number | null {
    const handleNaN = args[0]; // passing true handles NaNs, omitted here for simplicity
    const bar = this.bars[this.currentBarIndex];
    const prevBar = this.currentBarIndex > 0 ? this.bars[this.currentBarIndex - 1] : null;
    if (!prevBar) return bar.high - bar.low;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevBar.close), Math.abs(bar.low - prevBar.close));
  }

  private callRoc(args: any[]): number | null {
    const siteKey = `roc_${this.smaCallCounter++}`;
    const src = args[0] as number;
    const length = (args[1] as number) || 14;
    
    if (!this.statefulFunctions.has(siteKey)) this.statefulFunctions.set(siteKey, { series: [] });
    const state = this.statefulFunctions.get(siteKey);
    if (state.series.length <= this.currentBarIndex) state.series.push(src);
    
    if (state.series.length <= length) return null;
    const prior = state.series[this.currentBarIndex - length];
    if (prior === 0 || prior === null) return null;
    return ((src - prior) / prior) * 100;
  }

  private callWma(args: any[]): number | null {
    const siteKey = `wma_${this.smaCallCounter++}`;
    const src = args[0] as number;
    const length = (args[1] as number) || 9;
    
    if (!this.statefulFunctions.has(siteKey)) this.statefulFunctions.set(siteKey, { series: [] });
    const state = this.statefulFunctions.get(siteKey);
    if (state.series.length <= this.currentBarIndex) state.series.push(src);
    
    const values = state.series.slice(-length).filter((v: number | null): v is number => v !== null);
    if (values.length < length) return null;
    
    let norm = 0.0;
    let sum = 0.0;
    for (let i = 0; i < length; i++) {
        const weight = (i + 1) * length;
        norm += weight;
        sum += values[i] * weight;
    }
    return sum / norm;
  }

  private callKc(args: any[]): [number | null, number | null, number | null] {
    const series = args[0] as number;
    const length = (args[1] as number) || 20;
    const mult = (args[2] as number) || 2.0;
    const useTrueRange = args[3] !== false; // defaults to true in TradingView
    
    const basis = this.callEma([series, length]);
    let range = 0;
    if (useTrueRange) {
        range = this.callTr([]) as number;
    } else {
        const bar = this.bars[this.currentBarIndex];
        range = bar.high - bar.low;
    }
    const rangeEma = this.callEma([range, length]);
    
    if (basis === null || rangeEma === null) return [null, null, null];
    return [basis, basis + rangeEma * mult, basis - rangeEma * mult];
  }

  private callSupertrend(args: any[]): [number | null, number | null] {
    const siteKey = `st_${this.smaCallCounter++}`;
    const factor = (args[0] as number) || 3;
    const atrPeriod = (args[1] as number) || 10;
    
    const atr = this.callAtr([atrPeriod]);
    if (atr === null) return [null, null];
    
    const bar = this.bars[this.currentBarIndex];
    const hl2 = (bar.high + bar.low) / 2;
    const basicUpperband = hl2 + factor * atr;
    const basicLowerband = hl2 - factor * atr;
    
    if (!this.statefulFunctions.has(siteKey)) {
        this.statefulFunctions.set(siteKey, {
           lowerBand: basicLowerband,
           upperBand: basicUpperband,
           supertrend: 0,
           direction: 1 // 1 for long, -1 for short
        });
    }
    
    const state = this.statefulFunctions.get(siteKey);
    const prevBar = this.currentBarIndex > 0 ? this.bars[this.currentBarIndex - 1] : null;
    const prevClose = prevBar ? prevBar.close : bar.close;
    
    let lowerBand = basicLowerband;
    if (basicLowerband < state.lowerBand && prevClose > state.lowerBand) {
       lowerBand = state.lowerBand;
    }
    
    let upperBand = basicUpperband;
    if (basicUpperband > state.upperBand && prevClose < state.upperBand) {
       upperBand = state.upperBand;
    }
    
    let direction = state.direction;
    if (direction === 1 && bar.close < lowerBand) direction = -1;
    else if (direction === -1 && bar.close > upperBand) direction = 1;
    
    state.lowerBand = lowerBand;
    state.upperBand = upperBand;
    state.direction = direction;
    state.supertrend = direction === 1 ? lowerBand : upperBand;
    
    return [state.supertrend, direction];
  }
  
  private callRma(args: any[]): number | null {
    const siteKey = `rma_${this.smaCallCounter++}`;
    const val = args[0] as number;
    const period = args[1] as number;
    const alpha = 1 / period;
    
    if (!this.statefulFunctions.has(siteKey)) {
      this.statefulFunctions.set(siteKey, { prev: null });
    }
    const state = this.statefulFunctions.get(siteKey);
    let result = val;
    if (state.prev !== null) {
        result = alpha * val + (1 - alpha) * state.prev;
    }
    state.prev = result;
    this.recordIndicator(siteKey, result);
    return result;
  }
  
  private callBb(args: any[]): [number|null, number|null, number|null] {
     const series = args[0] as number;
     const length = args[1] as number;
     const mult = args[2] as number;
     
     const basis = this.callSma([series, length]);
     const dev = this.callStdev([series, length]);
     
     if (basis === null || dev === null) return [null, null, null];
     
     return [basis, basis + mult * dev, basis - mult * dev];
  }
  
  private callStoch(args: any[]): number | null {
     const source = args[0] as number;
     const high = args[1] as number;
     const low = args[2] as number;
     const length = args[3] as number;
     
     const highest = this.callWindow([high, length], 'highest');
     const lowest = this.callWindow([low, length], 'lowest');
     
     if (highest === null || lowest === null || highest === lowest) return null;
     
     return 100 * (source - lowest) / (highest - lowest);
  }
  
  private callHma(args: any[]): number | null {
      // Mocking hma as wma for interpreter simplicity
      return this.callWma(args);
  }
}
