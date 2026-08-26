// @ts-nocheck
'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  IChartApi,
  ISeriesApi,
  Time,
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';
import styles from './Chart.module.css';

export interface ChartData {
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DatasetInfo {
  symbol?: string;
  view_timeframe?: string;
  source_timeframe?: string;
  source_name?: string;
  data_period_start?: string;
  data_period_end?: string;
  candle_count?: number;
  data_hash?: string;
}

export interface TradeMark {
  time: number;
  type: 'buy' | 'sell';
  price: number;
}

export interface TradeBox {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  direction: 'long' | 'short';
  pnl: number;
}

interface ChartProps {
  data: ChartData[];
  trades?: TradeMark[];
  tradeBoxes?: TradeBox[];
  indicatorSeries?: Record<string, (number | null)[]>;
  datasetInfo?: DatasetInfo;
  drawings?: {
    boxes: any[];
    lines: any[];
    labels: any[];
    tables: any[];
  };
}

// Distinct line colours for indicators
const INDICATOR_COLORS = [
  '#2962ff', '#f7b731', '#26c6da', '#ff6b6b', '#a29bfe', '#fd79a8', '#00cec9',
];

export function Chart({ data, trades = [], tradeBoxes = [], indicatorSeries = {}, datasetInfo, drawings }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    // ── Create chart ──────────────────────────────────────────────────────────
    const chart: IChartApi = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f1115' },
        textColor: '#8b92a5',
        fontFamily: "'Inter', 'Roboto', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e2027' },
        horzLines: { color: '#1e2027' },
      },
      crosshair: {
        vertLine: { color: '#4a5068', width: 1, style: 3 },
        horzLine: { color: '#4a5068', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: '#2c2f3a',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#2c2f3a',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 6,
        fixLeftEdge: true,
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });
    chartRef.current = chart;

    // ── Watermark ─────────────────────────────────────────────────────────────
    if (datasetInfo?.symbol) {
      chart.applyOptions({
        watermark: {
          visible: true,
          fontSize: 14,
          horzAlign: 'left',
          vertAlign: 'top',
          color: 'rgba(139,146,165,0.18)',
          text: `${datasetInfo.symbol} | ${(datasetInfo.view_timeframe || '').toUpperCase()} | HISTORICAL DATA`,
        },
      });
    }

    // ── Candlestick series ────────────────────────────────────────────────────
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    seriesRef.current = candleSeries;

    // Normalise timestamps to Unix seconds
    const toSec = (t: number | string) =>
      typeof t === 'number' ? (t > 1e10 ? Math.floor(t / 1000) : t) : Math.floor(Date.parse(t as string) / 1000);

    const formattedCandles = data
      .map(d => ({ ...d, time: toSec(d.time) as Time }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    candleSeries.setData(formattedCandles);

    // ── Indicator line series ─────────────────────────────────────────────────
    const indicatorKeys = Object.keys(indicatorSeries);
    indicatorKeys.forEach((key, idx) => {
      const vals = indicatorSeries[key];
      if (!vals || vals.length === 0) return;

      // Build time-aligned points, skipping nulls
      const lineData: { time: Time; value: number }[] = [];
      vals.forEach((v, i) => {
        if (v === null || v === undefined) return;
        if (!data[i]) return;
        lineData.push({ time: toSec(data[i].time) as Time, value: v });
      });

      if (lineData.length < 2) return;

      const color = INDICATOR_COLORS[idx % INDICATOR_COLORS.length];
      const lineSer = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: key.replace('_', ' ').toUpperCase(),
      });
      lineSer.setData(lineData);
    });

    // ── Trade markers (arrows) ────────────────────────────────────────────────
    if (trades.length > 0) {
      // Limit markers to last 500 for performance
      const recentTrades = trades.length > 500 ? trades.slice(-500) : trades;
      const markers = recentTrades
        .map(t => ({
          time: toSec(t.time) as Time,
          position: t.type === 'buy' ? 'belowBar' as const : 'aboveBar' as const,
          color: t.type === 'buy' ? '#26a69a' : '#ef5350',
          shape: t.type === 'buy' ? 'arrowUp' as const : 'arrowDown' as const,
          text: t.type === 'buy' ? '▲ BUY' : '▼ SELL',
          size: 1,
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));

      // lightweight-charts v5: use createSeriesMarkers instead of series.setMarkers
      createSeriesMarkers(candleSeries, markers);
    }

    // Price lines skipped for large trade counts (markers suffice)

    // ── Custom Drawings Overlay ──────────────────────────────────────────────
    const updateOverlays = () => {
      if (!svgRef.current || !chartRef.current || !seriesRef.current || !drawings || !data.length) return;
      const timeScale = chartRef.current.timeScale();
      const series = seriesRef.current;
      
      const toCoord = (barIndex: number) => {
        if (barIndex < 0 || barIndex >= data.length) return null;
        const t = toSec(data[barIndex].time);
        return timeScale.timeToCoordinate(t as Time);
      };

      // Boxes
      drawings.boxes?.forEach(box => {
        const el = document.getElementById(box.id);
        if (!el) return;
        const x1 = toCoord(box.left);
        const x2 = toCoord(box.right);
        const y1 = series.priceToCoordinate(box.top);
        const y2 = series.priceToCoordinate(box.bottom);
        if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
          const left = Math.min(x1, x2);
          const top = Math.min(y1, y2);
          const width = Math.max(1, Math.abs(x2 - x1));
          const height = Math.abs(y2 - y1);
          el.setAttribute('x', String(left));
          el.setAttribute('y', String(top));
          el.setAttribute('width', String(width));
          el.setAttribute('height', String(height));
          el.style.display = 'block';
        } else {
          el.style.display = 'none';
        }
      });

      // Lines
      drawings.lines?.forEach(line => {
        const el = document.getElementById(line.id);
        if (!el) return;
        const x1 = toCoord(line.x1);
        const x2 = toCoord(line.x2);
        const y1 = series.priceToCoordinate(line.y1);
        const y2 = series.priceToCoordinate(line.y2);
        if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
          el.setAttribute('x1', String(x1));
          el.setAttribute('y1', String(y1));
          el.setAttribute('x2', String(x2));
          el.setAttribute('y2', String(y2));
          el.style.display = 'block';
        } else {
          el.style.display = 'none';
        }
      });

