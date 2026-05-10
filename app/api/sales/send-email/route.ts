import { NextRequest, NextResponse } from 'next/server';
import { isSalesAuthorized } from '@/app/lib/sales/auth';

export const dynamic = 'force-dynamic';

/**
 * Sends a markdown email via Brevo transactional. Used by the weekly
 * "Monday Sales Brief" routine (a scheduled remote Claude agent) which
 * composes the body then POSTs here to deliver. Keeping the Brevo key
 * server-side means the routine prompt never has to carry it.
 *
 * Auth: same Bearer-token / finance-cookie check as the rest of /api/sales.
 *
 * Request body:
 *   {
 *     "to":       "chris@tanta.co.nz",        // optional, defaults to SALES_EMAIL_TO env or chris@tanta.co.nz
 *     "subject":  "Monday Sales Brief — week of ...",
 *     "markdown": "## Scorecard\n...",         // required
 *     "from":     "chris@tanta.co.nz"          // optional, defaults to SALES_EMAIL_FROM env
 *   }
 *
 * Required env:
 *   BREVO_API_KEY        — already set, used by brevo-sync as well
 *   SALES_EMAIL_FROM     — verified Brevo sender (e.g. chris@tanta.co.nz)
 *   SALES_EMAIL_TO       — default recipient (e.g. chris@tanta.co.nz)
 */
export async function POST(req: NextRequest) {
  if (!isSalesAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'BREVO_API_KEY not configured' }, { status: 500 });
  }
  const defaultFrom = process.env.SALES_EMAIL_FROM || 'chris@tanta.co.nz';
  const defaultTo = process.env.SALES_EMAIL_TO || 'chris@tanta.co.nz';

  let body: { to?: string; from?: string; subject?: string; markdown?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.markdown || typeof body.markdown !== 'string' || body.markdown.length === 0) {
    return NextResponse.json({ error: 'markdown required' }, { status: 400 });
  }
  if (body.markdown.length > 200_000) {
    return NextResponse.json({ error: 'markdown too large (>200kb)' }, { status: 400 });
  }

  const to = (body.to || defaultTo).trim();
  const from = (body.from || defaultFrom).trim();
  const subject = (body.subject || 'Sales brief').slice(0, 200);

  // Brevo transactional accepts htmlContent or textContent. Send both:
  // textContent = the raw markdown (good fallback in plain-text clients);
  // htmlContent = a minimal markdown→HTML pass so mobile + Gmail render
  // headings / lists / tables. Deliberately tiny — keeps this endpoint
  // dependency-free.
  const html = renderMinimalHtml(body.markdown);

  const payload = {
    sender: { email: from },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: body.markdown,
  };

  let brevoStatus = 0;
  let brevoBody = '';
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'accept': 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    brevoStatus = res.status;
    brevoBody = await res.text();
  } catch (err: any) {
    return NextResponse.json({ error: 'brevo fetch failed', detail: err.message }, { status: 502 });
  }
  if (brevoStatus < 200 || brevoStatus >= 300) {
    // Strip the api key from any error message before returning, just in case.
    const safe = brevoBody.replace(apiKey, '[redacted]').slice(0, 500);
    return NextResponse.json(
      { error: 'brevo rejected the send', status: brevoStatus, detail: safe },
      { status: 502 },
    );
  }

  // Try to parse a messageId for the audit response.
  let messageId: string | null = null;
  try { messageId = (JSON.parse(brevoBody) as { messageId?: string }).messageId ?? null; } catch {}
  return NextResponse.json({ ok: true, messageId, to, from });
}

/**
 * Tiny markdown-to-HTML renderer covering the constructs the routine
 * actually emits: h1/h2, paragraphs, unordered lists, tables, bold,
 * inline code. Anything else falls through to <pre>-wrapped lines so
 * we never break the email if the routine ad-libs syntax we don't
 * handle.
 *
 * Avoids pulling in marked / remark / etc. — adding a dep needs
 * discussion per CLAUDE.md and this is small enough to stay inline.
 */
function renderMinimalHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  const inline = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++; continue;
    }
    // Table — simple "| a | b |" shape with separator row
    if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s|:-]+\|?$/.test(lines[i + 1].trim())) {
      const headers = line.split('|').map((s) => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].split('|').map((s) => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        rows.push(cells);
        i++;
      }
      out.push('<table style="border-collapse:collapse;border:1px solid #ddd;margin:12px 0">');
      out.push('<thead><tr>' + headers.map((h) => `<th style="border:1px solid #ddd;padding:6px 10px;text-align:left;background:#f5f5f5">${inline(h)}</th>`).join('') + '</tr></thead>');
      out.push('<tbody>');
      for (const r of rows) {
        out.push('<tr>' + r.map((c) => `<td style="border:1px solid #ddd;padding:6px 10px">${inline(c)}</td>`).join('') + '</tr>');
      }
      out.push('</tbody></table>');
      continue;
    }
    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      out.push('<ul>');
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        out.push('<li>' + inline(lines[i].replace(/^[-*]\s+/, '')) + '</li>');
        i++;
      }
      out.push('</ul>');
      continue;
    }
    // Blank
    if (line.trim() === '') { i++; continue; }
    // Paragraph (collect contiguous non-blank lines)
    let para = inline(line);
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#/.test(lines[i]) &&
      !/^[-*]\s/.test(lines[i]) &&
      !lines[i].startsWith('|')
    ) {
      para += ' ' + inline(lines[i]);
      i++;
    }
    out.push('<p>' + para + '</p>');
  }
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222;max-width:680px;line-height:1.5">${out.join('\n')}</body></html>`;
}

