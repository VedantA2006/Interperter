const { getHistoricalRates } = require('dukascopy-node');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'datasets');
const DB_PATH = path.join(__dirname, '..', 'local_db.json');

async function main() {
  console.log('Starting XAUUSD 5m data download for the last 3 months...');
  
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - 3);

  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  try {
    const rates = await getHistoricalRates({
      instrument: 'xauusd',
      dates: { from: fromStr, to: toStr },
      timeframe: 'm5',
      priceType: 'bid',
    });

    console.log(`Downloaded ${rates.length} raw candles.`);

    // Map to engine format
    const bars = rates.map(r => {
      if (Array.isArray(r)) {
        return { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] ?? 0 };
      }
      return { time: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume ?? 0 };
    });

    // Sort & Dedup
    bars.sort((a, b) => a.time - b.time);
    const seen = new Set();
    const dedupedBars = bars.filter(b => {
      if (seen.has(b.time)) return false;
      seen.add(b.time);
      return true;
    });

    const validBars = dedupedBars.filter(b =>
      b.open > 0 && b.high > 0 && b.low > 0 && b.close > 0 &&
      b.high >= b.open && b.high >= b.close && b.high >= b.low &&
      b.low <= b.open && b.low <= b.close
    );

    console.log(`Validated ${validBars.length} candles.`);

    if (validBars.length === 0) {
      console.log('No valid bars. Exiting.');
      return;
    }

    const hashInput = validBars.map(b => `${b.time},${b.open},${b.high},${b.low},${b.close}`).join('\n');
    const data_hash = crypto.createHash('sha256').update(hashInput).digest('hex');

    fs.mkdirSync(DATA_DIR, { recursive: true });

    const startYear = new Date(validBars[0].time).getUTCFullYear();
    const endYear   = new Date(validBars[validBars.length - 1].time).getUTCFullYear();
    const dataset_id = `xauusd_5m_bid_${startYear}_${endYear}_${data_hash.slice(0, 8)}`;
    const dataFilename = `${dataset_id}.json`;
    const dataFilePath = path.join(DATA_DIR, dataFilename);

    fs.writeFileSync(dataFilePath, JSON.stringify(validBars));

    // Update local_db.json
    let db = { historicalDatasets: [] };
    if (fs.existsSync(DB_PATH)) {
      db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }

    const newId = db.historicalDatasets.length > 0 
      ? Math.max(...db.historicalDatasets.map(d => d.id)) + 1 
      : 1;

    const newDataset = {
      id: newId,
      dataset_id,
      symbol: 'XAUUSD',
      source_name: 'dukascopy',
      timeframe: '5m',
      start_timestamp: validBars[0].time,
      end_timestamp: validBars[validBars.length - 1].time,
      candle_count: validBars.length,
      imported_at: new Date().toISOString(),
      data_hash,
      data_path: `data/datasets/${dataFilename}`,
      quality_status: 'VALID',
      quality_warnings: [],
    };

    db.historicalDatasets.push(newDataset);
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

    console.log(`Dataset successfully saved with ID: ${newId} -> ${dataset_id}`);

  } catch (error) {
    console.error('Error downloading data:', error);
  }
}

main();
