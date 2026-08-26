export type ChartBar = {
  time: any;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type IndicatorPoint = {
  time: any;
  value: number;
};

export function calculateSMA(data: ChartBar[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) {
      result.push(sum / period);
    } else {
      result.push(null);
    }
  }
  return result;
}

export function calculateEMA(data: ChartBar[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let ema = 0;

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      ema = data[i].close;
    } else {
      ema = (data[i].close - ema) * k + ema;
    }
    result.push(ema);
  }
  return result;
}

export function calculateBollingerBands(data: ChartBar[], period: number, stdDev: number = 2) {
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  const basis: (number | null)[] = [];
  
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    
    if (i >= period - 1) {
      const sma = sum / period;
      basis.push(sma);
      
      let variance = 0;
      for (let j = i - period + 1; j <= i; j++) {
        variance += Math.pow(data[j].close - sma, 2);
      }
      variance /= period;
      const sd = Math.sqrt(variance);
      
      upper.push(sma + sd * stdDev);
      lower.push(sma - sd * stdDev);
    } else {
      basis.push(null);
      upper.push(null);
      lower.push(null);
    }
  }
  return { upper, lower, basis };
}
