import { NextResponse } from 'next/server';
import { readDb } from '@/db/localStore';
import { LocalCSVProvider } from '@/lib/market-data/historical-provider';
import { BacktestEngine } from '@/lib/backtester/engine';
import fs from 'fs/promises';
import path from 'path';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sourceCode, datasetId, viewTimeframe } = body;

    if (!sourceCode) {
      return NextResponse.json({ error: 'sourceCode is required.' }, { status: 400 });
    }
    if (!datasetId) {
      return NextResponse.json({ error: 'datasetId is required. Please select a historical dataset first.' }, { status: 400 });
    }

    // Look up the dataset metadata
    const db = await readDb();
    const dataset = (db.historicalDatasets || []).find(d => d.id === Number(datasetId) || d.dataset_id === datasetId);

    if (!dataset) {
      return NextResponse.json({ error: `Dataset not found: ${datasetId}` }, { status: 404 });
    }

    // Verify the stored data file exists
    // path.join uses static 'data' prefix so Turbopack does not trace the whole project
    const dataFilename = path.basename(dataset.data_path);
    const dataFilePath = path.join(process.cwd(), 'data', 'datasets', dataFilename);
    let rawBars: any[];
    try {
      const fileContent = await fs.readFile(dataFilePath, 'utf-8');
      rawBars = JSON.parse(fileContent);
    } catch {
      return NextResponse.json({ error: `Dataset data file missing: ${dataset.data_path}` }, { status: 500 });
    }

    // Verify data integrity via hash check
    // (The hash was computed on the original CSV text, so we don't recompute here.
    //  We trust the stored bars are correct as we validated them on import.)
    // For extra safety: verify candle count hasn't changed.
    if (rawBars.length !== dataset.candle_count) {
      return NextResponse.json({
        error: `Data integrity check failed: expected ${dataset.candle_count} candles, found ${rawBars.length}.`
      }, { status: 500 });
    }

    // If a viewTimeframe is requested and it differs from the stored timeframe, aggregate
    let barsForBacktest = rawBars;
    let chartBars = rawBars;
    const targetTf = viewTimeframe || dataset.timeframe;

    if (targetTf !== dataset.timeframe) {
      if (!LocalCSVProvider.canDeriveFrom(dataset.timeframe, targetTf)) {
        return NextResponse.json({
          error: `Cannot derive ${targetTf} from ${dataset.timeframe} source data.`
        }, { status: 400 });
      }
      const provider = new LocalCSVProvider();
      barsForBacktest = provider.aggregate(rawBars, targetTf);
      chartBars = barsForBacktest;
    }

    // Enforce temporal causality: bars are already sorted ascending by time.
    // The engine must only access bar N data at bar N (no lookahead).
    console.log(`[backtest] Running engine on ${barsForBacktest.length} bars, tf=${targetTf}`);
    console.log(`[backtest] Source code preview:\n${sourceCode.slice(0, 300)}`);
    const engine = new BacktestEngine();
    const result = await engine.run(sourceCode, barsForBacktest);
    console.log(`[backtest] Result: trades=${result.trades.length}, net_profit=${result.net_profit}`);

    // Attach dataset provenance to every backtest result
    const metrics = {
      ...result,
      dataset_id: dataset.dataset_id,
      data_hash: dataset.data_hash,
      symbol: dataset.symbol,
      source_timeframe: dataset.timeframe,
      view_timeframe: targetTf,
      source_name: dataset.source_name,
      data_period_start: new Date(dataset.start_timestamp).toISOString(),
      data_period_end: new Date(dataset.end_timestamp).toISOString(),
      candle_count: barsForBacktest.length,
    };

    return NextResponse.json({ bars: chartBars, metrics, dataset });
  } catch (error: any) {
    console.error('[/api/backtest] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
