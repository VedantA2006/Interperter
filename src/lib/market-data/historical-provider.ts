import crypto from 'crypto';
import { Bar } from './types';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface DataQualityReport {
  status: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';
  symbol: string;
  timeframe: string;
  period_start: string;
  period_end: string;
  candle_count: number;
  errors: string[];
  warnings: string[];
}

export interface ParsedDataset {
  bars: Bar[];
  report: DataQualityReport;
  data_hash: string;
}

export interface HistoricalDataProvider {
  parseCSV(csvText: string, symbol: string, timeframe: string): Promise<ParsedDataset>;
  aggregate(bars: Bar[], targetTimeframe: string): Bar[];
}

// ─── Timeframe Utilities ──────────────────────────────────────────────────────

const TIMEFRAME_MS: Record<string, number> = {
  '1m':  60 * 1000,
  '5m':  5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '4h':  4 * 60 * 60 * 1000,
  '1d':  24 * 60 * 60 * 1000,
};

// Ordered from smallest to largest — each must be a multiple of 1m
const TIMEFRAME_ORDER = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

function getIntervalMs(tf: string): number {
  return TIMEFRAME_MS[tf] ?? 60_000;
}

function formatUTC(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// ─── LocalCSVProvider ─────────────────────────────────────────────────────────

/**
 * Parses a CSV file with OHLCV historical data.
 *
 * Supports the following column orderings:
 *   timestamp, open, high, low, close[, volume]
 *   date, time, open, high, low, close[, volume]
 *
 * Timestamp may be:
 *   - Unix seconds (10 digits)
 *   - Unix milliseconds (13 digits)
 *   - ISO 8601 date strings ("2020-01-01 00:00:00")
 */
export class LocalCSVProvider implements HistoricalDataProvider {
  async parseCSV(csvText: string, symbol: string, timeframe: string): Promise<ParsedDataset> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) {
      return this.fail(symbol, timeframe, 'CSV file is empty or has no data rows.', errors, warnings);
    }

    // Detect and skip the header row
    const headerLine = lines[0];
    const isHeader = /[a-zA-Z]/.test(headerLine.split(',')[0]);
    const dataLines = isHeader ? lines.slice(1) : lines;

    if (dataLines.length === 0) {
      return this.fail(symbol, timeframe, 'No data rows found after header.', errors, warnings);
    }

    // Detect column layout
    const firstRow = dataLines[0].split(',');
    let colMap: { ts: number; open: number; high: number; low: number; close: number; volume: number | null } | null = null;

    if (firstRow.length >= 5) {
      if (firstRow.length === 5 || firstRow.length === 6) {
        // timestamp, open, high, low, close[, volume]
        colMap = { ts: 0, open: 1, high: 2, low: 3, close: 4, volume: firstRow.length > 5 ? 5 : null };
      } else if (firstRow.length >= 7) {
        // date, time, open, high, low, close[, volume]
        colMap = { ts: -1, open: 2, high: 3, low: 4, close: 5, volume: firstRow.length > 6 ? 6 : null };
      }
    }

    if (!colMap) {
      return this.fail(symbol, timeframe, `Cannot detect column layout. Got ${firstRow.length} columns per row.`, errors, warnings);
    }

    const bars: Bar[] = [];
    const timestampsSeen = new Set<number>();

    for (let i = 0; i < dataLines.length; i++) {
      const lineNo = isHeader ? i + 2 : i + 1;
      const parts = dataLines[i].split(',');

      try {
        // Parse timestamp
        let ts: number;
        if (colMap.ts === -1) {
          // date + time columns
          const dateStr = (parts[0] + ' ' + parts[1]).trim();
          ts = this.parseTimestamp(dateStr);
        } else {
          ts = this.parseTimestamp(parts[colMap.ts].trim());
        }

        if (isNaN(ts)) {
          errors.push(`Line ${lineNo}: Invalid timestamp '${parts[0]}'`);
          continue;
        }

        const open  = parseFloat(parts[colMap.open]);
        const high  = parseFloat(parts[colMap.high]);
        const low   = parseFloat(parts[colMap.low]);
        const close = parseFloat(parts[colMap.close]);
        const volume = colMap.volume !== null ? parseFloat(parts[colMap.volume]) || 0 : 0;

        // OHLC sanity checks
        if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
          errors.push(`Line ${lineNo}: Non-numeric OHLC values`);
          continue;
        }
        if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
          errors.push(`Line ${lineNo}: Non-positive OHLC values (open=${open}, high=${high}, low=${low}, close=${close})`);
          continue;
        }
        if (high < open || high < close || high < low) {
          errors.push(`Line ${lineNo}: high (${high}) must be >= open, close, and low`);
          continue;
        }
        if (low > open || low > close) {
          errors.push(`Line ${lineNo}: low (${low}) must be <= open and close`);
          continue;
        }

        // Duplicate timestamp check
        if (timestampsSeen.has(ts)) {
          errors.push(`Line ${lineNo}: Duplicate timestamp ${formatUTC(ts)}`);
          continue;
        }
        timestampsSeen.add(ts);

        bars.push({ time: ts, open, high, low, close, volume });
      } catch {
        errors.push(`Line ${lineNo}: Failed to parse row`);
      }
    }

    if (bars.length === 0) {
      return this.fail(symbol, timeframe, 'No valid candles parsed.', errors, warnings);
    }

    // Sort by time
    bars.sort((a, b) => a.time - b.time);

    // Gap detection
    const intervalMs = getIntervalMs(timeframe);
    const { gapCount, gapWarnings } = this.detectGaps(bars, intervalMs, timeframe);
    if (gapCount > 0) {
      warnings.push(...gapWarnings);
    }

    // Compute hash over the raw validated CSV content
    const data_hash = crypto.createHash('sha256').update(csvText).digest('hex');

    const status: DataQualityReport['status'] =
      errors.length > 0 ? 'INVALID' :
      warnings.length > 0 ? 'VALID_WITH_WARNINGS' : 'VALID';

    const report: DataQualityReport = {
      status,
      symbol,
      timeframe,
      period_start: formatUTC(bars[0].time),
      period_end:   formatUTC(bars[bars.length - 1].time),
      candle_count: bars.length,
      errors,
      warnings,
    };

    return { bars, report, data_hash };
  }

  /**
   * Aggregates 1m (or any base) bars into a larger timeframe.
   * Uses standard OHLCV aggregation: first open, max high, min low, last close, sum volume.
   */
  aggregate(bars: Bar[], targetTimeframe: string): Bar[] {
    const intervalMs = getIntervalMs(targetTimeframe);
    const buckets = new Map<number, Bar>();

    for (const bar of bars) {
      // Snap the bar's timestamp to the start of the target timeframe bucket
      const bucketTs = Math.floor(bar.time / intervalMs) * intervalMs;

      if (!buckets.has(bucketTs)) {
        buckets.set(bucketTs, {
          time: bucketTs,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        });
      } else {
        const b = buckets.get(bucketTs)!;
        b.high = Math.max(b.high, bar.high);
        b.low = Math.min(b.low, bar.low);
        b.close = bar.close; // last bar in bucket is the close
        b.volume = (b.volume || 0) + (bar.volume || 0);
      }
    }

    return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
  }

  /**
   * Returns the largest resolution that can be derived from the source timeframe
   * and is within the ordered TIMEFRAME_ORDER list.
   */
  static canDeriveFrom(sourceTf: string, targetTf: string): boolean {
    const sourceMs = getIntervalMs(sourceTf);
    const targetMs = getIntervalMs(targetTf);
    return targetMs >= sourceMs && targetMs % sourceMs === 0;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private parseTimestamp(raw: string): number {
    const asNum = Number(raw);
    if (!isNaN(asNum)) {
      // Unix seconds (10 digits) or Unix milliseconds (13 digits)
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    // ISO / date string
    const d = new Date(raw.replace(' ', 'T'));
    return isNaN(d.getTime()) ? NaN : d.getTime();
  }

  private detectGaps(bars: Bar[], intervalMs: number, timeframe: string): { gapCount: number; gapWarnings: string[] } {
    const gapWarnings: string[] = [];
    let gapCount = 0;

    // Allow weekend gaps for FX/metals naturally (Sat/Sun are expected)
    const WEEKEND_TOLERANCE = 3 * 24 * 60 * 60 * 1000; // 3 days

    for (let i = 1; i < bars.length; i++) {
      const expected = bars[i - 1].time + intervalMs;
      const actual = bars[i].time;
      const diff = actual - expected;

      if (diff > 0) {
        const isWeekendGap = diff <= WEEKEND_TOLERANCE;
        if (!isWeekendGap) {
          gapCount++;
          const gapBars = Math.round(diff / intervalMs);
          gapWarnings.push(
            `Gap detected between ${formatUTC(bars[i - 1].time)} and ${formatUTC(bars[i].time)} (~${gapBars} missing ${timeframe} candles)`
          );
        }
      }
    }

    if (gapCount === 0 && bars.length > 1) {
      // Check for weekend closures
      const totalExpected = (bars[bars.length - 1].time - bars[0].time) / intervalMs + 1;
      if (bars.length < totalExpected * 0.85) {
        gapWarnings.push('Weekend market closures and/or holidays have been excluded from the dataset.');
      }
    }

    return { gapCount, gapWarnings };
  }

  private fail(symbol: string, timeframe: string, errorMsg: string, errors: string[], warnings: string[]): ParsedDataset {
    errors.push(errorMsg);
    return {
      bars: [],
      data_hash: '',
      report: {
        status: 'INVALID',
        symbol,
        timeframe,
        period_start: '',
        period_end: '',
        candle_count: 0,
        errors,
        warnings,
      },
    };
  }
}

// Export timeframe helpers for use by the backtest engine
export { TIMEFRAME_ORDER, getIntervalMs };
