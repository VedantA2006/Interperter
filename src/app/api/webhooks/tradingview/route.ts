import { NextResponse } from 'next/server';
import { readDb, writeDb, getNextId } from '@/db/localStore';
import crypto from 'crypto';

// TV secret for authentication
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'pine_secret';

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    
    // Auth - simple token check for MVP (TV sends it in the payload or headers)
    // Here we'll expect a json payload with { "secret": "...", "data": {...} }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    
    if (payload.secret !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const db = await readDb();
    
    const now = new Date().toISOString();
    
    // Log the event
    const newEvent = {
      id: getNextId(db.webhookEvents),
      payload: payload.data,
      status: 'received',
      createdAt: now
    };
    
    db.webhookEvents.push(newEvent);
    
    // Verification Module
    // Example Payload Data: { "versionId": 1, "tradeId": "Long_1", "price": 2500, "action": "entry" }
    const { versionId, tradeId, price, action } = payload.data;
    
    if (versionId && tradeId && price && action) {
      // Find expected data (mocked expected data for MVP, normally we'd pull from backtest results)
      const expectedPrice = price * 0.999; // Mock expected slippage
      
      const consistencyScore = 100 - (Math.abs(price - expectedPrice) / expectedPrice * 100);
      
      const newResult = {
        id: getNextId(db.forwardTestResults),
        versionId,
        tradeId,
        actualEntryTime: Date.now(),
        expectedEntryTime: Date.now(),
        actualPrice: price,
        expectedPrice: expectedPrice,
        consistencyScore: consistencyScore > 0 ? consistencyScore : 0,
        createdAt: now
      };
      
      db.forwardTestResults.push(newResult);
      db.webhookEvents[db.webhookEvents.length - 1].status = 'processed';
    } else {
      db.webhookEvents[db.webhookEvents.length - 1].status = 'failed';
    }
    
    await writeDb(db);
    
    return NextResponse.json({ success: true, eventId: newEvent.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
