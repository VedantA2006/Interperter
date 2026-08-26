// @ts-nocheck
'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
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

export interface TradeBox {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  direction: 'long' | 'short';
  pnl: number;
  tp?: number;
  sl?: number;
}

interface ChartProps {
  data: ChartData[];
  tradeBoxes?: TradeBox[];
  indicatorSeries?: Record<string, (number | null)[]>;
  datasetInfo?: DatasetInfo;
  timeRangeTrigger?: string;
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

export function Chart({ 
  data, tradeBoxes = [], indicatorSeries = {}, datasetInfo,
  timeRangeTrigger, goToTimestamp, drawings, isReplayActive, replayIndex, onSelectReplayBar,
  activeDrawingTool, userDrawings = [], setUserDrawings
}: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const updateOverlaysRef = useRef<(() => void) | null>(null);
  const tradeBoxesRef = useRef(tradeBoxes);
  tradeBoxesRef.current = tradeBoxes;
  
  // Custom interactive state
  const [crosshairParam, setCrosshairParam] = useState<any>(null);
  const [drawingPoints, setDrawingPoints] = useState<{ time: number, price: number }[]>([]);
  const [overlaySize, setOverlaySize] = useState({ w: 0, h: 0 });
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

  // References for preserving state during re-renders
  const logicalRangeRef = useRef<any>(null);
  const prevDataLengthRef = useRef<number>(0);

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
      localization: {
        timeFormatter: (timestamp: number) => {
          const d = new Date(timestamp * 1000);
          return d.toLocaleString('en-US', {
            hour12: false,
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        }
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
        if (typeof v === 'object' && v.value !== undefined) {
          lineData.push({ time: toSec(v.time) as Time, value: v.value });
        } else if (typeof v === 'number') {
          if (!data[i]) return;
          lineData.push({ time: toSec(data[i].time) as Time, value: v });
        }
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

    // Preserve and restore logical range if user was scrolled back
    if (logicalRangeRef.current && prevDataLengthRef.current > 0) {
      const prevRange = logicalRangeRef.current;
      // Replay must never recenter when a new candle is revealed. Restoring the
      // range also retains the chart's existing normal-mode pan/zoom behaviour.
      chart.timeScale().setVisibleLogicalRange(prevRange);
    }

    // Trade entries and exits are displayed by the position-box SVG overlay.

    // ── Custom Drawings Overlay ──────────────────────────────────────────────
    const updateOverlays = () => {
      if (!svgRef.current || !chartRef.current || !seriesRef.current || !data.length) return;
      
      const timeScale = chartRef.current.timeScale();
      const series = seriesRef.current;
      
      const rect = chartContainerRef.current?.getBoundingClientRect();
      if(rect) setOverlaySize({ w: rect.width, h: rect.height });

      const toCoord = (val: any) => {
        if (val === null || val === undefined) return null;
        // In Pine Script, xloc is usually bar_index by default
        // So 'val' is a bar index. Map it to the time of that bar.
        const barIdx = Math.floor(val);
        if (barIdx < 0 || barIdx >= data.length) return null;
        const t = toSec(data[barIdx].time);
        return timeScale.timeToCoordinate(t as Time);
      };

      // Pine Script Drawings
      if (drawings) {
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
            const width = Math.max(2, Math.abs(x2 - x1));
            const height = Math.abs(y2 - y1);
            el.style.display = 'block';
            const rect = el.querySelector('rect');
            if (rect) {
              rect.setAttribute('x', left.toString());
              rect.setAttribute('y', top.toString());
              rect.setAttribute('width', width.toString());
              rect.setAttribute('height', height.toString());
            }
            const text = el.querySelector('text');
            if (text && box.text) {
              let tx = box.text_halign === 'center' ? left + width / 2 : box.text_halign === 'right' ? left + width - 4 : left + 4;
              let ty = box.text_valign === 'center' ? top + height / 2 + 4 : box.text_valign === 'bottom' ? top + height - 4 : top + 14;
              text.setAttribute('x', tx.toString());
              text.setAttribute('y', ty.toString());
              if (box.text_halign === 'center') text.setAttribute('text-anchor', 'middle');
              else if (box.text_halign === 'right') text.setAttribute('text-anchor', 'end');
              else text.setAttribute('text-anchor', 'start');
            }
          } else {
            el.style.display = 'none';
          }
        });

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

        drawings.labels?.forEach(label => {
          const el = document.getElementById(label.id);
          if (!el) return;
          const x = toCoord(label.x);
          const y = series.priceToCoordinate(label.y);
          if (x !== null && y !== null) {
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
      }

      // Trade Boxes
      if (tradeBoxesRef.current && tradeBoxesRef.current.length > 0) {
        const recentBoxes = tradeBoxesRef.current.length > 500 ? tradeBoxesRef.current.slice(-500) : tradeBoxesRef.current;
        recentBoxes.forEach((box, idx) => {
          const el = document.getElementById(`trade-box-${idx}`);
          const lineEl = document.getElementById(`trade-box-line-${idx}`);
          if (!el) return;
          
          const x1 = timeScale.timeToCoordinate(toSec(box.entryTime) as Time);
          const exitX = timeScale.timeToCoordinate(toSec(box.exitTime) as Time);
          // A replay only contains candles revealed so far. For an open trade,
          // its known exit is still outside that data, so draw the box through
          // the current replay candle until the real exit candle appears.
          const replayEndX = isReplayActive && data.length > 0
            ? timeScale.timeToCoordinate(toSec(data[data.length - 1].time) as Time)
            : null;
          const x2 = exitX ?? replayEndX;
          const y1 = series.priceToCoordinate(box.entryPrice);
          const tpPrice = box.tp ?? box.exitPrice;
          const slPrice = box.sl ?? box.exitPrice;
          const yTp = series.priceToCoordinate(tpPrice);
          const ySl = series.priceToCoordinate(slPrice);
          
          if (x1 !== null && x2 !== null && y1 !== null && yTp !== null && ySl !== null) {
            const width = Math.max(2, Math.abs(x2 - x1));
            const left = Math.min(x1, x2);
            const tpTop = Math.min(yTp, y1);
            const tpHeight = Math.max(2, Math.abs(yTp - y1));
            const slTop = Math.min(y1, ySl);
            const slHeight = Math.max(2, Math.abs(ySl - y1));
            
            const tpRect = el.querySelector('.trade-box-tp');
            const slRect = el.querySelector('.trade-box-sl');
            if (tpRect) {
              tpRect.setAttribute('x', String(left));
              tpRect.setAttribute('y', String(tpTop));
              tpRect.setAttribute('width', String(width));
              tpRect.setAttribute('height', String(tpHeight));
              tpRect.style.display = 'block';
            }
            if (slRect) {
              slRect.setAttribute('x', String(left));
              slRect.setAttribute('y', String(slTop));
              slRect.setAttribute('width', String(width));
              slRect.setAttribute('height', String(slHeight));
              slRect.style.display = 'block';
            }
            el.style.display = 'block';

            if (lineEl) {
              lineEl.setAttribute('x1', String(x1));
              lineEl.setAttribute('y1', String(y1));
              lineEl.setAttribute('x2', String(x2));
              lineEl.setAttribute('y2', String(y1));
              lineEl.style.display = 'block';
            }
            const label = el.querySelector(`#trade-box-label-${idx}`);
            if (label) {
              label.setAttribute('x', String(left + 4));
              label.setAttribute('y', String(y1 - 5));
              label.style.display = 'block';
            }
            const tpLabel = el.querySelector('.trade-box-tp-label');
            if (tpLabel) {
              tpLabel.setAttribute('x', String(left + width - 4));
              tpLabel.setAttribute('y', String(tpTop + 14));
              tpLabel.style.display = 'block';
            }
            const slLabel = el.querySelector('.trade-box-sl-label');
            if (slLabel) {
              slLabel.setAttribute('x', String(left + width - 4));
              slLabel.setAttribute('y', String(slTop + slHeight - 4));
              slLabel.style.display = 'block';
            }
          } else {
            el.style.display = 'none';
            if (lineEl) lineEl.style.display = 'none';
          }
        });
      }

    };

    updateOverlaysRef.current = updateOverlays;
    chart.timeScale().subscribeVisibleTimeRangeChange(updateOverlays);
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateOverlays);
    
    // Initial update after a tiny delay to ensure chart layout is ready
    setTimeout(updateOverlays, 50);

    // ── Resize handler ────────────────────────────────────────────────────────
    const handleResize = () => {
      if (chartRef.current !== chart || !chartContainerRef.current) return;
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
        updateOverlays();
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      updateOverlaysRef.current = null;
      chart.timeScale().unsubscribeVisibleTimeRangeChange(updateOverlays);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateOverlays);
      if (chartRef.current) {
        logicalRangeRef.current = chartRef.current.timeScale().getVisibleLogicalRange();
        prevDataLengthRef.current = data.length;
      }
      if (chartRef.current === chart) chartRef.current = null;
      chart.remove();
    };
  }, [data.length, null, null, null, null, null, null]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (chartContainerRef.current) {
        setOverlaySize({
          w: chartContainerRef.current.clientWidth,
          h: chartContainerRef.current.clientHeight,
        });
      }
      updateOverlaysRef.current?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [tradeBoxes]);

