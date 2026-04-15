import { NextResponse } from 'next/server';

const TRAIL_API_KEY = process.env.TRAIL_API_KEY || '';
const TRAIL_BASE_URL = process.env.TRAIL_BASE_URL || 'https://beta.api.gettrail.com/api/v1';

export async function GET() {
  if (!TRAIL_API_KEY) {
    return NextResponse.json({ error: 'Trail API key not configured' }, { status: 500 });
  }

  try {
    const response = await fetch(`${TRAIL_BASE_URL}/pipelines`, {
      headers: { 'Authorization': TRAIL_API_KEY },
      next: { revalidate: 3600 } // cache for 1 hour
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Trail API error: ${response.status}`, detail: text },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to connect to Trail API', detail: err.message },
      { status: 502 }
    );
  }
}
