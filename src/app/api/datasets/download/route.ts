import { NextResponse } from 'next/server';
import { readDb, writeDb, getNextId } from '@/db/localStore';
import { LocalCSVProvider } from '@/lib/market-data/historical-provider';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'datasets');

// Map UI timeframe strings to dukascopy-node timeframe strings
const TF_MAP: Record<string, string> = {
  '1m':  'm1',
  '5m':  'm5',
  '15m': 'm15',
  '30m': 'm30',
  '1h':  'h1',
  '4h':  'h4',
  '1d':  'd1',
};

// Generate monthly chunks between two dates
function generateMonthlyChunks(fromDate: string, toDate: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  const start = new Date(fromDate + 'T00:00:00Z');
  const end   = new Date(toDate   + 'T00:00:00Z');

  let current = new Date(start);
  while (current < end) {
    const chunkStart = new Date(current);
    // Next month
    const chunkEnd = new Date(current);
    chunkEnd.setUTCMonth(chunkEnd.getUTCMonth() + 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    chunks.push({
      from: chunkStart.toISOString().slice(0, 10),
      to:   chunkEnd.toISOString().slice(0, 10),
    });

    current = new Date(chunkEnd);
  }
  return chunks;
}

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  const body = await req.json();
  const {
    symbol     = 'XAUUSD',
    timeframe  = '5m',
    priceType  = 'bid',
    fromDate,
    toDate,
    sourceName = 'dukascopy',
  } = body;

  if (!fromDate || !toDate) {
    return NextResponse.json({ error: 'fromDate and toDate are required.' }, { status: 400 });
  }

  const dukaTf = TF_MAP[timeframe];
  if (!dukaTf) {
    return NextResponse.json({ error: `Unsupported timeframe: ${timeframe}` }, { status: 400 });
  }

  const instrument = symbol.toLowerCase();
  const chunks = generateMonthlyChunks(fromDate, toDate);
  const totalChunks = chunks.length;

  // ── Streaming response using Server-Sent Events ──
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ type: 'start', totalChunks, symbol, timeframe, fromDate, toDate });

        let allBars: any[] = [];
        let completedChunks = 0;
        let failedChunks = 0;

        for (const chunk of chunks) {
          send({
            type: 'chunk_start',
            chunkIndex: completedChunks + 1,
            totalChunks,
            from: chunk.from,
            to: chunk.to,
          });

          try {
            // Dynamic import to avoid issues with ESM/CJS in Next.js
            const { getHistoricalRates } = await import('dukascopy-node');

            const rates = await getHistoricalRates({
              instrument: instrument as any,
              dates: { from: chunk.from, to: chunk.to },
              timeframe: dukaTf as any,
              priceType: priceType as any,
            });

            // dukascopy-node returns: Array<[timestamp, open, high, low, close, volume]>
            const chunkBars = (rates as any[]).map((r: any) => {
              // r is [timestamp_ms, open, high, low, close, volume] or an object
              if (Array.isArray(r)) {
                return { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] ?? 0 };
              }
              return { time: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume ?? 0 };
            });

            allBars = allBars.concat(chunkBars);
            completedChunks++;

            const pct = Math.round((completedChunks / totalChunks) * 100);
            send({
              type: 'chunk_done',
              chunkIndex: completedChunks,
              totalChunks,
              from: chunk.from,
              to: chunk.to,
              barsInChunk: chunkBars.length,
              totalBars: allBars.length,
              progressPct: pct,
            });
          } catch (chunkErr: any) {
            failedChunks++;
            completedChunks++;
            send({
              type: 'chunk_error',
              chunkIndex: completedChunks,
              totalChunks,
              from: chunk.from,
              to: chunk.to,
              error: chunkErr.message || 'Unknown error',
            });
          }

          // Small delay to avoid hammering the server
          await new Promise(r => setTimeout(r, 100));
        }

        // ── Post-processing ──
        send({ type: 'processing', message: 'Sorting and deduplicating...' });

        // Sort chronologically
        allBars.sort((a, b) => a.time - b.time);

        // Remove duplicates by timestamp
        const seen = new Set<number>();
        const dedupedBars = allBars.filter(b => {
          if (seen.has(b.time)) return false;
          seen.add(b.time);
          return true;
        });

        // OHLC validation
        send({ type: 'processing', message: 'Validating OHLC integrity...' });
        const validBars = dedupedBars.filter(b =>
          b.open > 0 && b.high > 0 && b.low > 0 && b.close > 0 &&
          b.high >= b.open && b.high >= b.close && b.high >= b.low &&
          b.low <= b.open && b.low <= b.close
        );

        const invalidCount = dedupedBars.length - validBars.length;

        // Gap detection
        const TF_MS: Record<string, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
        const intervalMs = TF_MS[timeframe] || 300000;
        let gapCount = 0;
        for (let i = 1; i < validBars.length; i++) {
          const diff = validBars[i].time - validBars[i - 1].time;
          if (diff > intervalMs * 3) gapCount++; // >3 bar gaps
        }

        if (validBars.length === 0) {
          send({ type: 'error', message: 'No valid bars downloaded. The date range may have no market data.' });
          controller.close();
          return;
        }

        // Compute hash
        send({ type: 'processing', message: 'Computing data hash...' });
        const hashInput = validBars.map(b => `${b.time},${b.open},${b.high},${b.low},${b.close}`).join('\n');
        const data_hash = crypto.createHash('sha256').update(hashInput).digest('hex');

        // Save to disk
        send({ type: 'processing', message: 'Saving dataset...' });
        await fs.mkdir(DATA_DIR, { recursive: true });

        const startYear = new Date(validBars[0].time).getUTCFullYear();
        const endYear   = new Date(validBars[validBars.length - 1].time).getUTCFullYear();
        const dataset_id = `${instrument}_${timeframe}_${priceType}_${startYear}_${endYear}_${data_hash.slice(0, 8)}`;
        const dataFilename = `${dataset_id}.json`;
        const dataFilePath = path.join(DATA_DIR, dataFilename);

        await fs.writeFile(dataFilePath, JSON.stringify(validBars));

        // Save metadata
        const db = await readDb();
        if (!db.historicalDatasets) db.historicalDatasets = [];

        const warnings: string[] = [];
        if (failedChunks > 0) warnings.push(`${failedChunks} of ${totalChunks} monthly chunks failed to download.`);
        if (invalidCount > 0) warnings.push(`${invalidCount} bars removed due to invalid OHLC values.`);
        if (gapCount > 0) warnings.push(`${gapCount} significant data gaps detected (weekend closures excluded).`);

        const newDataset = {
          id: getNextId(db.historicalDatasets),
          dataset_id,
          symbol: symbol.toUpperCase(),
          source_name: sourceName,
          timeframe,
          start_timestamp: validBars[0].time,
          end_timestamp: validBars[validBars.length - 1].time,
          candle_count: validBars.length,
          imported_at: new Date().toISOString(),
          data_hash,
          data_path: path.join('data', 'datasets', dataFilename),
          quality_status: ((failedChunks === 0 && invalidCount === 0 && gapCount === 0) ? 'VALID' : 'VALID_WITH_WARNINGS') as 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID',
          quality_warnings: warnings,
        };

        db.historicalDatasets.push(newDataset);
        await writeDb(db);

        send({
          type: 'complete',
          dataset: newDataset,
          stats: {
            totalChunks,
            completedChunks: totalChunks - failedChunks,
            failedChunks,
            totalBars: validBars.length,
            invalidBarsRemoved: invalidCount,
            gapsDetected: gapCount,
            data_hash,
            period_start: new Date(validBars[0].time).toISOString().slice(0, 10),
            period_end: new Date(validBars[validBars.length - 1].time).toISOString().slice(0, 10),
          },
        });
      } catch (err: any) {
        send({ type: 'error', message: err.message || 'Unexpected error during download.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
