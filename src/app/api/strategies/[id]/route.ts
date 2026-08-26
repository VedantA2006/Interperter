// @ts-nocheck
import { NextResponse } from 'next/server';
import { readDb, writeDb } from '@/db/localStore';

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await context.params;
    const id = parseInt(rawId);
    
    const db = await readDb();
    const strategy = db.strategies.find(s => s.id === id);
    
    if (!strategy) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    }
    
    const strategyVersions = db.strategyVersions
      .filter(v => v.strategyId === id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
    return NextResponse.json({ ...strategy, versions: strategyVersions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await context.params;
    const id = parseInt(rawId);
    const { name, description } = await req.json();
    
    const db = await readDb();
    const strategyIndex = db.strategies.findIndex(s => s.id === id);
    
    if (strategyIndex === -1) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    }
    
    db.strategies[strategyIndex] = {
      ...db.strategies[strategyIndex],
      name,
      description,
      updatedAt: new Date().toISOString()
    };
    
    await writeDb(db);
    return NextResponse.json(db.strategies[strategyIndex]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
