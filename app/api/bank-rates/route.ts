import { NextResponse } from 'next/server';
import { getAllBanks } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const banks = await getAllBanks();
    return NextResponse.json({ banks, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to load bank rates', detail: err.message },
      { status: 500 }
    );
  }
}
