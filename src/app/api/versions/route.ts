import { NextResponse } from 'next/server';
import { readDb, writeDb, getNextId } from '@/db/localStore';

export async function POST(req: Request) {
  try {
    const { strategyId, parentVersionId, sourceCode, hypothesis } = await req.json();
    const db = await readDb();
    
    // Find the parent strategy to update its updatedAt timestamp
    const strategyIndex = db.strategies.findIndex(s => s.id === strategyId);
    if (strategyIndex === -1) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    }

    // Determine the next version string (e.g., V1.2)
    const strategyVersions = db.strategyVersions
      .filter(v => v.strategyId === strategyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
    const latestVersion = strategyVersions.length > 0 ? strategyVersions[0] : null;
    
    let nextVersionStr = 'V1';
    if (latestVersion) {
      const parts = latestVersion.versionStr.split('.');
      if (parts.length === 1) {
        nextVersionStr = `${parts[0]}.1`;
      } else {
        const minor = parseInt(parts[1]);
        nextVersionStr = `${parts[0]}.${minor + 1}`;
      }
    }

    const now = new Date().toISOString();
    
    const newVersion = {
      id: getNextId(db.strategyVersions),
      strategyId,
      parentVersionId: parentVersionId || null,
      versionStr: nextVersionStr,
      sourceCode,
      hypothesis,
      status: 'candidate',
      createdAt: now,
    };
    
    db.strategyVersions.push(newVersion);
    db.strategies[strategyIndex].updatedAt = now;
    
    await writeDb(db);
    
    return NextResponse.json(newVersion);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
