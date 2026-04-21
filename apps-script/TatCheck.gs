/**
 * Tanta Pipeline — Portal TAT check via staff email workflow.
 *
 * ANZ (radar.ac.nz) and Kiwibank (Adviser Hub) publish turnaround
 * times behind auth-gated portals that no cron can reach. This
 * script sends a weekly templated email to a staff member who
 * manually checks those portals, edits the numbers in a reply, and
 * the parser extracts + POSTs the values to the Vercel dashboard.
 *
 * Manual overrides beat auto-ingest everywhere else in the pipeline,
 * so a reply here will stick until the next weekly cycle updates it.
 *
 * Architecture:
 *   MONDAY 9am NZT — sendTatCheckRequest()
 *     ├─ draws a fresh template email addressed to STAFF_EMAIL
 *     ├─ includes the previous values (if any) for context
 *     └─ GmailApp.sendEmail — deliberately sets a subject prefix
 *        we can search for in the reply-processor
 *
 *   EVERY 2 HOURS — processTatReplies()
 *     ├─ Gmail search for unseen replies in the expected thread
 *     ├─ parseReply() — regex section-matcher to extract values
 *     └─ postToVercel() per bank → /api/bank-rates-ingest
 *        writes TAT as source='manual' so future auto-ingests
 *        don't clobber
 *
 * SETUP (one-time):
 *   1. Create a NEW Apps Script project at script.google.com
 *      (separate from the rates-sync project). Name it "Tanta
 *      Pipeline — Portal TAT Check".
 *   2. Paste this entire file as Code.gs.
 *   3. Project Settings → Script Properties → add:
 *        STAFF_EMAIL      — who receives the weekly check email
 *        STAFF_FIRST_NAME — for the greeting (e.g. "Leeza")
 *        INGEST_SECRET    — same value as the rates-sync project
 *        VERCEL_URL       — https://tanta-pipeline.vercel.app
 *   4. Run `testSendRequest` once manually to grant Gmail permissions.
 *      Check the inbox to confirm the email arrived.
 *   5. Run `installTatCheckTriggers` once to schedule the Monday
 *      sender + the 2-hourly reply poller.
 *
 * TROUBLESHOOTING:
 *   - No replies landing? Check View → Executions for processTatReplies
 *     errors. Most common: the subject-line prefix was edited out of
 *     the reply, so the search doesn't find it. Remind the staff
 *     member to hit Reply (not New Email).
 *   - Wrong values written? Each reply adds an ingestion_log row in
 *     Neon. Query it to see exactly what the parser extracted.
 */

// --------------------------------------------------------------------------
// Configuration

var SUBJECT_PREFIX = '[Tanta TAT Check]';

// Banks + categories covered by this workflow.
// Extend if we ever add another portal-gated source.
var TAT_BANKS = {
  anz: {
    label: 'ANZ',
    portalNote: 'radar.ac.nz → ANZ Mortgage Adviser Hub → Average Response Time',
    categories: [
      'Priority Assessment – Retail',
      'Priority Assessment – Business',
      'Other Assessment – Retail',
      'Other Assessment – Business',
      'Reassessment',
      'Loan Maintenance',
      'Loan Structures & Documents',
    ],
  },
  kiwibank: {
    label: 'Kiwibank',
    portalNote: 'Kiwibank Adviser Hub → Turnaround Times',
    categories: ['Retail', 'Business'],
  },
};

// --------------------------------------------------------------------------
// Main functions (bound to triggers)

function sendTatCheckRequest() {
  var props = PropertiesService.getScriptProperties();
  var staffEmail = props.getProperty('STAFF_EMAIL');
  var staffFirst = props.getProperty('STAFF_FIRST_NAME') || 'team';
  if (!staffEmail) throw new Error('STAFF_EMAIL not set in Script Properties');

  var today = new Date();
  var dateStr = Utilities.formatDate(today, 'Pacific/Auckland', 'd MMM yyyy');
  var subject = SUBJECT_PREFIX + ' Weekly TAT Check — ' + dateStr;

  // Include last-seen values so the staffer knows what was there last week
  // and can leave anything unchanged as-is.
  var previous = fetchCurrentTatFromApi();

  var body = buildEmailBody(staffFirst, dateStr, previous);

  GmailApp.sendEmail(staffEmail, subject, body, {
    name: 'Tanta Pipeline (automated)',
    // We want the reply to come back to the same inbox this runs under
    // (so processTatReplies can pick it up). Don't set replyTo.
  });

  Logger.log('Sent TAT check to ' + staffEmail);
}

