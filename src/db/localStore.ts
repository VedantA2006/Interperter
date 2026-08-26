import fs from 'fs/promises';
import path from 'path';

export interface StrategyStore {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface VersionStore {
  id: number;
  strategyId: number;
  parentVersionId: number | null;
  versionStr: string;
  sourceCode: string;
  hypothesis: string | null;
  status: string;
  createdAt: string;
}

export interface WebhookEventStore {
  id: number;
  payload: any;
  status: string;
  createdAt: string;
}

export interface ForwardTestResultStore {
  id: number;
  versionId: number;
  tradeId: string;
  expectedEntryTime: number | null;
  actualEntryTime: number | null;
  expectedPrice: number | null;
  actualPrice: number | null;
  consistencyScore: number | null;
  createdAt: string;
}

export interface HistoricalDatasetStore {
  id: number;
  dataset_id: string;       // slug like "xauusd_1m_2020_2024"
  symbol: string;
  source_name: string;
  timeframe: string;        // "1m", "5m", "15m", "30m", "1h", "4h", "1d"
  start_timestamp: number;  // UTC ms
  end_timestamp: number;    // UTC ms
  candle_count: number;
  imported_at: string;      // ISO string
  data_hash: string;        // SHA-256 hex
  data_path: string;        // relative path to stored JSON file
  quality_status: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';
  quality_warnings: string[];
}

export interface LocalDbData {
  strategies: StrategyStore[];
  strategyVersions: VersionStore[];
  webhookEvents: WebhookEventStore[];
  forwardTestResults: ForwardTestResultStore[];
  historicalDatasets: HistoricalDatasetStore[];
}

const DB_PATH = path.join(process.cwd(), 'local_db.json');

const defaultData: LocalDbData = {
  strategies: [],
  strategyVersions: [],
  webhookEvents: [],
  forwardTestResults: [],
  historicalDatasets: []
};

export async function readDb(): Promise<LocalDbData> {
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(DB_PATH, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    throw error;
  }
}

export async function writeDb(data: LocalDbData): Promise<void> {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// Helpers for Auto-Increment IDs
export function getNextId(collection: any[]): number {
  if (collection.length === 0) return 1;
  return Math.max(...collection.map(item => item.id)) + 1;
}
