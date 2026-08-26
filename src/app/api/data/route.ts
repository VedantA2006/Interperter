import { NextResponse } from 'next/server';
import { readDb } from '@/db/localStore';
import fs from 'fs/promises';
import path from 'path';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { datasetId, viewTimeframe } = body;

    if (!datasetId) {
      return NextResponse.json({ error: 'datasetId is required' }, { status: 400 });
    }

    const db = await readDb();
    const dataset = (db.historicalDatasets || []).find(d => String(d.id) === String(datasetId) || d.dataset_id === datasetId);
    
    if (!dataset) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
    }

    const dataFilename = path.basename(dataset.data_path);
    const dataFilePath = path.join(process.cwd(), 'data', 'datasets', dataFilename);
    let rawData: any[];
    try {
      const fileContent = await fs.readFile(dataFilePath, 'utf-8');
      rawData = JSON.parse(fileContent);
    } catch {
      return NextResponse.json({ error: `Dataset data file missing: ${dataset.data_path}` }, { status: 500 });
    }
    
    let bars = rawData;
    if (viewTimeframe && viewTimeframe !== dataset.timeframe) {
      const msMap: Record<string, number> = {
        '1m': 60000,
        '5m': 300000,
        '15m': 900000,
        '30m': 1800000,
        '1h': 3600000,
        '4h': 14400000,
        '1D': 86400000,
        '1d': 86400000
      };
      
      const targetMs = msMap[viewTimeframe];
      if (targetMs) {
        const aggregated: any[] = [];
        let currentBar: any = null;
        let currentBucket = 0;

        for (const bar of rawData) {
          const tMs = typeof bar.time === 'string' ? new Date(bar.time).getTime() : bar.time;
          const bucket = Math.floor(tMs / targetMs) * targetMs;

          if (!currentBar || bucket !== currentBucket) {
            if (currentBar) aggregated.push(currentBar);
            currentBucket = bucket;
            currentBar = {
              time: bar.time, // keep original format
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume
            };
          } else {
            currentBar.high = Math.max(currentBar.high, bar.high);
            currentBar.low = Math.min(currentBar.low, bar.low);
            currentBar.close = bar.close;
            currentBar.volume += bar.volume;
          }
        }
        if (currentBar) aggregated.push(currentBar);
        bars = aggregated;
      }
    }

    return NextResponse.json({
      bars,
      datasetInfo: {
        symbol: dataset.symbol,
        view_timeframe: viewTimeframe || dataset.timeframe,
      }
    });
  } catch (error: any) {
    console.error('Error fetching data:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
