import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await sql<{ data: any }>`
      SELECT data FROM trail_entities WHERE kind = 'pipeline' ORDER BY entity_id
    `;
    return NextResponse.json({ records: res.rows.map(r => r.data) });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to read pipelines from cache', detail: err.message },
      { status: 500 },
    );
  }
}
