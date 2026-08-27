'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import styles from './data-manager.module.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface DataQualityReport {
  status: string;
  symbol: string;
  timeframe: string;
  period_start: string;
  period_end: string;
  candle_count: number;
  errors: string[];
  warnings: string[];
}

interface ImportResult {
  dataset?: any;
  report: DataQualityReport;
}

interface Dataset {
  id: number;
  dataset_id: string;
  symbol: string;
  source_name: string;
  timeframe: string;
  start_timestamp: number;
  end_timestamp: number;
  candle_count: number;
  imported_at: string;
  data_hash: string;
  quality_status: string;
  quality_warnings: string[];
}

interface DownloadProgress {
  totalChunks: number;
  completedChunks: number;
  currentFrom: string;
  currentTo: string;
  totalBars: number;
  progressPct: number;
  log: string[];
  stage: 'idle' | 'downloading' | 'processing' | 'done' | 'error';
  finalDataset?: any;
  finalStats?: any;
  errorMsg?: string;
}

// ── Helper ───────────────────────────────────────────────────────────────────
const statusColor = (s: string) =>
  s === 'VALID' ? '#00b894' : s === 'VALID_WITH_WARNINGS' ? '#fdcb6e' : '#d63031';
const statusIcon = (s: string) =>
  s === 'VALID' ? '✓' : s === 'VALID_WITH_WARNINGS' ? '⚠' : '✗';

// ── Main Component ───────────────────────────────────────────────────────────