      // Labels
      drawings.labels?.forEach(label => {
        const el = document.getElementById(label.id);
        if (!el) return;
        const x = toCoord(label.x);
        const y = series.priceToCoordinate(label.y);
        if (x !== null && y !== null) {
          // Adjust position based on style (up/down/right)
          let dy = 0;
          if (label.style === 'up') dy = 15;
          if (label.style === 'down') dy = -5;
          el.setAttribute('x', String(x));
          el.setAttribute('y', String(y + dy));
          el.style.display = 'block';
        } else {
          el.style.display = 'none';
        }
      });
    };

    chart.timeScale().subscribeVisibleTimeRangeChange(updateOverlays);
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateOverlays);
    
    // Initial update after a tiny delay to ensure chart layout is ready
    setTimeout(updateOverlays, 50);

    // ── Resize handler ────────────────────────────────────────────────────────
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
        updateOverlays();
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(updateOverlays);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateOverlays);
      chart.remove();
    };
  }, [data, trades, tradeBoxes, indicatorSeries, datasetInfo, drawings]);

  return (
    <div className={styles.wrapper} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={chartContainerRef} className={styles.container} />
      
      {/* SVG Overlay for Boxes, Lines, Labels */}
      <svg
        ref={svgRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 10
        }}
      >
        {drawings?.boxes?.map(b => (
          <rect
            key={b.id}
            id={b.id}
            fill={b.bgcolor || 'rgba(0,0,0,0)'}
            stroke={b.border_color || 'transparent'}
            strokeWidth={1}
            style={{ display: 'none' }}
          />
        ))}
        {drawings?.lines?.map(l => (
          <line
            key={l.id}
            id={l.id}
            stroke={l.color || '#ffffff'}
            strokeWidth={l.width || 1}
            strokeDasharray={l.style === 'dashed' ? '4,4' : 'none'}
            style={{ display: 'none' }}
          />
        ))}
        {drawings?.labels?.map(l => (
          <text
            key={l.id}
            id={l.id}
            fill={l.textcolor || '#ffffff'}
            fontSize={l.size === 'tiny' ? 10 : l.size === 'small' ? 11 : 12}
            fontFamily="'Inter', sans-serif"
            textAnchor="middle"
            style={{ display: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
          >
            {l.text}
          </text>
        ))}
      </svg>

      {/* HTML Overlay for Tables */}
      {drawings?.tables?.map((t, idx) => {
        const isTopRight = t.position === 'top_right';
        const isBottomRight = t.position === 'bottom_right';
        
        return (
          <table
            key={t.id || idx}
            style={{
              position: 'absolute',
              top: isTopRight ? '10px' : 'auto',
              bottom: isBottomRight ? '30px' : 'auto', // 30px to clear timescale
              right: '65px', // clear price scale
              backgroundColor: t.bgcolor || 'rgba(20,20,20,0.8)',
              border: `${t.border_width || 1}px solid ${t.border_color || '#333'}`,
              borderCollapse: 'collapse',
              color: '#fff',
              fontSize: '11px',
              fontFamily: "'Inter', sans-serif",
              zIndex: 20,
            }}
          >
            <tbody>
              {Array.from({ length: t.rows || 0 }).map((_, rIdx) => (
                <tr key={rIdx}>
                  {Array.from({ length: t.columns || 0 }).map((_, cIdx) => {
                    const cell = t.cells?.[rIdx]?.[cIdx];
                    return (
                      <td
                        key={cIdx}
                        style={{
                          padding: '4px 8px',
                          border: `${t.border_width || 1}px solid ${t.border_color || '#333'}`,
                          backgroundColor: cell?.bgcolor || 'transparent',
                          color: cell?.text_color || '#fff',
                          textAlign: 'center'
                        }}
                      >
                        {cell?.text || ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}
