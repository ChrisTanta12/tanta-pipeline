import { google, gmail_v1 } from 'googleapis';

/**
 * OAuth2 client with a long-lived refresh token.
 * Env vars required:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 */
function oauthClient() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground', // redirect uri used when generating refresh token
  );
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}

export function gmailClient(): gmail_v1.Gmail {
  return google.gmail({ version: 'v1', auth: oauthClient() });
}

export interface BankEmail {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;          // ISO
  plaintext: string;     // decoded body
  htmlBody: string;      // decoded html
  inlineImages: Array<{ cid: string; mimeType: string; data: Buffer }>;
  attachments: Array<{ filename: string; mimeType: string; data: Buffer }>;
}

/**
 * Search for messages under a Gmail label, newest first, since the given date (inclusive).
 */
export async function searchLabel(
  gmail: gmail_v1.Gmail,
  labelName: string,
  afterEpochSec?: number,
  max = 10,
): Promise<string[]> {
  const q = afterEpochSec ? `after:${afterEpochSec}` : 'newer_than:30d';
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: `label:"${labelName}" ${q}`,
    maxResults: max,
  });
  return (res.data.messages ?? []).map(m => m.id!).filter(Boolean);
}

/**
 * Fetch a full message and decode text + inline images + attachments.
 */
export async function fetchMessage(gmail: gmail_v1.Gmail, messageId: string): Promise<BankEmail> {
  const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const msg = res.data;

  const headers = new Map<string, string>();
  (msg.payload?.headers ?? []).forEach(h => headers.set((h.name ?? '').toLowerCase(), h.value ?? ''));

  const result: BankEmail = {
    messageId: msg.id!,
    threadId: msg.threadId!,
    subject: headers.get('subject') ?? '',
    from: headers.get('from') ?? '',
    date: new Date(Number(msg.internalDate)).toISOString(),
    plaintext: '',
    htmlBody: '',
    inlineImages: [],
    attachments: [],
  };

  const walk = async (part: gmail_v1.Schema$MessagePart) => {
    const mt = part.mimeType ?? '';
    const body = part.body;

    if (mt === 'text/plain' && body?.data) {
      result.plaintext += decode(body.data) + '\n';
    } else if (mt === 'text/html' && body?.data) {
      result.htmlBody += decode(body.data);
    } else if (mt.startsWith('image/') && body?.attachmentId) {
      const att = await gmail.users.messages.attachments.get({
        userId: 'me', messageId, id: body.attachmentId,
      });
      const data = Buffer.from(att.data.data!, 'base64url');
      const cidHeader = (part.headers ?? []).find(h => (h.name ?? '').toLowerCase() === 'content-id');
      const cid = (cidHeader?.value ?? '').replace(/[<>]/g, '');
      if (cid) result.inlineImages.push({ cid, mimeType: mt, data });
      else result.attachments.push({ filename: part.filename ?? 'image', mimeType: mt, data });
    } else if (body?.attachmentId && part.filename) {
      const att = await gmail.users.messages.attachments.get({
        userId: 'me', messageId, id: body.attachmentId,
      });
      result.attachments.push({
        filename: part.filename,
        mimeType: mt,
        data: Buffer.from(att.data.data!, 'base64url'),
      });
    }

    for (const p of part.parts ?? []) await walk(p);
  };

  if (msg.payload) await walk(msg.payload);
  return result;
}

function decode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}
