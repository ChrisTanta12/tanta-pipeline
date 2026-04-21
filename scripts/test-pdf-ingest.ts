/**
 * Manually runs the bank-update ingest pipeline against a single Gmail
 * message. Useful for verifying the PDF-to-vision path (e.g. Kiwibank rate
 * cards) without waiting for the cron to fire, and without writing to the
 * database.
 *
 * Usage:
 *   npm run ingest:test -- --message-id <gmailMessageId>
 *   npm run ingest:test -- --message-id <gmailMessageId> --bank kiwibank
 *
 * Required env vars (same as the cron):
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
 *   ANTHROPIC_API_KEY
 *
 * This script does NOT mutate banks.data or the ingestion_log — it only
 * prints what the pipeline would have produced.
 */
import { gmailClient, fetchMessage } from '../app/lib/gmail';
import { BANK_LABELS } from '../app/lib/parsers';
import { processEmail } from '../app/lib/ingest';
import type { BankId } from '../app/lib/types';

function parseArgs(argv: string[]): { messageId?: string; bank?: BankId } {
  const out: { messageId?: string; bank?: BankId } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--message-id' || a === '-m') && argv[i + 1]) {
      out.messageId = argv[++i];
    } else if ((a === '--bank' || a === '-b') && argv[i + 1]) {
      out.bank = argv[++i] as BankId;
    }
  }
  return out;
}

function describeAttachment(data: Buffer): string {
  const bytes = data.byteLength;
  const kb = (bytes / 1024).toFixed(1);
  const mb = (bytes / 1024 / 1024).toFixed(2);
  return bytes < 1024 * 1024 ? `${kb} KB` : `${mb} MB`;
}

async function main() {
  const { messageId, bank } = parseArgs(process.argv.slice(2));
  if (!messageId) {
    console.error('Usage: npm run ingest:test -- --message-id <gmailMessageId> [--bank <bankId>]');
    process.exit(2);
  }

  console.log(`→ fetching Gmail message ${messageId} ...`);
  const gmail = gmailClient();
  const email = await fetchMessage(gmail, messageId);

  console.log(`✓ message from: ${email.from}`);
  console.log(`  subject:      ${email.subject}`);
  console.log(`  date:         ${email.date}`);
  console.log(`  plaintext:    ${email.plaintext.length} chars`);
  console.log(`  htmlBody:     ${email.htmlBody.length} chars`);
  console.log(`  inlineImages: ${email.inlineImages.length}`);
  for (const img of email.inlineImages) {
    console.log(`    - cid=${img.cid} ${img.mimeType} (${describeAttachment(img.data)})`);
  }
  console.log(`  attachments:  ${email.attachments.length}`);
  for (const att of email.attachments) {
    console.log(`    - ${att.filename} ${att.mimeType} (${describeAttachment(att.data)})`);
  }

  const pdfs = email.attachments.filter(a => a.mimeType === 'application/pdf');
  console.log(`  → ${pdfs.length} PDF attachment(s) will be fed to vision`);

  // Pick the bank: explicit flag wins, otherwise guess from sender or subject.
  let mapping = bank
    ? BANK_LABELS.find(m => m.bankId === bank)
    : undefined;

  if (!mapping) {
    const haystack = `${email.from} ${email.subject}`.toLowerCase();
    mapping = BANK_LABELS.find(m => haystack.includes(m.bankId));
  }

  if (!mapping) {
    console.error(
      '✗ could not infer bank from sender/subject. Re-run with --bank <anz|asb|bnz|westpac|kiwibank>',
    );
    process.exit(3);
  }

  console.log(`→ running pipeline as bank=${mapping.bankId} (hasImageContent=${mapping.hasImageContent}) ...`);
  const result = await processEmail(
    mapping.bankId,
    email,
    mapping.textParser,
    mapping.hasImageContent,
  );

  console.log('\n=== RESULT ===');
  console.log(`status:      ${result.status}`);
  console.log(`parser:      ${result.parser}`);
  console.log(`needsReview: ${result.needsReview ?? false}`);
  if (result.error) console.log(`error:       ${result.error}`);
  console.log('\npatch:');
  console.log(JSON.stringify(result.patch ?? {}, null, 2));
  console.log('\nchanges:');
  console.log(JSON.stringify(result.changes ?? {}, null, 2));

  console.log('\n(no database writes were performed)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