function processTatReplies() {
  var props = PropertiesService.getScriptProperties();
  var ingestSecret = props.getProperty('INGEST_SECRET');
  var vercelUrl = props.getProperty('VERCEL_URL') || 'https://tanta-pipeline.vercel.app';
  if (!ingestSecret) throw new Error('INGEST_SECRET not set');

  // Find threads with our subject prefix that have at least one inbound reply.
  // `from:` filter is "anyone but me" so we skip our own outgoing messages.
  var query = 'subject:"' + SUBJECT_PREFIX + '" -from:me newer_than:30d';
  var threads = GmailApp.search(query, 0, 20);
  Logger.log('found ' + threads.length + ' candidate thread(s)');

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var fromSelf = msg.getFrom().indexOf(Session.getActiveUser().getEmail()) >= 0;
      if (fromSelf) return; // only process inbound replies

      var mid = msg.getId();
      if (props.getProperty('tat_processed_' + mid)) return;

      Logger.log('processing reply ' + mid + ' from ' + msg.getFrom());
      var body = msg.getPlainBody();

      var parsed = parseReply(body);
      Logger.log('parsed: ' + JSON.stringify(parsed));

      // POST one payload per bank so each gets its own ingestion_log row.
      Object.keys(parsed).forEach(function (bankId) {
        var values = parsed[bankId];
        if (!values || Object.keys(values).length === 0) return;

        var now = new Date().toISOString();
        var turnaround = {};
        Object.keys(values).forEach(function (cat) {
          turnaround[cat] = {
            days: values[cat],
            source: 'manual', // staff-entered portal data — never overwrite via auto ingest
            updatedAt: now,
          };
        });

        var payload = {
          bankId: bankId,
          messageId: mid + '-' + bankId, // unique per bank + reply
          subject: msg.getSubject(),
          date: msg.getDate().toISOString(),
          patch: { turnaround: turnaround },
          parser: 'manual',
          status: 'success',
          needsReview: false,
        };

        var res = postToVercel(vercelUrl, ingestSecret, payload);
        Logger.log('[' + bankId + '] status=' + res.status + ' body=' + res.body.slice(0, 200));
      });

      props.setProperty('tat_processed_' + mid, '1');
    });
  });
}

// --------------------------------------------------------------------------
// Email body builder

function buildEmailBody(staffFirst, dateStr, previous) {
  var lines = [];
  lines.push('Hi ' + staffFirst + ',');
  lines.push('');
  lines.push('Weekly TAT check for the portal-gated banks. Please log into each portal,');
  lines.push('note the current turnaround days, and REPLY to this email with the values filled in.');
  lines.push('');
  lines.push('Rules of thumb:');
  lines.push('• Numbers only — business days (e.g. "4")');
  lines.push('• Leave a line with "__" if the portal doesn\'t show that category or nothing has changed');
  lines.push('• Reply to the thread (don\'t start a new email) — the system finds your reply by matching the subject prefix');
  lines.push('');
  lines.push('Date of check: ' + dateStr);
  lines.push('');

  Object.keys(TAT_BANKS).forEach(function (bankId) {
    var cfg = TAT_BANKS[bankId];
    lines.push('=== ' + cfg.label + ' ===');
    lines.push('(source: ' + cfg.portalNote + ')');
    cfg.categories.forEach(function (cat) {
      var prev = previous && previous[bankId] && previous[bankId][cat];
      var suffix = prev !== undefined ? '  [last week: ' + prev + ']' : '';
      lines.push(cat + ': __' + suffix);
    });
    lines.push('');
  });

  lines.push('Thanks!');
  lines.push('— Tanta Pipeline (automated)');

  return lines.join('\n');
}

// --------------------------------------------------------------------------
// Reply parser

/**
 * Parses a reply body looking for "=== BankLabel ===" section headers,
 * then "Category: <number>" lines within each section. Ignores lines
 * still containing "__" (not filled in). Returns:
 *   { anz: { "Priority Retail": 2, ... }, kiwibank: { "Retail": 9, ... } }
 */
