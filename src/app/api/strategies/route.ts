import { NextResponse } from 'next/server';
import { readDb, writeDb, getNextId } from '@/db/localStore';

export async function GET() {
  try {
    const db = await readDb();
    
    const allStrategies = db.strategies.map(s => {
      // Find latest version
      const strategyVersions = db.strategyVersions
        .filter(v => v.strategyId === s.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      return {
        ...s,
        versions: strategyVersions.length > 0 ? [strategyVersions[0]] : []
      };
    });
    
    // Sort by updated at
    allStrategies.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    
    return NextResponse.json(allStrategies);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, description, sourceCode } = await req.json();
    const db = await readDb();
    
    const now = new Date().toISOString();
    const newStrategy = {
      id: getNextId(db.strategies),
      name,
      description,
      createdAt: now,
      updatedAt: now,
    };
    
    const newVersion = {
      id: getNextId(db.strategyVersions),
      strategyId: newStrategy.id,
      parentVersionId: null,
      versionStr: 'V1',
      sourceCode: sourceCode || '',
      hypothesis: 'Initial implementation',
      status: 'candidate',
      createdAt: now,
    };
    
    db.strategies.push(newStrategy);
    db.strategyVersions.push(newVersion);
    await writeDb(db);
    
    return NextResponse.json({ strategy: newStrategy, version: newVersion });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
