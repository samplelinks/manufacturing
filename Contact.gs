/**
 * CONTACT.gs — backend for the Contact form on sparkling.co.in (contact.html).
 *
 * Separate from the careers portal (Code.gs): its own Apps Script project, its own
 * Google Sheet and its own Web App URL.
 *
 * What it does for every message sent from the form:
 *   1. Saves it as a new row in the "Enquiries" tab of THIS Google Sheet.
 *   2. Emails a thank-you / confirmation ONLY to the person who sent it.
 *      The email is sent from the Google account that owns this sheet and script.
 *
 * ============================================================================
 * SETUP (one time)
 * ============================================================================
 *  1. Create a new Google Sheet (e.g. "Kalimark — Website Enquiries"), signed in
 *     with the Google account that should send the confirmation emails.
 *  2. In that sheet: Extensions → Apps Script. Delete the starter code, paste in
 *     all of this file, and save.
 *  3. Deploy → New deployment → type "Web app":
 *       Execute as:      Me
 *       Who has access:  Anyone
 *     Approve the permissions prompt. Copy the URL it gives you (ends in /exec).
 *  4. Open js/contact-config.js in the website folder and paste that URL into
 *     CONTACT_FORM_URL. Save and upload.
 *  The "Enquiries" tab is created automatically on the first message.
 *
 *  Edited this file later? Deploy → Manage deployments → edit (pencil) →
 *  Version: New version → Deploy. The URL stays the same.
 * ============================================================================
 */

// ---- settings ---------------------------------------------------------------
const SHEET_NAME = 'Enquiries';
const SENDER_NAME = 'Kalimark';                       // name shown as the email sender
const COMPANY_LINE = 'Kalis Sparkling Water Pvt Ltd'; // last line of the email signature
const HEADERS = ['ID', 'Date', 'Topic', 'Name', 'Email', 'Phone', 'Message', 'Page', 'Reply Sent'];


// ---- web app entry points ----------------------------------------------------
function doGet() {
  return json_({ status: 'success', message: 'Contact form API is live' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action !== 'submitEnquiry') return json_({ status: 'error', message: 'Unknown action: ' + body.action });
    return json_(submitEnquiry_(body.payload || {}));
  } catch (err) {
    return json_({ status: 'error', message: 'Something went wrong. Please try again.' });
  }
}


// ---- the enquiry ---------------------------------------------------------------
function submitEnquiry_(q) {
  if (q.website) return { status: 'success' };          // hidden spam-trap field was filled: a bot — ignore quietly

  const topic = clean_(q.topic || 'General enquiry', 80);
  const name = clean_(q.name, 120);
  const email = clean_(q.email, 160);
  const phone = clean_(q.phone, 40);
  const message = clean_(q.message, 4000);
  const page = clean_(q.page, 200);

  if (!name) return { status: 'error', message: 'Enter your full name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 'error', message: 'Enter a valid email address.' };
  if (!message) return { status: 'error', message: 'Write a short message.' };

  const id = 'ENQ-' + new Date().getTime();

  // 1) confirmation email — to the enquirer only
  let replySent = 'Yes';
  try {
    MailApp.sendEmail({
      to: email,
      name: SENDER_NAME,
      subject: 'We received your message — ' + SENDER_NAME + ' (Ref ' + id + ')',
      body:
        'Dear ' + name + ',\n\n' +
        'Thank you for contacting ' + SENDER_NAME + '. We have received your enquiry and our team will get back to you soon.\n\n' +
        'Your message\n' +
        '------------\n' +
        'Topic: ' + topic + '\n' +
        (phone ? 'Phone: ' + phone + '\n' : '') +
        '\n' + message + '\n\n' +
        'Reference: ' + id + '\n\n' +
        'Warm regards,\n' + SENDER_NAME + '\n' + COMPANY_LINE
    });
  } catch (err) {
    replySent = 'Failed: ' + err;                        // the enquiry is still saved below
  }

  // 2) save to the sheet
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_();
    sheet.appendRow([
      id,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
      topic, name, email, phone, message, page, replySent
    ]);
  } finally {
    lock.releaseLock();
  }

  return { status: 'success', id: id };
}


// ---- helpers -------------------------------------------------------------------
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function clean_(value, maxLen) {
  // Strip a leading = + - @ so a message can never run as a spreadsheet formula.
  return String(value === undefined || value === null ? '' : value).trim().replace(/^[=+\-@]+/, '').slice(0, maxLen);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the Apps Script editor (select it, press Run) to approve
// the email permission and send yourself a test confirmation.
function testSendToMe() {
  const me = Session.getActiveUser().getEmail();
  Logger.log(submitEnquiry_({ topic: 'Test', name: 'Test', email: me, message: 'Test message from the editor.', page: 'editor' }));
}