export default function DataManager() {
  const [activeTab, setActiveTab] = useState<'import' | 'download'>('download');

  // Dataset library
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false);
  const [datasetsLoaded, setDatasetsLoaded] = useState(false);

  const loadDatasets = useCallback(async () => {
    setIsLoadingDatasets(true);
    try {
      const res = await fetch('/api/datasets');
      const data = await res.json();
      setDatasets(data.datasets || []);
      setDatasetsLoaded(true);
    } catch { setDatasets([]); }
    finally { setIsLoadingDatasets(false); }
  }, []);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  // ── CSV Import state ──────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvSymbol, setCsvSymbol] = useState('XAUUSD');
  const [csvTimeframe, setCsvTimeframe] = useState('1m');
  const [csvSourceName, setCsvSourceName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const handleImport = useCallback(async () => {
    if (!selectedFile) return;
    setIsImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('symbol', csvSymbol);
      formData.append('timeframe', csvTimeframe);
      formData.append('source_name', csvSourceName || selectedFile.name.replace('.csv', ''));
      const res = await fetch('/api/datasets/import', { method: 'POST', body: formData });
      const data = await res.json();
      setImportResult(data);
      if (res.ok) await loadDatasets();
    } catch (err: any) {
      setImportResult({ report: { status: 'INVALID', symbol: csvSymbol, timeframe: csvTimeframe, period_start: '', period_end: '', candle_count: 0, errors: [err.message], warnings: [] } });
    } finally { setIsImporting(false); }
  }, [selectedFile, csvSymbol, csvTimeframe, csvSourceName, loadDatasets]);

  // ── Dukascopy Downloader state ────────────────────────────────────────────
  const [dlSymbol, setDlSymbol] = useState('XAUUSD');
  const [dlTimeframe, setDlTimeframe] = useState('5m');
  const [dlPriceType, setDlPriceType] = useState('bid');
  const [dlFromDate, setDlFromDate] = useState('2021-08-25');
  const [dlToDate, setDlToDate] = useState(new Date().toISOString().slice(0, 10));
  const [progress, setProgress] = useState<DownloadProgress>({
    totalChunks: 0, completedChunks: 0, currentFrom: '', currentTo: '',
    totalBars: 0, progressPct: 0, log: [], stage: 'idle',
  });
  const abortRef = useRef<(() => void) | null>(null);

  const startDownload = useCallback(async () => {
    setProgress({ totalChunks: 0, completedChunks: 0, currentFrom: '', currentTo: '', totalBars: 0, progressPct: 0, log: [`Starting download: ${dlSymbol} ${dlTimeframe} (${dlPriceType}) ${dlFromDate} → ${dlToDate}`], stage: 'downloading' });

    const res = await fetch('/api/datasets/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: dlSymbol, timeframe: dlTimeframe, priceType: dlPriceType, fromDate: dlFromDate, toDate: dlToDate, sourceName: 'dukascopy' }),
    });

    if (!res.ok || !res.body) {
      setProgress(p => ({ ...p, stage: 'error', errorMsg: 'Failed to connect to download service.' }));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    abortRef.current = () => reader.cancel();

    const processEvent = (line: string) => {
      if (!line.startsWith('data: ')) return;
      try {
        const ev = JSON.parse(line.slice(6));
        setProgress(prev => {
          const log = [...prev.log];

          switch (ev.type) {
            case 'start':
              log.push(`⬇  ${ev.totalChunks} monthly chunks to download`);
              return { ...prev, totalChunks: ev.totalChunks, log };

            case 'chunk_start':
              return { ...prev, currentFrom: ev.from, currentTo: ev.to, log };

            case 'chunk_done':
              log.push(`✓  ${ev.from} → ${ev.to}  (${ev.barsInChunk.toLocaleString()} bars)`);
              return {
                ...prev,
                completedChunks: ev.chunkIndex,
                totalBars: ev.totalBars,
                progressPct: ev.progressPct,
                currentFrom: ev.from,
                currentTo: ev.to,
                log,
              };

            case 'chunk_error':
              log.push(`✗  ${ev.from} → ${ev.to}  ERROR: ${ev.error}`);
              return { ...prev, completedChunks: ev.chunkIndex, log };

            case 'processing':
              log.push(`⚙  ${ev.message}`);
              return { ...prev, stage: 'processing', log };

            case 'complete':
              log.push(`✅ Dataset saved: ${ev.stats.totalBars.toLocaleString()} bars  |  Hash: ${ev.stats.data_hash.slice(0, 16)}…`);
              return { ...prev, stage: 'done', progressPct: 100, finalDataset: ev.dataset, finalStats: ev.stats, log };

            case 'error':
              log.push(`💥 ${ev.message}`);
              return { ...prev, stage: 'error', errorMsg: ev.message, log };

            default:
              return prev;
          }
        });
      } catch { /* ignore malformed events */ }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(processEvent);
    }

    // Refresh dataset library after download
    await loadDatasets();
  }, [dlSymbol, dlTimeframe, dlPriceType, dlFromDate, dlToDate, loadDatasets]);

  const progressBar = (pct: number) => {
    const filled = Math.round(pct / 5); // 20 chars wide
    const empty = 20 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link href="/" className={styles.logo}><span className={styles.logoMark}>PL</span> PineLabs</Link>
        <nav className={styles.nav}>
          <Link href="/" className={styles.navLink}>Terminal</Link>
          <Link href="/lab" className={styles.navLink}>Strategy Lab</Link>
          <Link href="/data-manager" className={styles.navLinkActive}>Data Manager</Link>
        </nav>
      </header>

      <main className={styles.main}>
        {/* ── Tab Switcher ── */}
        <div className={styles.tabs}>
          <button
            id="tab-download"
            className={activeTab === 'download' ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab('download')}
          >
            ⬇ Download Historical Data
          </button>
          <button
            id="tab-import"
            className={activeTab === 'import' ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab('import')}
          >
            📄 Import CSV
          </button>
        </div>

        {/* ══════════════════════════════════════════ DUKASCOPY DOWNLOADER ══ */}
        {activeTab === 'download' && (
          <section className={styles.importPanel}>
            <h1 className={styles.sectionTitle}>Dukascopy Historical Data Downloader</h1>
            <p className={styles.sectionDesc}>
              Download free historical OHLCV data directly from Dukascopy's public data feed.
              No API key required. Large date ranges are split into monthly chunks automatically.
            </p>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Symbol</label>
                <select id="dl-symbol" className={styles.select} value={dlSymbol} onChange={e => setDlSymbol(e.target.value)}>
                  <option value="XAUUSD">XAUUSD – Gold/USD</option>
                  <option value="EURUSD">EURUSD</option>
                  <option value="GBPUSD">GBPUSD</option>
                  <option value="USDJPY">USDJPY</option>
                  <option value="BTCUSD">BTCUSD</option>
                  <option value="USOIL">USOIL – US Crude Oil</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Timeframe</label>
                <select id="dl-timeframe" className={styles.select} value={dlTimeframe} onChange={e => setDlTimeframe(e.target.value)}>
                  <option value="1m">1 Minute</option>
                  <option value="5m">5 Minutes</option>
                  <option value="15m">15 Minutes</option>
                  <option value="30m">30 Minutes</option>
                  <option value="1h">1 Hour</option>
                  <option value="4h">4 Hours</option>
                  <option value="1d">Daily</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Price Side</label>
                <select id="dl-pricetype" className={styles.select} value={dlPriceType} onChange={e => setDlPriceType(e.target.value)}>
                  <option value="bid">Bid</option>
                  <option value="ask">Ask</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Start Date (UTC)</label>
                <input id="dl-from" type="date" className={styles.input} value={dlFromDate} onChange={e => setDlFromDate(e.target.value)} />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>End Date (UTC)</label>
                <input id="dl-to" type="date" className={styles.input} value={dlToDate} onChange={e => setDlToDate(e.target.value)} />
              </div>
              <div className={styles.formGroup} style={{ justifyContent: 'flex-end' }}>
                <label className={styles.label}>&nbsp;</label>
                <button
                  id="dl-start-btn"
                  className={styles.importBtn}
                  onClick={startDownload}
                  disabled={progress.stage === 'downloading' || progress.stage === 'processing'}
                >
                  {progress.stage === 'downloading' || progress.stage === 'processing'
                    ? 'Downloading…'
                    : '⬇  Start Download'}
                </button>
              </div>
            </div>

            {/* ── Progress Panel ── */}
            {progress.stage !== 'idle' && (
              <div className={styles.progressPanel}>
                {/* Header */}
                <div className={styles.progressHeader}>
                  <span className={styles.progressTitle}>
                    {progress.stage === 'downloading' && `⬇ Downloading ${dlSymbol} ${dlTimeframe.toUpperCase()} historical data`}
                    {progress.stage === 'processing' && `⚙ Processing data…`}
                    {progress.stage === 'done' && `✅ Download Complete`}
                    {progress.stage === 'error' && `💥 Download Failed`}
                  </span>
                </div>

                {/* Progress bar */}
                {(progress.stage === 'downloading' || progress.stage === 'processing' || progress.stage === 'done') && (
                  <div className={styles.progressBarWrap}>
                    <div className={styles.progressBarTrack}>
                      <div
                        className={styles.progressBarFill}
                        style={{ width: `${progress.progressPct}%`, background: progress.stage === 'done' ? '#00b894' : 'var(--accent)' }}
                      />
                    </div>
                    <span className={styles.progressPct}>{progress.progressPct}%</span>
                  </div>
                )}

                {/* Stats row */}
                {progress.stage === 'downloading' && (
                  <div className={styles.progressStats}>
                    <div className={styles.progressStat}>
                      <span>Current Chunk</span>
                      <strong>{progress.currentFrom} → {progress.currentTo}</strong>
                    </div>
                    <div className={styles.progressStat}>
                      <span>Chunks Completed</span>
                      <strong>{progress.completedChunks} / {progress.totalChunks}</strong>
                    </div>
                    <div className={styles.progressStat}>
                      <span>Bars Collected</span>
                      <strong>{progress.totalBars.toLocaleString()}</strong>
                    </div>
                  </div>
                )}

                {/* Final stats */}
                {progress.stage === 'done' && progress.finalStats && (
                  <div className={styles.reportCard} style={{ borderColor: '#00b894', marginTop: 0 }}>
                    <div className={styles.reportHeader}>
                      <span className={styles.reportTitle}>Dataset Summary</span>
                      <span className={styles.reportStatus} style={{ color: '#00b894' }}>✓ VALID</span>
                    </div>
                    <div className={styles.reportGrid}>
                      <div className={styles.reportItem}><span>Symbol</span><strong>{dlSymbol} {dlTimeframe.toUpperCase()} {dlPriceType.toUpperCase()}</strong></div>
                      <div className={styles.reportItem}><span>Period</span><strong>{progress.finalStats.period_start} → {progress.finalStats.period_end}</strong></div>
                      <div className={styles.reportItem}><span>Total Candles</span><strong>{progress.finalStats.totalBars.toLocaleString()}</strong></div>
                      <div className={styles.reportItem}><span>Chunks</span><strong>{progress.finalStats.completedChunks}/{progress.finalStats.totalChunks}</strong></div>
                      {progress.finalStats.invalidBarsRemoved > 0 && (
                        <div className={styles.reportItem}><span>Bars Removed</span><strong style={{ color: '#fdcb6e' }}>{progress.finalStats.invalidBarsRemoved}</strong></div>
                      )}
                      {progress.finalStats.gapsDetected > 0 && (
                        <div className={styles.reportItem}><span>Gaps Detected</span><strong style={{ color: '#fdcb6e' }}>{progress.finalStats.gapsDetected}</strong></div>
                      )}
                      <div className={styles.reportItem}><span>SHA-256 Hash</span><strong className={styles.hashStr}>{progress.finalStats.data_hash?.slice(0, 20)}…</strong></div>
                    </div>
                  </div>
                )}

                {/* Log console */}
                <div className={styles.logConsole}>
                  {progress.log.map((line, i) => (
                    <div key={i} className={styles.logLine}>{line}</div>
                  ))}
                  {(progress.stage === 'downloading' || progress.stage === 'processing') && (
                    <div className={styles.logCursor}>▋</div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ══════════════════════════════════════════════════════ CSV IMPORT ══ */}
        {activeTab === 'import' && (
          <section className={styles.importPanel}>
            <h1 className={styles.sectionTitle}>Import CSV Historical Dataset</h1>
            <p className={styles.sectionDesc}>
              Upload a CSV file of historical OHLCV candle data. The system will validate quality
              and hash the dataset to guarantee reproducibility across all backtests.
            </p>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Symbol</label>
                <input id="csv-symbol" className={styles.input} value={csvSymbol} onChange={e => setCsvSymbol(e.target.value.toUpperCase())} placeholder="XAUUSD" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Source Timeframe</label>
                <select id="csv-timeframe" className={styles.select} value={csvTimeframe} onChange={e => setCsvTimeframe(e.target.value)}>
                  <option value="1m">1 Minute</option>
                  <option value="5m">5 Minutes</option>
                  <option value="15m">15 Minutes</option>
                  <option value="30m">30 Minutes</option>
                  <option value="1h">1 Hour</option>
                  <option value="4h">4 Hours</option>
                  <option value="1d">Daily</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Source Name (optional)</label>
                <input id="csv-source-name" className={styles.input} value={csvSourceName} onChange={e => setCsvSourceName(e.target.value)} placeholder="e.g. dukascopy_2020_2024" />
              </div>
            </div>

            <div
              className={styles.dropzone}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setSelectedFile(f); setImportResult(null); } }}
            >
              <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={e => { setSelectedFile(e.target.files?.[0] || null); setImportResult(null); }} style={{ display: 'none' }} />
              {selectedFile ? (
                <div>
                  <div className={styles.dropzoneIcon}>📄</div>
                  <div className={styles.dropzoneFilename}>{selectedFile.name}</div>
                  <div className={styles.dropzoneSize}>{(selectedFile.size / 1024).toFixed(1)} KB</div>
                </div>
              ) : (
                <div>
                  <div className={styles.dropzoneIcon}>📁</div>
                  <div className={styles.dropzonePrompt}>Drop CSV here or click to browse</div>
                  <div className={styles.dropzoneHint}>Expected: timestamp, open, high, low, close[, volume]</div>
                </div>
              )}
            </div>

            <button id="csv-import-btn" className={styles.importBtn} onClick={handleImport} disabled={!selectedFile || isImporting}>
              {isImporting ? 'Validating & Importing...' : 'Validate & Import Dataset'}
            </button>

            {importResult && (
              <div className={styles.reportCard} style={{ borderColor: statusColor(importResult.report.status) }}>
                <div className={styles.reportHeader}>
                  <span className={styles.reportTitle}>Data Quality Report</span>
                  <span className={styles.reportStatus} style={{ color: statusColor(importResult.report.status) }}>
                    {statusIcon(importResult.report.status)} {importResult.report.status.replace('_', ' ')}
                  </span>
                </div>
                <div className={styles.reportGrid}>
                  <div className={styles.reportItem}><span>Dataset</span><strong>{importResult.report.symbol} {importResult.report.timeframe.toUpperCase()}</strong></div>
                  <div className={styles.reportItem}><span>Period</span><strong>{importResult.report.period_start || 'N/A'} → {importResult.report.period_end || 'N/A'}</strong></div>
                  <div className={styles.reportItem}><span>Candles</span><strong>{importResult.report.candle_count.toLocaleString()}</strong></div>
                  {importResult.dataset && <div className={styles.reportItem}><span>Hash</span><strong className={styles.hashStr}>{importResult.dataset.data_hash.slice(0, 16)}…</strong></div>}
                </div>
                {importResult.report.errors.length > 0 && (
                  <div className={styles.reportSection}>
                    <div className={styles.reportSectionTitle} style={{ color: '#d63031' }}>Errors</div>
                    {importResult.report.errors.map((e, i) => <div key={i} className={styles.reportLine}>✗ {e}</div>)}
                  </div>
                )}
                {importResult.report.warnings.length > 0 && (
                  <div className={styles.reportSection}>
                    <div className={styles.reportSectionTitle} style={{ color: '#fdcb6e' }}>Warnings</div>
                    {importResult.report.warnings.map((w, i) => <div key={i} className={styles.reportLine}>⚠ {w}</div>)}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ══════════════════════════════════════════════ DATASET LIBRARY ══ */}
        <section className={styles.libraryPanel}>
          <div className={styles.libraryHeader}>
            <h2 className={styles.sectionTitle}>Dataset Library</h2>
            <button className={styles.refreshBtn} id="dm-refresh-btn" onClick={loadDatasets} disabled={isLoadingDatasets}>
              {isLoadingDatasets ? 'Loading…' : datasetsLoaded ? '↻ Refresh' : 'Load Datasets'}
            </button>
          </div>

          {!datasetsLoaded && !isLoadingDatasets && (
            <p className={styles.emptyState}>Click "Load Datasets" to view your imported historical data.</p>
          )}
          {datasets.length === 0 && datasetsLoaded && (
            <p className={styles.emptyState}>No datasets yet. Download or import data above to get started.</p>
          )}
          {datasets.length > 0 && (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Symbol</th><th>TF</th><th>Period</th><th>Candles</th><th>Source</th><th>Quality</th><th>Imported</th><th>Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map(d => (
                    <tr key={d.id}>
                      <td><strong>{d.symbol}</strong></td>
                      <td>{d.timeframe.toUpperCase()}</td>
                      <td className={styles.periodCell}>
                        {new Date(d.start_timestamp).toISOString().slice(0, 10)}<br />→ {new Date(d.end_timestamp).toISOString().slice(0, 10)}
                      </td>
                      <td>{d.candle_count.toLocaleString()}</td>
                      <td className={styles.sourceCell}>{d.source_name}</td>
                      <td>
                        <span className={styles.qualityBadge} style={{ color: statusColor(d.quality_status) }}>
                          {statusIcon(d.quality_status)} {d.quality_status.replace(/_/g, ' ')}
                        </span>
                        {d.quality_warnings.length > 0 && <div className={styles.warningCount}>{d.quality_warnings.length} warning{d.quality_warnings.length > 1 ? 's' : ''}</div>}
                      </td>
                      <td className={styles.dateCell}>{new Date(d.imported_at).toLocaleString()}</td>
                      <td className={styles.hashCell} title={d.data_hash}>{d.data_hash.slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
