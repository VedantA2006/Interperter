import { NextResponse } from 'next/server';
import { readDb, writeDb, getNextId } from '@/db/localStore';
import { LocalCSVProvider } from '@/lib/market-data/historical-provider';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'datasets');

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const symbol = (formData.get('symbol') as string || 'XAUUSD').toUpperCase().trim();
    const timeframe = (formData.get('timeframe') as string || '1m').toLowerCase().trim();
    const sourceName = (formData.get('source_name') as string || 'user_import').trim();

    if (!file) {
      return NextResponse.json({ error: 'No CSV file provided.' }, { status: 400 });
    }

    const csvText = await file.text();
    const provider = new LocalCSVProvider();
    const { bars, report, data_hash } = await provider.parseCSV(csvText, symbol, timeframe);

    // Return report immediately if INVALID — do not persist
    if (report.status === 'INVALID') {
      return NextResponse.json({ report }, { status: 422 });
    }

    // Ensure the data directory exists
    await fs.mkdir(DATA_DIR, { recursive: true });

    // Build slug-style dataset_id
    const startYear = new Date(bars[0].time).getUTCFullYear();
    const endYear   = new Date(bars[bars.length - 1].time).getUTCFullYear();
    const slugBase  = `${symbol.toLowerCase()}_${timeframe}_${startYear}_${endYear}`;
    const dataset_id = `${slugBase}_${data_hash.slice(0, 8)}`;

    // Save validated bars as JSON for fast reads during backtests
    const dataFilename = `${dataset_id}.json`;
    const dataFilePath  = path.join(DATA_DIR, dataFilename);
    await fs.writeFile(dataFilePath, JSON.stringify(bars));

    // Persist metadata to the database
    const db = await readDb();
    if (!db.historicalDatasets) db.historicalDatasets = [];

    const newDataset = {
      id: getNextId(db.historicalDatasets),
      dataset_id,
      symbol,
      source_name: sourceName,
      timeframe,
      start_timestamp: bars[0].time,
      end_timestamp: bars[bars.length - 1].time,
      candle_count: bars.length,
      imported_at: new Date().toISOString(),
      data_hash,
      data_path: path.join('data', 'datasets', dataFilename),
      quality_status: report.status,
      quality_warnings: report.warnings,
    };

    db.historicalDatasets.push(newDataset);
    await writeDb(db);

    return NextResponse.json({ dataset: newDataset, report }, { status: 201 });
  } catch (error: any) {
    console.error('[/api/datasets/import] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