  // Handle time range buttons
  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0 || !timeRangeTrigger) return;
    const ts = chartRef.current.timeScale();
    
    if (timeRangeTrigger.startsWith('All')) {
      ts.fitContent();
    } else {
      // Find range based on dataset timeframe (assumes 5m candles for basic approx)
      let barsToShow = 100;
      const baseTfStr = timeRangeTrigger.split('_')[0]; 
      
      if (baseTfStr === '1D') barsToShow = 288;
      if (baseTfStr === '5D') barsToShow = 288 * 5;
      if (baseTfStr === '1M') barsToShow = 288 * 30;
      if (baseTfStr === '3M') barsToShow = 288 * 90;
      if (baseTfStr === '6M') barsToShow = 288 * 180;
      if (baseTfStr === 'YTD' || baseTfStr === '1Y') barsToShow = 288 * 365;
      if (baseTfStr === '5Y') barsToShow = 288 * 365 * 5;

      const totalBars = data.length;
      if (barsToShow > totalBars) {
        ts.fitContent();
      } else {
        ts.setVisibleLogicalRange({
          from: totalBars - barsToShow,
          to: totalBars - 1
        });
      }
    }
  }, [timeRangeTrigger, data]);

  // Handle Replay Click & Interactive Drawing
  useEffect(() => {
    if (!chartRef.current || !data) return;
    
    const clickHandler = (param: any) => {
      if (!param.time) return;
      
      const clickTimeMs = typeof param.time === 'string' ? new Date(param.time).getTime() : (param.time as number) * (param.time > 1e10 ? 1 : 1000);
      const price = seriesRef.current ? seriesRef.current.coordinateToPrice(param.point.y) : null;
      
      // 1. Replay Selection
      if (isReplayActive && onSelectReplayBar && replayIndex === null) {
        let targetIndex = -1;
        for (let i = 0; i < data.length; i++) {
          const barTime = typeof data[i].time === 'string' ? new Date(data[i].time as string).getTime() : (data[i].time as number) * (data[i].time > 1e10 ? 1 : 1000);
          if (barTime === clickTimeMs) { targetIndex = i; break; }
        }
        if (targetIndex !== -1) onSelectReplayBar(targetIndex);
        else onSelectReplayBar(Math.max(0, Math.floor(param.logical)));
        return;
      }

      // 2. Interactive Drawing
      if (activeDrawingTool && price !== null && setUserDrawings) {
        const newPoint = { time: clickTimeMs, price };
        const newPoints = [...drawingPoints, newPoint];
        
        if (activeDrawingTool === 'hline') {
          setUserDrawings([...userDrawings, { type: 'hline', points: [newPoint] }]);
          setDrawingPoints([]);
        } else if (activeDrawingTool === 'trendline' && newPoints.length === 2) {
          setUserDrawings([...userDrawings, { type: 'trendline', points: newPoints }]);
          setDrawingPoints([]);
        } else if (activeDrawingTool === 'fib' && newPoints.length === 2) {
          setUserDrawings([...userDrawings, { type: 'fib', points: newPoints }]);
          setDrawingPoints([]);
        } else {
          setDrawingPoints(newPoints);
        }
      }
    };
    
    const crosshairHandler = (param: any) => {
      setCrosshairParam(param);
    };

    chartRef.current.subscribeClick(clickHandler);
    chartRef.current.subscribeCrosshairMove(crosshairHandler);
    
    return () => {
      chartRef.current?.unsubscribeClick(clickHandler);
      chartRef.current?.unsubscribeCrosshairMove(crosshairHandler);
    };
  }, [isReplayActive, onSelectReplayBar, data, activeDrawingTool, drawingPoints, userDrawings, setUserDrawings, replayIndex]);

  // Handle Go To Date
  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0 || !goToTimestamp) return;
    
    // Find the closest bar timestamp that matches or is just before/after the requested timestamp
    // Since data.time is in string ISO format (e.g., '2026-08-26T00:00:00.000Z') or number (Unix ms), we need to normalize.
    let targetIndex = data.length - 1;
    
    for (let i = 0; i < data.length; i++) {
      const barTime = typeof data[i].time === 'string' ? new Date(data[i].time as string).getTime() : (data[i].time as number) * (data[i].time > 1e10 ? 1 : 1000);
      if (barTime >= goToTimestamp) {
        targetIndex = i;
        break;
      }
    }
    
    // Center the chart on this bar (show ~100 bars around it)
    const ts = chartRef.current.timeScale();
    ts.setVisibleLogicalRange({
      from: targetIndex - 50,
      to: targetIndex + 50
    });
  }, [goToTimestamp, data]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div 
        ref={chartContainerRef} 
        style={{ width: '100%', height: '100%' }} 
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      />

      {contextMenu && (
        <div 
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: '#1e222d',
            border: '1px solid #2a2e39',
            borderRadius: '4px',
            padding: '4px 0',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 9999,
            minWidth: '160px'
          }}
          onClick={() => setContextMenu(null)}
          onMouseLeave={() => setContextMenu(null)}
        >
          <div 
            style={{ padding: '8px 16px', cursor: 'pointer', color: '#d1d4dc', fontSize: '13px', fontFamily: "'Inter', sans-serif" }}
            onClick={() => {
               if (data && data.length > 0) {
                 const targetIndex = data.length - 1;
                 chartRef.current?.timeScale().setVisibleLogicalRange({
                   from: Math.max(0, targetIndex - 150),
                   to: targetIndex + 5
                 });
               } else {
                 chartRef.current?.timeScale().fitContent();
               }
               setContextMenu(null);
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#2a2e39'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            Reset Chart
          </div>
        </div>
      )}
      
      {/* SVG Overlay for Boxes, Lines, Labels */}
      <svg
        ref={svgRef}
        width={overlaySize.w} 
        height={overlaySize.h} 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          zIndex: 10,
          overflow: 'hidden'
        }}
      >
        {/* Interactive Drawing Preview */}
        {activeDrawingTool && drawingPoints.length === 1 && crosshairParam && crosshairParam.time && (
          (() => {
            const p1Time = typeof drawingPoints[0].time === 'string' ? drawingPoints[0].time : drawingPoints[0].time / 1000;
            const x1 = chartRef.current?.timeScale().timeToCoordinate(p1Time as any) || 0;
            const y1 = seriesRef.current?.priceToCoordinate(drawingPoints[0].price) || 0;
            const x2 = crosshairParam.point.x;
            const y2 = crosshairParam.point.y;
            
            if (activeDrawingTool === 'trendline') {
              return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2962ff" strokeWidth="2" strokeDasharray="4 4" />;
            }
            if (activeDrawingTool === 'fib') {
              return (
                <g opacity={0.5}>
                  <line x1={x1} y1={y1} x2={x2} y2={y1} stroke="#787b86" strokeWidth="1" strokeDasharray="4 4" />
                  <line x1={x2} y1={y1} x2={x2} y2={y2} stroke="#787b86" strokeWidth="1" strokeDasharray="4 4" />
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2962ff" strokeWidth="2" strokeDasharray="4 4" />
                </g>
              );
            }
          })()
        )}

        {/* Render Drawing Preview */}
        {drawingPoints.length === 1 && crosshairParam && crosshairParam.point && (() => {
          if (!chartRef.current || !seriesRef.current) return null;
          const p1Time = typeof drawingPoints[0].time === 'string' ? drawingPoints[0].time : drawingPoints[0].time / 1000;
          const x1 = chartRef.current.timeScale().timeToCoordinate(p1Time as any);
          const y1 = seriesRef.current.priceToCoordinate(drawingPoints[0].price);
          const x2 = crosshairParam.point.x;
          const y2 = crosshairParam.point.y;
          
          if (x1 === null || y1 === null) return null;
          
          if (activeDrawingTool === 'trendline') {
            return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2962ff" strokeWidth="2" strokeDasharray="4 4" />;
          }
          if (activeDrawingTool === 'fib') {
            const high = Math.min(y1, y2);
            const low = Math.max(y1, y2);
            const diff = low - high;
            const isDown = y2 > y1; // Actually, real fib depends on price, but in preview y is inverse price
            return (
              <g opacity="0.6">
                {[0, 0.236, 0.382, 0.5, 0.618, 1].map(lvl => {
                  const yPos = isDown ? high + (diff * lvl) : low - (diff * lvl);
                  return <line key={lvl} x1={Math.min(x1, x2)} y1={yPos} x2={overlaySize.w} y2={yPos} stroke="#787b86" strokeWidth="1" strokeDasharray="4 4" />;
                })}
              </g>
            );
          }
          return null;
        })()}

        {/* Render User Drawings */}
        {userDrawings.map((draw, idx) => {
          if (!chartRef.current || !seriesRef.current) return null;
          
          const p1Time = typeof draw.points[0].time === 'string' ? draw.points[0].time : draw.points[0].time / 1000;
          const x1 = chartRef.current.timeScale().timeToCoordinate(p1Time as any);
          const y1 = seriesRef.current.priceToCoordinate(draw.points[0].price);
          
          if (x1 === null || y1 === null) return null;

          if (draw.type === 'hline') {
            return (
              <g key={`ud-hline-${idx}`}>
                <line x1={0} y1={y1} x2={overlaySize.w} y2={y1} stroke="#2962ff" strokeWidth="2" />
                <rect x={0} y={y1 - 10} width={60} height={20} fill="#2962ff" rx="4" />
                <text x={30} y={y1 + 4} fill="white" fontSize="11px" fontFamily="Inter, sans-serif" textAnchor="middle">{draw.points[0].price.toFixed(2)}</text>
              </g>
            );
          }

          if (draw.points.length < 2) return null;
          
          const p2Time = typeof draw.points[1].time === 'string' ? draw.points[1].time : draw.points[1].time / 1000;
          const x2 = chartRef.current.timeScale().timeToCoordinate(p2Time as any);
          const y2 = seriesRef.current.priceToCoordinate(draw.points[1].price);
          
          if (x2 === null || y2 === null) return null;

          if (draw.type === 'trendline') {
            return <line key={`ud-${idx}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2962ff" strokeWidth="2" />;
          }
          
          if (draw.type === 'fib') {
            const levels = [
              { level: 0, color: '#787b86' },
              { level: 0.236, color: '#f44336' },
              { level: 0.382, color: '#81c784' },
              { level: 0.5, color: '#4caf50' },
              { level: 0.618, color: '#009688' },
              { level: 1, color: '#787b86' }
            ];
            const high = Math.min(y1, y2);
            const low = Math.max(y1, y2);
            const diff = low - high;
            const isDown = draw.points[1].price < draw.points[0].price;

            return (
              <g key={`ud-fib-${idx}`}>
                {levels.map((lvl) => {
                  const yPos = isDown ? high + (diff * lvl.level) : low - (diff * lvl.level);
                  return (
                    <g key={`lvl-${lvl.level}`}>
                      <line x1={Math.min(x1, x2)} y1={yPos} x2={overlaySize.w} y2={yPos} stroke={lvl.color} strokeWidth="1" />
                      <text x={Math.min(x1, x2)} y={yPos - 4} fill={lvl.color} fontSize="11px" fontFamily="Inter, sans-serif">{lvl.level}</text>
                    </g>
                  );
                })}
              </g>
            );
          }
          return null;
        })}

        {/* Replay Selection Scissors */}
        {isReplayActive && replayIndex === null && crosshairParam && crosshairParam.point && (
          <g>
            <line x1={crosshairParam.point.x} y1={0} x2={crosshairParam.point.x} y2={overlaySize.h} stroke="#2962ff" strokeWidth="2" />
            <text x={crosshairParam.point.x - 6} y={crosshairParam.point.y + 16} fill="#2962ff" fontSize="16px">✂</text>
          </g>
        )}

        {drawings?.boxes?.map(b => (
          <g key={b.id} id={b.id} style={{ display: 'none' }}>
            <rect
              fill={b.bgcolor || 'rgba(0,0,0,0)'}
              stroke={b.border_color || 'transparent'}
              strokeWidth={1}
            />
            {b.text && (
              <text
                fill={b.text_color || '#ffffff'}
                fontSize={b.text_size ? parseInt(b.text_size.replace('px', '')) : 12}
                fontFamily="'Inter', sans-serif"
                pointerEvents="none"
              >
                {b.text}
              </text>
            )}
          </g>
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
        
        {/* Trade Boxes */}
        <g className="trade-boxes" pointerEvents="none">
          {tradeBoxes && tradeBoxes.slice(-500).map((box, idx) => {
            return (
              <g id={`trade-box-${idx}`} key={`trade-box-group-${idx}`}>
                <rect
                  className="trade-box-tp"
                  fill="rgba(38, 166, 154, 0.22)"
                  stroke="rgba(38, 166, 154, 0.8)"
                  strokeWidth="1"
                  strokeDasharray="4,4"
                  style={{ display: 'none' }}
                />
                <rect
                  className="trade-box-sl"
                  fill="rgba(239, 83, 80, 0.22)"
                  stroke="rgba(239, 83, 80, 0.8)"
                  strokeWidth="1"
                  strokeDasharray="4,4"
                  style={{ display: 'none' }}
                />
                <line
                  id={`trade-box-line-${idx}`}
                  stroke="rgba(255, 255, 255, 0.9)"
                  strokeWidth="2"
                  strokeDasharray="5,4"
                  style={{ display: 'none' }}
                />
                <text className="trade-box-tp-label" textAnchor="end" fill="rgba(255, 255, 255, 0.9)" fontSize="11" style={{ display: 'none' }}>
                  TP {box.tp?.toFixed(2) ?? ''}
                </text>
                <text className="trade-box-sl-label" textAnchor="end" fill="rgba(255, 255, 255, 0.9)" fontSize="11" style={{ display: 'none' }}>
                  SL {box.sl?.toFixed(2) ?? ''}
                </text>
                <text id={`trade-box-label-${idx}`} fill="#111827" fontSize="11" fontWeight="600" style={{ display: 'none' }}>
                  {box.direction === 'long' ? 'LONG' : 'SHORT'} {box.entryPrice.toFixed(2)}
                </text>
              </g>
            );
          })}
        </g>

      </svg>
    </div>
  );
}
