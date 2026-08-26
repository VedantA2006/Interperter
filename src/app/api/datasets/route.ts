import { NextResponse } from 'next/server';
import { readDb } from '@/db/localStore';

export async function GET() {
  try {
    const db = await readDb();
    const datasets = (db.historicalDatasets || []).sort(
      (a, b) => new Date(b.imported_at).getTime() - new Date(a.imported_at).getTime()
    );
    return NextResponse.json({ datasets });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
