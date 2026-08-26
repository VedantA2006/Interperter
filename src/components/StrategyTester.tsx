import React, { useCallback } from 'react';
import styles from './StrategyTester.module.css';

export interface BacktestMetrics {
  net_profit: number;
  net_profit_pct: number;
  total_return: number;
  max_drawdown: number;
  win_rate: number;
  loss_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  num_trades: number;
  avg_trade: number;
  largest_win: number;
  largest_loss: number;
  avg_win: number;
  avg_loss: number;
  indicatorSeries?: Record<string, (number | null)[]>;
  trades: Array<{
    id: string;
    entryTime: number;
    entryPrice: number;
    exitTime: number;
    exitPrice: number;
    direction: 'long' | 'short';
    pnl: number;
    pnlPct: number;
    size?: number;
  }>;
}

interface StrategyTesterProps {
  metrics: BacktestMetrics | null;
  isLoading?: boolean;
}

function fmt$(val: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(val);
}
function fmtPct(val: number) { return (val * 100).toFixed(2) + '%'; }
function fmtDate(ms: number) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function StrategyTester({ metrics, isLoading = false }: StrategyTesterProps) {

  const exportCSV = useCallback(() => {
    if (!metrics?.trades?.length) return;
    const header = ['#', 'Direction', 'Entry Time', 'Entry Price', 'Exit Time', 'Exit Price', 'Size', 'PnL ($)', 'PnL (%)', 'Cum. PnL ($)'];
    let cumPnl = 0;
    const rows = metrics.trades.map((t, i) => {
      cumPnl += t.pnl;
      return [
        i + 1,
        t.direction.toUpperCase(),
        fmtDate(t.entryTime),
        t.entryPrice.toFixed(5),
        fmtDate(t.exitTime),
        t.exitPrice.toFixed(5),
        t.size ?? 1,
        t.pnl.toFixed(2),
        fmtPct(t.pnlPct),
        cumPnl.toFixed(2),
      ].join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `trades_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [metrics]);

  if (isLoading) return <div className={styles.emptyState}>Running backtest…</div>;
  if (!metrics)  return <div className={styles.emptyState}>Run a backtest to see results here.</div>;

  const isProfit = metrics.net_profit >= 0;

  return (
    <div className={styles.container}>
      {/* ── Metrics Grid ── */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Net Profit</div>
          <div className={`${styles.metricValue} ${isProfit ? styles.positive : styles.negative}`}>
            {fmt$(metrics.net_profit)}<span className={styles.metricSub}>{metrics.total_return.toFixed(2)}%</span>
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Max Drawdown</div>
          <div className={`${styles.metricValue} ${styles.negative}`}>{fmtPct(metrics.max_drawdown)}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Profit Factor</div>
          <div className={styles.metricValue}>
            {metrics.profit_factor === Infinity ? '∞' : metrics.profit_factor.toFixed(2)}
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Sharpe Ratio</div>
          <div className={styles.metricValue}>{metrics.sharpe_ratio.toFixed(2)}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Win Rate</div>
          <div className={styles.metricValue}>{fmtPct(metrics.win_rate)}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Total Trades</div>
          <div className={styles.metricValue}>{metrics.num_trades}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Avg Trade</div>
          <div className={`${styles.metricValue} ${metrics.avg_trade >= 0 ? styles.positive : styles.negative}`}>
            {fmt$(metrics.avg_trade)}
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Avg Win / Avg Loss</div>
          <div className={styles.metricValue}>
            <span className={styles.positive}>{fmt$(metrics.avg_win)}</span>
            {' / '}
            <span className={styles.negative}>{fmt$(metrics.avg_loss)}</span>
          </div>
        </div>
      </div>

      {/* ── Trade List header ── */}
      <div className={styles.tradeListHeader}>
        <span className={styles.tradeListTitle}>
          Trades ({metrics.trades.length})
        </span>
        {metrics.trades.length > 0 && (
          <button id="export-csv-btn" className={styles.csvBtn} onClick={exportCSV} title="Export trades to CSV">
            ↓ Export CSV
          </button>
        )}
      </div>

      {/* ── Trade Table ── */}
      <div className={styles.tradeList}>
        {metrics.trades.length === 0 ? (
          <div className={styles.noTrades}>No trades generated. Check your strategy logic.</div>
        ) : (
          <table className={styles.tradeTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>Entry Time</th>
                <th>Entry $</th>
                <th>Exit Time</th>
                <th>Exit $</th>
                <th>PnL</th>
                <th>Cum. PnL</th>
              </tr>
            </thead>
            <tbody>
              {metrics.trades.map((trade, i) => {
                const cumPnl = metrics.trades.slice(0, i + 1).reduce((s, t) => s + t.pnl, 0);
                const isWin  = trade.pnl >= 0;
                return (
                  <tr key={i} className={isWin ? styles.rowWin : styles.rowLoss}>
                    <td>{i + 1}</td>
                    <td>
                      <span className={trade.direction === 'long' ? styles.directionLong : styles.directionShort}>
                        {trade.direction === 'long' ? '▲ LONG' : '▼ SHORT'}
                      </span>
                    </td>
                    <td className={styles.timeCell}>{fmtDate(trade.entryTime)}</td>
                    <td className={styles.priceCell}>{trade.entryPrice.toFixed(2)}</td>
                    <td className={styles.timeCell}>{fmtDate(trade.exitTime)}</td>
                    <td className={styles.priceCell}>{trade.exitPrice.toFixed(2)}</td>
                    <td className={isWin ? styles.pnlPositive : styles.pnlNegative}>
                      {isWin ? '+' : ''}{fmt$(trade.pnl)}<br/>
                      <span style={{ fontSize: '0.68rem', opacity: 0.75 }}>{fmtPct(trade.pnlPct)}</span>
                    </td>
                    <td className={cumPnl >= 0 ? styles.pnlPositive : styles.pnlNegative}>
                      {fmt$(cumPnl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
