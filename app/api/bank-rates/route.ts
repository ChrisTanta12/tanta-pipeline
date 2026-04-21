import { NextResponse } from 'next/server';
import { getAllBanks } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const banks = await getAllBanks();
    return NextResponse.json(
      { banks, fetchedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to load bank rates', detail: err.message },
      { status: 500 }
    );
  }
}
