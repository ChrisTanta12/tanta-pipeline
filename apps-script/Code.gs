/**
 * Tanta Pipeline — Gmail → Gemini → Vercel bank-rate ingest.
 *
 * Runs on Google Apps Script under Chris's Tanta Workspace account.
 * Apps Script has native Gmail access via the user's session (no OAuth
 * to configure) and can run on a time trigger without a local machine.
 *
 * Architecture:
 *   run() [daily 10am NZT trigger]
 *     ├─ for each bank label in Gmail ("Bank Updates/<Bank>"):
 *     │   ├─ find recent messages not yet seen
 *     │   ├─ extract body + inline images + PDF attachments
 *     │   ├─ callGemini() → structured JSON patch
 *     │   └─ postToVercel() → /api/bank-rates-ingest writes to Neon
 *     └─ summary log
 *
 * SETUP (one-time):
 *   1. Go to https://script.google.com, create a new project named
 *      "Tanta Pipeline Rates Sync", paste this entire file into Code.gs.
 *   2. Project Settings → Script Properties → add three properties:
 *        GEMINI_API_KEY   — from https://aistudio.google.com/apikey (free tier)
 *        INGEST_SECRET    — a random string you also set in Vercel env
 *        VERCEL_URL       — https://tanta-pipeline.vercel.app (or your preview URL)
 *   3. Run once manually: select the `run` function → Run.
 *      First run will prompt for Gmail permissions — grant them.
 *      Second run should print a summary in View → Executions.
 *   4. Then run `installDailyTrigger` once to schedule the daily cron.
 *
 * DEBUGGING:
 *   - Use `testOneBank` (edit the bankId inside) to process a single
 *     bank's latest unseen message without affecting production.
 *   - Dedupe state is kept in PropertiesService ("processed_" + messageId).
 *     To reprocess an email, delete that property or call `clearDedupe()`.
 */

// --------------------------------------------------------------------------
// Configuration

var BANK_LABELS = [
  { bankId: 'asb',      label: 'Bank Updates/ASB' },
  { bankId: 'bnz',      label: 'Bank Updates/BNZ' },
  { bankId: 'anz',      label: 'Bank Updates/ANZ' },
  { bankId: 'westpac',  label: 'Bank Updates/Westpac' },
  { bankId: 'kiwibank', label: 'Bank Updates/Kiwibank' },
];

var MAX_MESSAGES_PER_LABEL = 3;
var LOOKBACK_DAYS = 2;
var GEMINI_MODEL = 'gemini-2.0-flash';

// --------------------------------------------------------------------------
// Main entry point (bound to daily trigger)

function run() {
  var props = PropertiesService.getScriptProperties();
  var ingestSecret = props.getProperty('INGEST_SECRET');
  var vercelUrl = props.getProperty('VERCEL_URL') || 'https://tanta-pipeline.vercel.app';
  var geminiKey = props.getProperty('GEMINI_API_KEY');

  if (!ingestSecret) throw new Error('INGEST_SECRET script property not set');
  if (!geminiKey) throw new Error('GEMINI_API_KEY script property not set');

  var summary = { ok: 0, skipped: 0, failed: 0, review: 0 };
  var start = Date.now();

  Logger.log('→ tanta-pipeline rates sync starting');

  BANK_LABELS.forEach(function (cfg) {
    try {
      var stats = processBank(cfg.bankId, cfg.label, geminiKey, vercelUrl, ingestSecret);
      summary.ok += stats.ok;
      summary.skipped += stats.skipped;
      summary.failed += stats.failed;
      summary.review += stats.review;
    } catch (err) {
      Logger.log('[' + cfg.bankId + '] FATAL ' + err.message);
      summary.failed++;
    }
  });

  var elapsed = ((Date.now() - start) / 1000).toFixed(1);
  Logger.log(
    'done in ' + elapsed + 's — ' +
    summary.ok + ' ok · ' +
    summary.review + ' needs review · ' +
    summary.failed + ' failed · ' +
    summary.skipped + ' skipped',
  );
}

// --------------------------------------------------------------------------
// Per-bank processor

