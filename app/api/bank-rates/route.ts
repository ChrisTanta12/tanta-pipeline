import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { getAllBanks } from '@/app/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  // Opt out of every layer of Next.js caching. Even with `dynamic =
  // 'force-dynamic'`, warm function instances were serving responses
  // compiled from older build artefacts; noStore() is the explicit
  // per-call "never cache this" primitive.
  noStore();

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
