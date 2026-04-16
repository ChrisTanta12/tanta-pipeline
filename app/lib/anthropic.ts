import Anthropic from '@anthropic-ai/sdk';
import type { BankId, BankData } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VISION_MODEL = 'claude-opus-4-7';

const SYSTEM = `You extract NZ mortgage bank rate-card data from screenshots of broker update emails.
Return STRICT JSON matching the BankData schema. Use null for fields not visible.
Rate values are percentages as numbers (e.g. 4.49, not 0.0449 and not "4.49%").
If you are uncertain about a field, set it to null rather than guessing.
Return ONLY the JSON object, no markdown.`;

export interface VisionParseResult {
  patch: Partial<BankData>;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

/**
 * Asks Claude to read rate-card images and produce a structured BankData patch.
 * Pass every image attached to the email; Claude will synthesise across them.
 */
export async function parseImagesWithVision(
  bankId: BankId,
  images: Array<{ mimeType: string; data: Buffer }>,
  emailSubject: string,
): Promise<VisionParseResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }
  if (images.length === 0) {
    return { patch: {}, confidence: 'low', notes: 'No images to parse' };
  }

  const prompt = `Extract rate/traffic-light/turnaround data for ${bankId.toUpperCase()}.
Email subject: "${emailSubject}"

Return JSON shaped like:
{
  "rateCard": {
    "6mo":  { "lte80": number|null, "gt80": number|null },
    "1y":   { "lte80": number|null, "gt80": number|null },
    "18mo": { ... },
    "2y":   { ... },
    "3y":   { ... },
    "4y":   { ... },
    "5y":   { ... },
    "floating": { ... }
  },
  "trafficLights": {
    "lte80":  { "existing": string|null, "new": string|null },
    "80_90":  { "existing": string|null, "new": string|null }
  },
  "turnaround": { "retail": number|null, "business": number|null },
  "serviceRate": number|null,
  "_confidence": "high" | "medium" | "low",
  "_notes": "brief note on anything uncertain"
}

Only include keys you can confidently read. Omit the rest.`;

  const content = [
    ...images.map(img => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: img.data.toString('base64'),
      },
    })),
    { type: 'text' as const, text: prompt },
  ];

  const res = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });

  const textBlock = res.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return { patch: {}, confidence: 'low', notes: 'No text response from model' };
  }

  const cleaned = textBlock.text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { patch: {}, confidence: 'low', notes: `Unparseable JSON: ${cleaned.slice(0, 200)}` };
  }

  const { _confidence, _notes, ...patch } = parsed;
  return {
    patch,
    confidence: (_confidence as 'high' | 'medium' | 'low') ?? 'medium',
    notes: _notes,
  };
}
