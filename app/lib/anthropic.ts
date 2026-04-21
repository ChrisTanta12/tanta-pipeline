import Anthropic from '@anthropic-ai/sdk';
import type { BankId, BankData } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VISION_MODEL = 'claude-opus-4-7';

// Anthropic PDF size limits: 32MB per doc, 100 pages. We cap at 30MB to leave
// headroom for request overhead (base64 inflates by ~33%).
const MAX_PDF_BYTES = 30 * 1024 * 1024;

// Beta flag required in SDK 0.32.1 for PDF (document) content blocks.
const PDF_BETA = 'pdfs-2024-09-25';

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

export type VisionImageInput = { mimeType: string; data: Buffer };
export type VisionPdfInput = { mimeType: string; data: Buffer; filename?: string };

/**
 * Asks Claude to read rate-card images and/or PDF attachments and produce a
 * structured BankData patch. Pass every image + PDF attached to the email;
 * Claude will synthesise across them.
 *
 * PDF support uses the beta Messages API in SDK 0.32.1 (pdfs-2024-09-25).
 */
export async function parseAttachmentsWithVision(
  bankId: BankId,
  images: VisionImageInput[],
  pdfs: VisionPdfInput[],
  emailSubject: string,
): Promise<VisionParseResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }
  if (images.length === 0 && pdfs.length === 0) {
    return { patch: {}, confidence: 'low', notes: 'No images or PDFs to parse' };
  }

  // Guard: drop PDFs that are individually too large, and if the total
  // exceeds the cap drop all PDFs rather than sending a truncated set.
  const acceptedPdfs: VisionPdfInput[] = [];
  let skippedPdfNote: string | undefined;
  {
    const oversize = pdfs.filter(p => p.data.byteLength > MAX_PDF_BYTES);
    const sized = pdfs.filter(p => p.data.byteLength <= MAX_PDF_BYTES);
    const totalBytes = sized.reduce((a, p) => a + p.data.byteLength, 0);
    if (oversize.length > 0) {
      const names = oversize.map(p => p.filename ?? 'unnamed').join(', ');
      console.warn(
        `[vision] skipping ${oversize.length} oversize PDF(s) (>${MAX_PDF_BYTES} bytes): ${names}`,
      );
      skippedPdfNote = `Skipped oversize PDF(s): ${names}`;
    }
    if (totalBytes > MAX_PDF_BYTES) {
      console.warn(
        `[vision] total PDF payload ${totalBytes} bytes exceeds cap ${MAX_PDF_BYTES}; dropping all PDFs`,
      );
      skippedPdfNote = `Total PDF payload ${totalBytes} bytes > cap ${MAX_PDF_BYTES}; dropped all PDFs`;
    } else {
      acceptedPdfs.push(...sized);
    }
  }

  const hasPdfs = acceptedPdfs.length > 0;

  const sourceDescription = hasPdfs
    ? 'inline images and/or a PDF rate card'
    : 'inline images';

  const prompt = `Extract rate/traffic-light/turnaround data for ${bankId.toUpperCase()}.
You'll receive ${sourceDescription} from the bank.
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

  // When PDFs are present we must hit the beta endpoint; its param types are
  // BetaContentBlockParam. When no PDFs are present we can stay on the
  // stable endpoint to avoid the extra beta flag.
  const textBlockText = await (hasPdfs
    ? callBetaWithPdfs(acceptedPdfs, images, prompt)
    : callStableImagesOnly(images, prompt));

  if (!textBlockText) {
    return { patch: {}, confidence: 'low', notes: 'No text response from model' };
  }

  const cleaned = textBlockText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { patch: {}, confidence: 'low', notes: `Unparseable JSON: ${cleaned.slice(0, 200)}` };
  }

  const { _confidence, _notes, ...patch } = parsed;
  const notes = [skippedPdfNote, _notes].filter(Boolean).join(' | ') || undefined;
  return {
    patch,
    confidence: (_confidence as 'high' | 'medium' | 'low') ?? 'medium',
    notes,
  };
}

async function callStableImagesOnly(
  images: VisionImageInput[],
  prompt: string,
): Promise<string | null> {
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
  return textBlock && textBlock.type === 'text' ? textBlock.text : null;
}

async function callBetaWithPdfs(
  pdfs: VisionPdfInput[],
  images: VisionImageInput[],
  prompt: string,
): Promise<string | null> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images.map(img => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: img.data.toString('base64'),
      },
    })),
    ...pdfs.map(p => ({
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: 'application/pdf' as const,
        data: p.data.toString('base64'),
      },
    })),
    { type: 'text' as const, text: prompt },
  ];

  const res = await client.beta.messages.create({
    model: VISION_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    betas: [PDF_BETA],
  });

  const textBlock = res.content.find(b => b.type === 'text');
  return textBlock && textBlock.type === 'text' ? textBlock.text : null;
}

/**
 * Backward-compatible alias for the old images-only function.
 * Prefer `parseAttachmentsWithVision` which also accepts PDFs.
 */
export function parseImagesWithVision(
  bankId: BankId,
  images: VisionImageInput[],
  emailSubject: string,
): Promise<VisionParseResult> {
  return parseAttachmentsWithVision(bankId, images, [], emailSubject);
}
