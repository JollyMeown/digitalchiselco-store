/**
 * Etsy buyer emails from Gmail -> this Google Sheet (Apps Script).
 * Runs inside your own Google account, so no API keys, no Cloud project.
 *
 * HOW TO USE
 *   1. Open a new Google Sheet in the Gmail account that receives Etsy orders.
 *   2. Extensions > Apps Script > delete the sample code, paste this file, save.
 *   3. Pick the function "scanEtsyBuyers" in the toolbar and press Run.
 *      First run: Google asks you to allow Gmail (read) + Sheets. Allow.
 *   4. The sheet "Etsy buyers" fills with: email, buyer name, first seen,
 *      last seen, orders (messages), sample subject. Masked addresses
 *      (a***@gmail.com) go to the sheet "Masked (unusable)".
 *   5. File > Download > CSV of "Etsy buyers", then on the PC:
 *        node scripts/import_etsy_buyers.mjs "<downloaded csv>" --apply
 *   Re-run any time: it continues where it stopped (progress is stored),
 *   and a big mailbox may need several runs (each run stops after ~5 min,
 *   press Run again). Repeat steps 1-5 in every Gmail account that gets orders.
 */
var QUERY = 'from:etsy.com (sale OR sold OR order OR purchase OR transaction)';
var SKIP_DOMAINS = /@(etsy\.com|etsy\.me|digitalchiselco\.com|google\.com|googlemail\.com|youtube\.com|paypal\.com)$/i;
var SKIP_LOCAL = /noreply|no-reply|donotreply|^support@|^help@|^notifications?@|^transaction@|^convos?@/i;
var EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
var MASKED_RE = /[A-Z0-9._%+-]*\*+[A-Z0-9._%+-]*@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
var BATCH = 100;               // threads per page
var TIME_BUDGET_MS = 5 * 60 * 1000;

function scanEtsyBuyers() {
  var started = Date.now();
  var props = PropertiesService.getUserProperties();
  var me = Session.getActiveUser().getEmail().toLowerCase();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Etsy buyers') || ss.insertSheet('Etsy buyers');
  var maskedSheet = ss.getSheetByName('Masked (unusable)') || ss.insertSheet('Masked (unusable)');
  if (sheet.getLastRow() === 0) sheet.appendRow(['email', 'buyer name', 'first seen', 'last seen', 'messages', 'sample subject']);
  if (maskedSheet.getLastRow() === 0) maskedSheet.appendRow(['masked address', 'seen']);

  // existing rows -> map so re-runs update instead of duplicating
  var rows = sheet.getDataRange().getValues();
  var index = {};
  for (var i = 1; i < rows.length; i++) index[String(rows[i][0]).toLowerCase()] = i + 1;
  var maskedRows = maskedSheet.getDataRange().getValues();
  var maskedIndex = {};
  for (var j = 1; j < maskedRows.length; j++) maskedIndex[String(maskedRows[j][0]).toLowerCase()] = true;

  var start = Number(props.getProperty('etsy_scan_start') || 0);
  var found = 0, threadsRead = 0;
  while (Date.now() - started < TIME_BUDGET_MS) {
    var threads = GmailApp.search(QUERY, start, BATCH);
    if (!threads.length) { props.deleteProperty('etsy_scan_start'); SpreadsheetApp.getUi().alert('Finished. Buyers in sheet: ' + (sheet.getLastRow() - 1) + '. Download "Etsy buyers" as CSV and run import_etsy_buyers.mjs.'); return; }
    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length; m++) {
        var msg = msgs[m];
        var subject = msg.getSubject() || '';
        var body = subject + '\n' + msg.getPlainBody();
        var when = Utilities.formatDate(msg.getDate(), 'UTC', 'yyyy-MM-dd');
        var masked = body.match(MASKED_RE) || [];
        for (var k = 0; k < masked.length; k++) {
          var mk = masked[k].toLowerCase();
          if (!maskedIndex[mk]) { maskedSheet.appendRow([mk, when]); maskedIndex[mk] = true; }
        }
        var emails = body.match(EMAIL_RE) || [];
        for (var e = 0; e < emails.length; e++) {
          var addr = emails[e].toLowerCase();
          if (addr === me || addr.indexOf('*') >= 0 || SKIP_DOMAINS.test(addr) || SKIP_LOCAL.test(addr)) continue;
          var name = (subject.match(/from ([A-Za-z][A-Za-z .'-]{1,60})/) || [])[1] || '';
          if (index[addr]) {
            var r = index[addr];
            var first = String(sheet.getRange(r, 3).getValue()), last = String(sheet.getRange(r, 4).getValue());
            sheet.getRange(r, 3).setValue(when < first ? when : first);
            sheet.getRange(r, 4).setValue(when > last ? when : last);
            sheet.getRange(r, 5).setValue(Number(sheet.getRange(r, 5).getValue()) + 1);
          } else {
            sheet.appendRow([addr, name, when, when, 1, subject.slice(0, 80)]);
            index[addr] = sheet.getLastRow();
            found++;
          }
        }
      }
      threadsRead++;
    }
    start += threads.length;
    props.setProperty('etsy_scan_start', String(start));
  }
  SpreadsheetApp.getUi().alert('Paused after ' + threadsRead + ' threads (time limit). New buyers this run: ' + found + '. Press Run again to continue from where it stopped.');
}

/** Start over from the first message (keeps the rows already collected). */
function resetProgress() {
  PropertiesService.getUserProperties().deleteProperty('etsy_scan_start');
  SpreadsheetApp.getUi().alert('Progress reset. Run scanEtsyBuyers again.');
}