function processBank(bankId, labelName, geminiKey, vercelUrl, ingestSecret) {
  Logger.log('[' + bankId + '] scanning "' + labelName + '"...');
  var stats = { ok: 0, skipped: 0, failed: 0, review: 0 };
  var props = PropertiesService.getScriptProperties();

  var query = 'label:"' + labelName + '" newer_than:' + LOOKBACK_DAYS + 'd';
  var threads = GmailApp.search(query, 0, MAX_MESSAGES_PER_LABEL);

  var messages = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) { messages.push(m); });
  });

  // Keep newest first
  messages.sort(function (a, b) { return b.getDate().getTime() - a.getDate().getTime(); });
  messages = messages.slice(0, MAX_MESSAGES_PER_LABEL);

  Logger.log('[' + bankId + '] found ' + messages.length + ' message(s)');

  messages.forEach(function (msg) {
    var mid = msg.getId();
    if (props.getProperty('processed_' + mid)) {
      Logger.log('[' + bankId + ']   ' + mid.slice(0, 10) + '… already processed, skipping');
      stats.skipped++;
      return;
    }

    var subject = msg.getSubject() || '';
    var date = msg.getDate().toISOString();
    var bodyText = msg.getPlainBody() || '';

    // Collect attachments (Gmail includes inline images here by default)
    var attachments = msg.getAttachments({ includeInlineImages: true, includeAttachments: true });
    var mediaParts = [];
    attachments.forEach(function (a) {
      var mime = a.getContentType();
      if (!mime) return;
      // Gemini accepts these vision types + PDFs
      if (/^image\/(png|jpe?g|gif|webp)$/i.test(mime) || mime === 'application/pdf') {
        var bytes = a.getBytes();
        // Skip anything >20MB — Gemini limits and email attachments that size
        // usually aren't rate cards anyway.
        if (bytes.length > 20 * 1024 * 1024) {
          Logger.log('[' + bankId + ']   skipping oversize ' + mime + ' attachment (' +
            (bytes.length / 1024 / 1024).toFixed(1) + 'MB)');
          return;
        }
        mediaParts.push({
          inline_data: {
            mime_type: mime,
            data: Utilities.base64Encode(bytes),
          },
        });
      }
    });

    Logger.log('[' + bankId + ']   ' + mid.slice(0, 10) + '… "' +
      subject.slice(0, 60) + '" (' + mediaParts.length + ' media parts)');

    var parsed;
    try {
      parsed = callGemini(geminiKey, bankId, subject, bodyText, mediaParts);
    } catch (err) {
      Logger.log('[' + bankId + ']   ✗ Gemini call failed: ' + err.message);
      stats.failed++;
      // Still POST with error so writeLog captures it
      postToVercel(vercelUrl, ingestSecret, {
        bankId: bankId,
        messageId: mid,
        subject: subject,
        date: date,
        patch: {},
        parser: 'vision',
        status: 'failed',
        error: 'Gemini: ' + err.message,
        needsReview: true,
      });
      props.setProperty('processed_' + mid, '1');
      return;
    }

    var patch = parsed.patch || {};
    var hasData = Object.keys(patch).length > 0;
    var status = parsed.error ? 'failed' : (hasData ? 'success' : 'needs_review');
    var needsReview = !hasData || parsed.confidence === 'low';

    try {
      var resp = postToVercel(vercelUrl, ingestSecret, {
        bankId: bankId,
        messageId: mid,
        subject: subject,
        date: date,
        patch: patch,
        parser: 'vision',
        status: status,
        error: parsed.error || null,
        needsReview: needsReview,
      });

      if (resp.ok) {
        props.setProperty('processed_' + mid, '1');
        if (status === 'success') stats.ok++;
        else if (status === 'needs_review') stats.review++;
        else stats.failed++;
        Logger.log('[' + bankId + ']   ' +
          (status === 'success' ? '✓' : status === 'needs_review' ? '!' : '✗') +
          ' ' + status);
      } else {
        Logger.log('[' + bankId + ']   ✗ Vercel rejected: ' + resp.body);
        stats.failed++;
      }
    } catch (err) {
      Logger.log('[' + bankId + ']   ✗ POST failed: ' + err.message);
      stats.failed++;
    }
  });

  return stats;
}

// --------------------------------------------------------------------------
// Gemini API