function parseReply(body) {
  var out = {};
  var currentBankId = null;

  // Map from the label (e.g. "ANZ", "Kiwibank") back to the bank id.
  var labelToId = {};
  Object.keys(TAT_BANKS).forEach(function (id) {
    labelToId[TAT_BANKS[id].label.toLowerCase()] = id;
  });

  // Build a set of known categories per bank for validation.
  var knownCategories = {};
  Object.keys(TAT_BANKS).forEach(function (id) {
    knownCategories[id] = {};
    TAT_BANKS[id].categories.forEach(function (cat) {
      knownCategories[id][cat.toLowerCase()] = cat; // preserve original casing
    });
  });

  var lines = body.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];

    // Gmail reply delimiters — stop parsing at the quoted original message.
    if (/^On .* wrote:$/i.test(raw.trim())) break;
    if (/^-+Original Message-+$/i.test(raw.trim())) break;
    if (/^>+ ?=== /.test(raw)) continue; // quoted section header

    var sectionMatch = raw.match(/^\s*=+\s*([A-Za-z ]+?)\s*=+\s*$/);
    if (sectionMatch) {
      var label = sectionMatch[1].trim().toLowerCase();
      currentBankId = labelToId[label] || null;
      continue;
    }
    if (!currentBankId) continue;

    // Value line: "Category: 4" or "Category : 4 days"
    var valMatch = raw.match(/^\s*(.+?)\s*:\s*(.+?)\s*$/);
    if (!valMatch) continue;
    var cat = valMatch[1].trim();
    var val = valMatch[2].trim();

    if (val === '__' || val === '') continue; // not filled in
    if (/^not\b/i.test(val)) continue; // "not offered" / "not available"

    var num = parseInt(val.match(/\d+/), 10);
    if (isNaN(num)) continue;

    // Accept the category if it matches one of the known ones (fuzzy).
    var canonical = knownCategories[currentBankId][cat.toLowerCase()];
    if (!canonical) {
      // Not a known category — skip rather than inventing new keys.
      continue;
    }

    if (!out[currentBankId]) out[currentBankId] = {};
    out[currentBankId][canonical] = num;
  }

  return out;
}

// --------------------------------------------------------------------------
// Vercel API helpers

function postToVercel(vercelUrl, secret, payload) {
  var url = vercelUrl.replace(/\/+$/, '') + '/api/bank-rates-ingest';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  return { status: res.getResponseCode(), body: res.getContentText() };
}

/**
 * Reads the currently-stored TAT values from /api/bank-rates so we can
 * show "[last week: N]" hints next to each line in the outgoing email.
 * Public endpoint — no auth.
 */
function fetchCurrentTatFromApi() {
  var props = PropertiesService.getScriptProperties();
  var vercelUrl = props.getProperty('VERCEL_URL') || 'https://tanta-pipeline.vercel.app';
  var res = UrlFetchApp.fetch(vercelUrl.replace(/\/+$/, '') + '/api/bank-rates', {
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return {};

  var data = JSON.parse(res.getContentText());
  var out = {};
  (data.banks || []).forEach(function (b) {
    if (!TAT_BANKS[b.id]) return;
    out[b.id] = {};
    var tat = b.data && b.data.turnaround;
    if (!tat || typeof tat !== 'object') return;
    Object.keys(tat).forEach(function (cat) {
      var v = tat[cat];
      if (typeof v === 'object' && v !== null && 'days' in v) {
        out[b.id][cat] = v.days;
      } else if (typeof v === 'number' || typeof v === 'string') {
        out[b.id][cat] = v;
      }
    });
  });
  return out;
}

// --------------------------------------------------------------------------
// Triggers + manual helpers

function installTatCheckTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'sendTatCheckRequest' || fn === 'processTatReplies') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('sendTatCheckRequest')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .inTimezone('Pacific/Auckland')
    .create();

  ScriptApp.newTrigger('processTatReplies')
    .timeBased()
    .everyHours(2)
    .create();

  Logger.log('installed: sendTatCheckRequest (Mon 9am NZT), processTatReplies (every 2h)');
}

function testSendRequest() {
  sendTatCheckRequest();
}

function testProcessReplies() {
  processTatReplies();
}

function testParseReply() {
  var sample = [
    'Hi team,',
    'Done for this week.',
    '',
    '=== ANZ ===',
    'Priority Assessment – Retail: 2',
    'Priority Assessment – Business: 2',
    'Other Assessment – Retail: 4',
    'Reassessment: 2',
    'Loan Maintenance: 3',
    'Loan Structures & Documents: 1',
    '',
    '=== Kiwibank ===',
    'Retail: 9',
    'Business: __',
    '',
    'Cheers,',
    'Leeza',
  ].join('\n');
  Logger.log(JSON.stringify(parseReply(sample), null, 2));
}