function callGemini(apiKey, bankId, emailSubject, bodyText, mediaParts) {
  var prompt =
    'Extract rate-card, traffic-light, turnaround and cashback data for ' + bankId.toUpperCase() + '.\n' +
    'You will receive the plain-text email body plus any inline images / PDF attachments.\n' +
    'Email subject: "' + emailSubject + '"\n\n' +
    'IMPORTANT: Perform a multimodal scan. If the rates are embedded as an image or table, ' +
    'OCR the values from those visual assets. Do not return empty rateCard if the text body ' +
    'lacks rates — analyse inline images and PDF attachments thoroughly before giving up.\n\n' +
    'Return ONLY a JSON object shaped like:\n' +
    '{\n' +
    '  "rateCard": {\n' +
    '    "6mo":  { "lte80": number|null, "gt80": number|null },\n' +
    '    "1y":   { "lte80": number|null, "gt80": number|null },\n' +
    '    "18mo": { "lte80": number|null, "gt80": number|null },\n' +
    '    "2y":   { "lte80": number|null, "gt80": number|null },\n' +
    '    "3y":   { "lte80": number|null, "gt80": number|null },\n' +
    '    "4y":   { "lte80": number|null, "gt80": number|null },\n' +
    '    "5y":   { "lte80": number|null, "gt80": number|null },\n' +
    '    "floating": { "lte80": number|null, "gt80": number|null }\n' +
    '  },\n' +
    '  "trafficLights": {\n' +
    '    "lte80":  { "existing": string|null, "new": string|null },\n' +
    '    "80_90":  { "existing": string|null, "new": string|null }\n' +
    '  },\n' +
    '  "turnaround": { "retail": number|null, "business": number|null },\n' +
    '  "cashback": { "summary": string|null },\n' +
    '  "fees": { "rateCardEffectiveDate": string|null },\n' +
    '  "serviceRate": number|null,\n' +
    '  "_confidence": "high" | "medium" | "low",\n' +
    '  "_notes": "brief note on anything uncertain"\n' +
    '}\n\n' +
    'lte80 = rates for LVR ≤80% (often labelled "Special" or "Discretionary"). ' +
    'gt80 = standard / >80% LVR rate.\n' +
    'Rates are percentages as numbers (e.g. 4.49, not "4.49%"). Turnaround in business days.\n' +
    'cashback.summary: a short human-readable description of current cashback / cash-contribution ' +
    'offers including percentages and caps (e.g. "0.9% up to $20k, minimum $5k for FHBs").\n' +
    'fees.rateCardEffectiveDate: the date the rates became effective, as written in the email.\n' +
    'Only include keys you can confidently read from the material. Omit the rest entirely.';

  var parts = [{ text: prompt }];
  if (bodyText && bodyText.length > 0) {
    parts.push({ text: 'Email plain text body:\n' + bodyText.slice(0, 20000) });
  }
  mediaParts.forEach(function (p) { parts.push(p); });

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);

  var body = {
    contents: [{ parts: parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0,
    },
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  var status = res.getResponseCode();
  var text = res.getContentText();

  if (status !== 200) {
    throw new Error('Gemini HTTP ' + status + ': ' + text.slice(0, 500));
  }

  var envelope = JSON.parse(text);
  var candidate = envelope.candidates && envelope.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts) {
    throw new Error('Gemini returned empty response: ' + text.slice(0, 500));
  }

  var jsonText = candidate.content.parts.map(function (p) { return p.text || ''; }).join('');
  var parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error('Gemini returned non-JSON: ' + jsonText.slice(0, 500));
  }

  // Split internal markers off the patch
  var confidence = parsed._confidence || 'medium';
  var notes = parsed._notes || null;
  delete parsed._confidence;
  delete parsed._notes;

  return { patch: parsed, confidence: confidence, notes: notes, error: null };
}

// --------------------------------------------------------------------------
// POST to Vercel

function postToVercel(vercelUrl, secret, payload) {
  var url = vercelUrl.replace(/\/+$/, '') + '/api/bank-rates-ingest';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var status = res.getResponseCode();
  var body = res.getContentText();
  return { ok: status >= 200 && status < 300, status: status, body: body };
}

// --------------------------------------------------------------------------
// Helpers — run these manually from the Apps Script editor

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('run')
    .timeBased()
    .atHour(10)
    .everyDays(1)
    .inTimezone('Pacific/Auckland')
    .create();
  Logger.log('installed daily trigger: run() at 10am NZT');
}

function testOneBank() {
  // Edit the bankId below to test a specific bank without touching others
  var bankId = 'anz';
  var cfg = BANK_LABELS.filter(function (c) { return c.bankId === bankId; })[0];
  if (!cfg) throw new Error('Unknown bankId: ' + bankId);

  var props = PropertiesService.getScriptProperties();
  var stats = processBank(
    cfg.bankId,
    cfg.label,
    props.getProperty('GEMINI_API_KEY'),
    props.getProperty('VERCEL_URL') || 'https://tanta-pipeline.vercel.app',
    props.getProperty('INGEST_SECRET'),
  );
  Logger.log('test done: ' + JSON.stringify(stats));
}

function clearDedupe() {
  // Nukes every "processed_*" property so the next run re-processes every
  // in-window message. Use sparingly — will duplicate log entries.
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var count = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('processed_') === 0) { props.deleteProperty(k); count++; }
  });
  Logger.log('cleared ' + count + ' dedupe markers');
}
