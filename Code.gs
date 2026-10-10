/**
 * CODE.gs — the entire backend in one file.
 *
 * A JSON API for the Kalimark careers portal. It never renders HTML; the
 * website in this same folder calls it with fetch(). Deploy as a Web App
 * ("Execute as: Me", "Who has access: Anyone") and paste the /exec URL into
 * js/config.js.
 *
 * ============================================================================
 * WHO CAN DO WHAT
 * ============================================================================
 *   Public (no account)  — browse jobs, submit an application form.
 *   HR                   — post jobs, review applications, run interview rounds,
 *                          shortlist / reject / hire.
 *   Admin                — create/remove HR accounts, view all applicants.
 * Candidates never log in. There are no candidate accounts.
 *
 * ============================================================================
 * SECTION INDEX
 * ============================================================================
 *   1. CONFIG
 *   2. ROUTER            — doGet / doPost
 *   3. SHEET HELPERS     — creation, schema, caching
 *   4. JOBS
 *   5. APPLICATIONS      — public submit + HR review
 *   6. INTERVIEWS
 *   7. EMAIL
 *   8. AUTH              — login, sessions, forgot/change password
 *   9. ADMIN             — HR account management
 *  10. ONE-TIME SETUP    — Careers Portal menu in the sheet, Set up sheets
 * ============================================================================
 */


// ============================================================================
// 1. CONFIG
// ============================================================================

const JOBS_SHEET_NAME = 'Jobs';
const APPLICATIONS_SHEET_NAME = 'Applications';
const ADMINS_SHEET_NAME = 'Admins';
const INTERVIEWS_SHEET_NAME = 'Interviews';
const SHORTLISTED_SHEET_NAME = 'Shortlisted';
const HIRED_SHEET_NAME = 'Hired';
const REJECTED_SHEET_NAME = 'Rejected';

const RESUME_FOLDER_NAME = 'Job Portal Resumes';

// Used only if a job posting has no Employer Email of its own.
const FALLBACK_EMPLOYER_EMAIL = 'hr@example.com';

const COMPANY_NAME = 'Kalimark';

// Public job list cache (seconds). Any job add/edit/delete clears it at once.
const JOBS_CACHE_TTL_SECONDS = 300;

// How long a login lasts before the user has to sign in again (seconds).
// 21600 (6h) is the maximum CacheService will hold a value.
const SESSION_TTL_SECONDS = 21600;

// Largest resume accepted, in megabytes.
const MAX_RESUME_MB = 5;


// ============================================================================
// 2. ROUTER
// ============================================================================

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  try {
    if (action === 'ping') {
      return jsonOutput_({ status: 'success', message: 'API is live', time: new Date().toString() });
    }
    if (action === 'getJobs') {
      return jsonOutput_({ status: 'success', jobs: getActiveJobs() });
    }
    return jsonOutput_({ status: 'error', message: 'Unknown or missing action' });
  } catch (err) {
    return jsonOutput_({ status: 'error', message: err.toString() });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const p = body.payload || {};
    let result;

    switch (action) {
      // ---- public ----
      case 'submitApplication':
        result = submitApplication(p);
        break;

      // ---- auth ----
      case 'login':
        result = login(p.username, p.password);
        break;
      case 'logout':
        result = logout(p.token);
        break;
      case 'forgotPassword':
        result = forgotPassword(p.username);
        break;
      case 'changePassword':
        result = changePassword(p.token, p.newPassword);
        break;

      // ---- HR ----
      case 'getDashboard':
        result = getDashboard(p.token);
        break;
      case 'addJob':
        result = addJob(p.token, p.job);
        break;
      case 'updateJob':
        result = updateJob(p.token, p.job);
        break;
      case 'deleteJob':
        result = deleteJob(p.token, p.jobId);
        break;
      case 'recordInterviewOutcome':
        result = recordInterviewOutcome(p.token, p.result);
        break;
      case 'decideCandidate':
        result = decideCandidate(p.token, p.decision);
        break;
      case 'scheduleInterview':
        result = scheduleInterview(p.token, p.interview);
        break;
      case 'getInterviews':
        result = getInterviews(p.token);
        break;

      // ---- Admin ----
      case 'getHrAccounts':
        result = getHrAccounts(p.token);
        break;
      case 'addHr':
        result = addHr(p.token, p.newHr);
        break;
      case 'resetHrPassword':
        result = resetHrPassword(p.token, p.hrUsername, p.newPassword);
        break;
      case 'removeHr':
        result = removeHr(p.token, p.hrUsername);
        break;
      case 'getApplicantsOverview':
        result = getApplicantsOverview(p.token);
        break;

      default:
        result = { status: 'error', message: 'Unknown action: ' + action };
    }
    return jsonOutput_(result);
  } catch (err) {
    return jsonOutput_({ status: 'error', message: err.toString() });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================================
// 3. SHEET HELPERS
// ============================================================================

// Guards sheet creation against concurrent requests racing to create the same
// sheet (several dashboard calls can fire at once on a brand-new spreadsheet).
function getOrCreateSheet_(name, headerRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headerRow);
      sheet.setFrozenRows(1);
    }
    return sheet;
  } finally {
    lock.releaseLock();
  }
}

// Adds any header this code expects but the sheet doesn't have yet, leaving
// existing data untouched. The "already checked" result is cached so this
// costs one extra read per sheet per 6 hours instead of one per request —
// this is a large part of why the portal feels quicker than it used to.
function ensureHeaders_(sheet, requiredHeaders, cacheKey) {
  const cache = CacheService.getScriptCache();
  if (cache.get(cacheKey)) return sheet;

  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow(requiredHeaders);
    sheet.setFrozenRows(1);
  } else {
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const missing = requiredHeaders.filter(function (h) { return headers.indexOf(h) === -1; });
    if (missing.length > 0) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    }
  }
  cache.put(cacheKey, '1', SESSION_TTL_SECONDS);
  return sheet;
}

function getHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach(function (h, i) { map[h] = i + 1; });
  return map;
}

function appendRowByHeaders_(sheet, valuesObj) {
  const map = getHeaderMap_(sheet);
  const row = new Array(sheet.getLastColumn()).fill('');
  Object.keys(valuesObj).forEach(function (key) {
    if (map[key]) row[map[key] - 1] = valuesObj[key];
  });
  sheet.appendRow(row);
}

function rowsToObjects_(data) {
  const rows = data.slice();
  const headers = rows.shift();
  return rows.map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = formatCellForOutput_(h, row[i]); });
    return obj;
  });
}

// A time-only value from an <input type="time"> is stored by Sheets as a Date
// anchored to Dec 30 1899. Reading only the time part keeps that stray date
// from ever surfacing as "1899".
function formatCellForOutput_(header, value) {
  if (!(value instanceof Date)) return value;
  if (header === 'InterviewTime') return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (header === 'InterviewDate' || header === 'DOB' || header === 'Deadline') return value.toLocaleDateString();
  if (header === 'PostedDate' || header === 'CreatedDate') return value.toLocaleDateString();
  if (['ShortlistedDate', 'HiredDate', 'DecisionDate', 'OutcomeDate'].indexOf(header) > -1) {
    return Utilities.formatDate(value, 'Asia/Kolkata', 'd MMM yyyy, h:mm a');
  }
  if (header === 'Timestamp' || header === 'LastUpdated') {
    return Utilities.formatDate(value, 'Asia/Kolkata', 'd MMM yyyy, h:mm a');
  }
  return value.toLocaleString();
}

function normalizeUsername_(username) {
  return String(username || '').trim().toLowerCase();
}

function escapeText_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}


// ============================================================================
// 4. JOBS
// Columns: ID | Title | Department | Location | Type | Salary | Description |
//          Requirements | EmployerEmail | PostedDate | Deadline | Status | PostedBy
// ============================================================================

const JOB_HEADERS = [
  'ID', 'Title', 'Department', 'Location', 'Type', 'Salary',
  'Description', 'Requirements', 'EmployerEmail', 'PostedDate', 'Deadline', 'Status', 'PostedBy'
];

function getJobsSheet() {
  const sheet = getOrCreateSheet_(JOBS_SHEET_NAME, JOB_HEADERS);
  return ensureHeaders_(sheet, JOB_HEADERS, 'schema_jobs_v2');
}

function clearJobsCache_() {
  CacheService.getScriptCache().remove('active_jobs_v2');
}

// PUBLIC — only Active jobs appear on the careers page. Cached.
function getActiveJobs() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('active_jobs_v2');
  if (cached) return JSON.parse(cached);

  const sheet = getJobsSheet();
  const data = sheet.getDataRange().getValues();
  const jobs = data.length < 2 ? [] : rowsToObjects_(data).filter(function (j) {
    return String(j.Status).toLowerCase() === 'active';
  });

  cache.put('active_jobs_v2', JSON.stringify(jobs), JOBS_CACHE_TTL_SECONDS);
  return jobs;
}

function getAllJobs_() {
  const sheet = getJobsSheet();
  const data = sheet.getDataRange().getValues();
  return data.length < 2 ? [] : rowsToObjects_(data);
}

// HR — PostedBy records who created the job so Admin can see per-HR counts.
// It never restricts who may edit the job afterwards.
function addJob(token, job) {
  const session = requireRole_(token, 'hr');
  if (session.error) return session.error;
  if (!job || !escapeText_(job.title) || !escapeText_(job.description)) {
    return { status: 'error', message: 'Job title and description are required.' };
  }

  const sheet = getJobsSheet();
  const id = 'JOB-' + new Date().getTime();
  appendRowByHeaders_(sheet, {
    ID: id,
    Title: escapeText_(job.title),
    Department: escapeText_(job.department),
    Location: escapeText_(job.location),
    Type: escapeText_(job.type),
    Salary: escapeText_(job.salary),
    Description: escapeText_(job.description),
    Requirements: escapeText_(job.requirements),
    EmployerEmail: escapeText_(job.employerEmail),
    PostedDate: new Date(),
    Deadline: escapeText_(job.deadline),
    Status: job.status || 'Active',
    PostedBy: normalizeUsername_(session.username)
  });
  clearJobsCache_();
  return { status: 'success', id: id };
}

function updateJob(token, job) {
  const session = requireRole_(token, 'hr');
  if (session.error) return session.error;

  const sheet = getJobsSheet();
  const map = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] !== job.ID) continue;
    const row = i + 1;
    const updates = {
      Title: escapeText_(job.Title),
      Department: escapeText_(job.Department),
      Location: escapeText_(job.Location),
      Type: escapeText_(job.Type),
      Salary: escapeText_(job.Salary),
      Description: escapeText_(job.Description),
      Requirements: escapeText_(job.Requirements),
      EmployerEmail: escapeText_(job.EmployerEmail),
      Deadline: escapeText_(job.Deadline),
      Status: job.Status || 'Active'
    };
    // One contiguous write instead of ten single-cell writes.
    const rowValues = data[i].slice();
    Object.keys(updates).forEach(function (key) {
      if (map[key]) rowValues[map[key] - 1] = updates[key];
    });
    sheet.getRange(row, 1, 1, rowValues.length).setValues([rowValues]);
    clearJobsCache_();
    return { status: 'success' };
  }
  return { status: 'error', message: 'Job not found' };
}

function deleteJob(token, jobId) {
  const session = requireRole_(token, 'hr');
  if (session.error) return session.error;

  const sheet = getJobsSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === jobId) {
      sheet.deleteRow(i + 1);
      clearJobsCache_();
      return { status: 'success' };
    }
  }
  return { status: 'error', message: 'Job not found' };
}


// ============================================================================
// 5. APPLICATIONS
// Anyone can apply — the form on the careers page is the only step. No account,
// no password, no login.
//
// HIRING PIPELINE
//   Received ──► Interview Scheduled (Round 1) ──► Shortlisted ──► Interview
//   Scheduled (Round 2) ──► Shortlisted ──► … ──► Hired
//                     └──────────────► Rejected (at any point)
//
// A candidate keeps every stage they reached: "Shortlisted" = TRUE stays set
// after they are hired or rejected later, so the dashboard can list them under
// every tab they passed through.
// ============================================================================

const APPLICATION_HEADERS = [
  'ID', 'Timestamp', 'JobID', 'JobTitle', 'FullName', 'Email', 'Phone', 'DOB',
  'Qualification', 'Experience', 'CoverNote', 'ResumeLink', 'ResumeFileName',
  'Status', 'InterviewDate', 'InterviewTime', 'InterviewMode', 'InterviewLocation',
  'InterviewNotes', 'LastUpdated',
  'CurrentRound', 'Shortlisted', 'ShortlistedDate', 'RejectedAt', 'HiredDate',
  'DecisionDate', 'DecisionBy', 'DecisionNotes'
];

const APPLICATION_STATUSES = [
  'Received', 'Reviewed', 'Interview Scheduled', 'Shortlisted', 'Rejected', 'Hired'
];

function getApplicationsSheet() {
  const sheet = getOrCreateSheet_(APPLICATIONS_SHEET_NAME, APPLICATION_HEADERS);
  return ensureHeaders_(sheet, APPLICATION_HEADERS, 'schema_apps_v3');
}

function findApplicationRowById_(sheet, applicationId) {
  const map = getHeaderMap_(sheet);
  const idCol = map['ID'];
  const lastRow = sheet.getLastRow();
  if (!idCol || lastRow < 2) return -1;
  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(applicationId)) return i + 2;
  }
  return -1;
}

// Reads one application row into { row, map, values, get(header) }.
function loadApplication_(applicationId) {
  const sheet = getApplicationsSheet();
  const row = findApplicationRowById_(sheet, applicationId);
  if (row === -1) return null;
  const map = getHeaderMap_(sheet);
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  return {
    sheet: sheet,
    row: row,
    map: map,
    values: values,
    get: function (h) { return map[h] ? values[map[h] - 1] : ''; }
  };
}

// Writes several fields of an application back in one call. Date/time strings
// typed on the site are forced to plain text so Sheets does not convert them.
function saveApplicationFields_(app, fields) {
  const rowValues = app.values.slice();
  Object.keys(fields).forEach(function (h) {
    if (app.map[h]) rowValues[app.map[h] - 1] = fields[h];
  });
  ['InterviewDate', 'InterviewTime'].forEach(function (h) {
    if (app.map[h] && fields.hasOwnProperty(h)) app.sheet.getRange(app.row, app.map[h]).setNumberFormat('@');
  });
  app.sheet.getRange(app.row, 1, 1, rowValues.length).setValues([rowValues]);
  app.values = rowValues;
}

function currentRound_(app) {
  const n = parseInt(app.get('CurrentRound'), 10);
  return isNaN(n) || n < 1 ? 1 : n;
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

// The job's own hiring email, used as Reply-To on candidate emails.
function getJobReplyTo_(jobId) {
  const jobs = getAllJobs_();
  for (let i = 0; i < jobs.length; i++) {
    if (jobs[i].ID === jobId) {
      const e = String(jobs[i].EmployerEmail || '').trim();
      return isValidEmail_(e) && e !== FALLBACK_EMPLOYER_EMAIL ? e : '';
    }
  }
  return '';
}

function getOrCreateDriveFolder_(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

// Uploads a base64 data URI to Drive and returns a shareable link, or ''.
function uploadResume_(fileData, fileName, mimeType) {
  if (!fileData || !fileName) return '';
  const folder = getOrCreateDriveFolder_(RESUME_FOLDER_NAME);
  const base64 = fileData.indexOf(',') > -1 ? fileData.split(',')[1] : fileData;
  const decoded = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(decoded, mimeType || 'application/octet-stream', fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

/**
 * PUBLIC — a candidate fills in the form on the careers page and submits.
 * application = { jobId, fullName, email, phone, dob, qualification,
 *                 experience, coverNote, resumeData, resumeFileName, resumeMimeType }
 */
function submitApplication(application) {
  const a = application || {};
  const fullName = escapeText_(a.fullName);
  const email = escapeText_(a.email);
  const phone = escapeText_(a.phone);
  const jobId = escapeText_(a.jobId);

  if (!jobId) return { status: 'error', message: 'Pick a job before applying.' };
  if (!fullName) return { status: 'error', message: 'Enter your full name.' };
  if (!isValidEmail_(email)) return { status: 'error', message: 'Enter a valid email address.' };
  if (!phone) return { status: 'error', message: 'Enter a phone number we can reach you on.' };
  if (!a.resumeData || !a.resumeFileName) return { status: 'error', message: 'Attach your resume.' };

  // Rough base64 -> bytes check, so an oversized file fails fast and clearly.
  const approxBytes = String(a.resumeData).length * 0.75;
  if (approxBytes > MAX_RESUME_MB * 1024 * 1024) {
    return { status: 'error', message: 'Your resume is larger than ' + MAX_RESUME_MB + ' MB. Attach a smaller file.' };
  }

  // The job must exist and still be open.
  const jobs = getActiveJobs();
  let job = null;
  for (let i = 0; i < jobs.length; i++) {
    if (jobs[i].ID === jobId) { job = jobs[i]; break; }
  }
  if (!job) return { status: 'error', message: 'This role is no longer accepting applications.' };

  const sheet = getApplicationsSheet();
  const map = getHeaderMap_(sheet);
  const lastRow = sheet.getLastRow();

  // Block a second application to the same job from the same email. Reads only
  // the two columns needed rather than the whole sheet.
  if (lastRow > 1) {
    const emailCol = sheet.getRange(2, map['Email'], lastRow - 1, 1).getValues();
    const jobCol = sheet.getRange(2, map['JobID'], lastRow - 1, 1).getValues();
    const em = normalizeUsername_(email);
    for (let r = 0; r < emailCol.length; r++) {
      if (normalizeUsername_(emailCol[r][0]) === em && String(jobCol[r][0]) === jobId) {
        return { status: 'error', message: 'You have already applied for this role with this email address.' };
      }
    }
  }

  const resumeUrl = uploadResume_(a.resumeData, a.resumeFileName, a.resumeMimeType);
  const now = new Date();
  const id = 'APP-' + now.getTime();

  appendRowByHeaders_(sheet, {
    ID: id,
    Timestamp: now,
    JobID: jobId,
    JobTitle: job.Title,
    FullName: fullName,
    Email: email,
    Phone: phone,
    DOB: escapeText_(a.dob),
    Qualification: escapeText_(a.qualification),
    Experience: escapeText_(a.experience),
    CoverNote: escapeText_(a.coverNote),
    ResumeLink: resumeUrl,
    ResumeFileName: escapeText_(a.resumeFileName),
    Status: 'Received',
    LastUpdated: now
  });

  sendEmployerNotification_({
    id: id,
    jobId: jobId,
    jobTitle: job.Title,
    department: job.Department,
    location: job.Location,
    employerEmail: job.EmployerEmail,
    fullName: fullName,
    email: email,
    phone: phone,
    dob: escapeText_(a.dob),
    qualification: escapeText_(a.qualification),
    experience: escapeText_(a.experience),
    coverNote: escapeText_(a.coverNote),
    resumeUrl: resumeUrl
  });

  sendApplicantConfirmation_({
    id: id,
    fullName: fullName,
    email: email,
    jobTitle: job.Title,
    department: job.Department,
    location: job.Location,
    replyTo: isValidEmail_(job.EmployerEmail) && job.EmployerEmail !== FALLBACK_EMPLOYER_EMAIL ? job.EmployerEmail : ''
  });

  return { status: 'success', message: 'Application received. We have emailed you a confirmation.' };
}

function getAllApplications_() {
  const sheet = getApplicationsSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  return rowsToObjects_(data).reverse().map(function (a) {
    a.CurrentRound = parseInt(a.CurrentRound, 10) || (a.InterviewDate ? 1 : 0);
    // Rows from before rounds existed: a Shortlisted status still counts.
    a.Shortlisted = isTrue_(a.Shortlisted) || a.Status === 'Shortlisted';
    return a;
  });
}

/**
 * HR — close out a candidate outside an interview result:
 *   Rejected  from Received / Reviewed (screening) or Shortlisted
 *   Hired     from Shortlisted
 * p = { applicationId, decision, notes, message, notify }
 */
function decideCandidate(token, p) {
  const session = requireRole_(token, 'hr');
  if (session.error) return session.error;
  p = p || {};
  if (p.decision !== 'Hired' && p.decision !== 'Rejected') return { status: 'error', message: 'Invalid decision.' };

  const app = loadApplication_(p.applicationId);
  if (!app) return { status: 'error', message: 'Application not found' };

  const status = String(app.get('Status') || 'Received');
  const round = currentRound_(app);

  if (status === 'Hired' || status === 'Rejected') {
    return { status: 'error', message: 'This candidate is already marked ' + status.toLowerCase() + '.' };
  }
  if (status === 'Interview Scheduled') {
    return { status: 'error', message: 'Record the result of round ' + round + ' from the Interviews tab.' };
  }
  if (p.decision === 'Hired' && status !== 'Shortlisted') {
    return { status: 'error', message: 'Shortlist the candidate through an interview before hiring.' };
  }

  const now = new Date();
  const fields = {
    Status: p.decision,
    LastUpdated: now,
    DecisionDate: now,
    DecisionBy: session.username,
    DecisionNotes: escapeText_(p.notes)
  };
  if (p.decision === 'Rejected') fields.RejectedAt = status === 'Shortlisted' ? 'After round ' + round : 'Screening';
  if (p.decision === 'Hired') fields.HiredDate = now;
  saveApplicationFields_(app, fields);
  syncStageSheets_(app);

  let emailSent = false;
  if (p.notify !== false) emailSent = sendDecisionEmail_(app, p.decision, round, escapeText_(p.message));

  return { status: 'success', message: 'Candidate marked ' + p.decision.toLowerCase() + '.', emailSent: emailSent };
}


// ============================================================================
// 6. INTERVIEWS — one row per round
// Rescheduling updates that round's row; the result of the round (Shortlisted,
// Rejected, Hired) is recorded on the same row.
// ============================================================================

const INTERVIEW_HEADERS = [
  'Timestamp', 'ApplicationID', 'JobID', 'JobTitle', 'ApplicantName', 'ApplicantEmail',
  'InterviewDate', 'InterviewTime', 'Mode', 'Location', 'Notes', 'ScheduledBy', 'Action',
  'InterviewID', 'Round', 'Outcome', 'OutcomeNotes', 'OutcomeBy', 'OutcomeDate'
];

const INTERVIEW_OUTCOMES = ['Pending', 'Shortlisted', 'Rejected', 'Hired'];

function getInterviewsSheet() {
  const sheet = getOrCreateSheet_(INTERVIEWS_SHEET_NAME, INTERVIEW_HEADERS);
  return ensureHeaders_(sheet, INTERVIEW_HEADERS, 'schema_interviews_v3');
}

// Latest row for this application + round (older rows had no Round = round 1).
function findInterviewRow_(sheet, applicationId, round) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const map = getHeaderMap_(sheet);
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    const r = parseInt(data[i][map['Round'] - 1], 10) || 1;
    if (String(data[i][map['ApplicationID'] - 1]) === String(applicationId) && r === round) return i + 2;
  }
  return -1;
}

/**
 * HR — schedule an interview round, or reschedule the current one, and email
 * the candidate. The round is worked out from where the candidate is:
 *   Received / Reviewed  → Round 1
 *   Interview Scheduled  → reschedule the current round
 *   Shortlisted          → the next round
 * interview = { applicationId, date, time, mode, location, notes }
 */
function scheduleInterview(token, interview) {
  const session = requireRole_(token, 'hr');
  if (session.error) return session.error;
  if (!interview || !interview.applicationId || !interview.date || !interview.time) {
    return { status: 'error', message: 'Date and time are required.' };
  }

  const app = loadApplication_(interview.applicationId);
  if (!app) return { status: 'error', message: 'Application not found' };

  const status = String(app.get('Status') || 'Received');
  if (status === 'Hired' || status === 'Rejected') {
    return { status: 'error', message: 'This candidate is already ' + status.toLowerCase() + '. Their process is closed.' };
  }

  const isReschedule = status === 'Interview Scheduled';
  let round;
  if (isReschedule) round = currentRound_(app);
  else if (status === 'Shortlisted') round = currentRound_(app) + 1;
  else round = 1;

  const now = new Date();
  const mode = interview.mode || 'Online';
  const location = escapeText_(interview.location);
  const notes = escapeText_(interview.notes);

  const ivSheet = getInterviewsSheet();
  const ivMap = getHeaderMap_(ivSheet);
  let ivRow = isReschedule ? findInterviewRow_(ivSheet, interview.applicationId, round) : -1;

  const ivFields = {
    Timestamp: now,
    ApplicationID: interview.applicationId,
    JobID: app.get('JobID'),
    JobTitle: app.get('JobTitle'),
    ApplicantName: app.get('FullName'),
    ApplicantEmail: app.get('Email'),
    Mode: mode,
    Location: location,
    Notes: notes,
    ScheduledBy: session.username,
    Action: isReschedule ? 'Rescheduled' : 'Scheduled',
    Round: round,
    Outcome: 'Pending'
  };

  if (ivRow === -1) {
    ivFields.InterviewID = 'INT-' + now.getTime();
    appendRowByHeaders_(ivSheet, ivFields);
    ivRow = ivSheet.getLastRow();
  } else {
    const rowValues = ivSheet.getRange(ivRow, 1, 1, ivSheet.getLastColumn()).getValues()[0];
    if (!rowValues[ivMap['InterviewID'] - 1]) ivFields.InterviewID = 'INT-' + now.getTime();
    Object.keys(ivFields).forEach(function (h) { if (ivMap[h]) rowValues[ivMap[h] - 1] = ivFields[h]; });
    ivSheet.getRange(ivRow, 1, 1, rowValues.length).setValues([rowValues]);
  }
  // Date/time are plain strings like "2026-08-20" / "14:30"; keep them as text.
  ivSheet.getRange(ivRow, ivMap['InterviewDate']).setNumberFormat('@').setValue(interview.date);
  ivSheet.getRange(ivRow, ivMap['InterviewTime']).setNumberFormat('@').setValue(interview.time);

  saveApplicationFields_(app, {
    Status: 'Interview Scheduled',
    CurrentRound: round,
    InterviewDate: interview.date,
    InterviewTime: interview.time,
    InterviewMode: mode,
    InterviewLocation: location,
    InterviewNotes: notes,
    LastUpdated: now
  });
  syncStageSheets_(app);

  const emailSent = sendInterviewInvitation_({
    applicantName: app.get('FullName'),
    applicantEmail: app.get('Email'),
    jobTitle: app.get('JobTitle'),
    round: round,
    date: interview.date,
    time: interview.time,
    mode: mode,
    location: location,
    notes: notes,
    isReschedule: isReschedule,
    replyTo: getJobReplyTo_(app.get('JobID'))
  });

  return {
    status: 'success',
    message: (isReschedule ? 'Round ' + round + ' rescheduled.' : 'Round ' + round + ' scheduled.'),
    emailSent: emailSent,
    round: round
  };
}

/**
 * HR — record how an interview round went. This is what moves the candidate
 * to the Shortlisted, Rejected or Hired tab.
 * p = { applicationId, outcome: 'Shortlisted'|'Rejected'|'Hired', notes, message, notify }
 */
function recordInterviewOutcome(token, p) {
  const session = requireRole_(token, 'hr');
  if (session.error) return session.error;
  p = p || {};
  if (['Shortlisted', 'Rejected', 'Hired'].indexOf(p.outcome) === -1) {
    return { status: 'error', message: 'Pick Shortlisted, Rejected or Hired.' };
  }

  const app = loadApplication_(p.applicationId);
  if (!app) return { status: 'error', message: 'Application not found' };
  if (String(app.get('Status')) !== 'Interview Scheduled') {
    return { status: 'error', message: 'There is no interview waiting for a result for this candidate.' };
  }

  const round = currentRound_(app);
  const now = new Date();

  const ivSheet = getInterviewsSheet();
  const ivMap = getHeaderMap_(ivSheet);
  const ivRow = findInterviewRow_(ivSheet, p.applicationId, round);
  if (ivRow !== -1) {
    const rowValues = ivSheet.getRange(ivRow, 1, 1, ivSheet.getLastColumn()).getValues()[0];
    const set = { Round: round, Outcome: p.outcome, OutcomeNotes: escapeText_(p.notes), OutcomeBy: session.username, OutcomeDate: now };
    Object.keys(set).forEach(function (h) { if (ivMap[h]) rowValues[ivMap[h] - 1] = set[h]; });
    ivSheet.getRange(ivRow, 1, 1, rowValues.length).setValues([rowValues]);
    // setValues would have turned the text date/time back into dates.
    ivSheet.getRange(ivRow, ivMap['InterviewDate']).setNumberFormat('@');
    ivSheet.getRange(ivRow, ivMap['InterviewTime']).setNumberFormat('@');
  }

  const fields = { Status: p.outcome, LastUpdated: now };
  if (p.outcome === 'Shortlisted') {
    fields.Shortlisted = 'TRUE';
    fields.ShortlistedDate = now;
  } else {
    fields.DecisionDate = now;
    fields.DecisionBy = session.username;
    fields.DecisionNotes = escapeText_(p.notes);
    if (p.outcome === 'Rejected') fields.RejectedAt = 'Round ' + round;
    if (p.outcome === 'Hired') fields.HiredDate = now;
  }
  saveApplicationFields_(app, fields);
  syncStageSheets_(app);

  let emailSent = false;
  if (p.notify !== false) emailSent = sendDecisionEmail_(app, p.outcome, round, escapeText_(p.message));

  const label = { Shortlisted: 'shortlisted', Rejected: 'rejected', Hired: 'hired' }[p.outcome];
  return { status: 'success', message: 'Round ' + round + ' recorded — candidate ' + label + '.', emailSent: emailSent };
}

/**
 * Every interview round, one record per application + round (latest
 * reschedule wins), most recent first. Older rows written before rounds
 * existed are read as round 1, and their result is taken from the
 * application's status.
 */
function getInterviewRounds_(applications) {
  const sheet = getInterviewsSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const appById = {};
  (applications || getAllApplications_()).forEach(function (a) { appById[a.ID] = a; });

  const seen = {};
  const out = [];
  rowsToObjects_(data).reverse().forEach(function (iv) {
    iv.Round = parseInt(iv.Round, 10) || 1;
    const key = iv.ApplicationID + '#' + iv.Round;
    if (seen[key]) return;
    seen[key] = true;

    if (!iv.Outcome) {
      const app = appById[iv.ApplicationID];
      const appRound = app ? (parseInt(app.CurrentRound, 10) || 1) : 1;
      if (!app) iv.Outcome = '';
      else if (iv.Round < appRound) iv.Outcome = 'Shortlisted';
      else if (app.Status === 'Interview Scheduled') iv.Outcome = 'Pending';
      else if (['Shortlisted', 'Rejected', 'Hired'].indexOf(app.Status) > -1) iv.Outcome = app.Status;
      else iv.Outcome = '';
    }
    out.push(iv);
  });
  return out;
}

// HR — kept for older clients; the dashboard now gets rounds from getDashboard.
function getInterviews(token) {
  const session = requireRole_(token, 'hr');
  if (session.error) return session.error;
  return { status: 'success', interviews: getInterviewRounds_() };
}



// ============================================================================
// 6b. STAGE SHEETS — Shortlisted, Hired, Rejected
// One row per candidate in each tab of the spreadsheet, kept in step with the
// Applications sheet every time a candidate moves. Like the dashboard, a
// candidate stays on the Shortlisted sheet after they are hired or rejected,
// with "Current status" showing where they ended up. Applications remains the
// master record; use Careers Portal → Rebuild stage sheets to regenerate these.
// ============================================================================

const SHORTLISTED_HEADERS = [
  'ApplicationID', 'Candidate', 'Email', 'Phone', 'Role', 'Qualification', 'Experience',
  'RoundsCleared', 'CurrentStatus', 'NextInterview', 'ShortlistedOn', 'Resume', 'LastUpdated'
];
const HIRED_HEADERS = [
  'ApplicationID', 'Candidate', 'Email', 'Phone', 'Role', 'Qualification', 'Experience',
  'Rounds', 'HiredOn', 'HiredBy', 'Notes', 'Resume', 'AppliedOn'
];
const REJECTED_HEADERS = [
  'ApplicationID', 'Candidate', 'Email', 'Phone', 'Role', 'Qualification', 'Experience',
  'RejectedAt', 'RejectedOn', 'RejectedBy', 'Notes', 'Resume', 'AppliedOn'
];

const STAGE_SHEETS = [
  { name: SHORTLISTED_SHEET_NAME, headers: SHORTLISTED_HEADERS, key: 'schema_shortlisted_v1', color: '#57407F',
    include: function (r) { return isTrue_(r.Shortlisted) || r.Status === 'Shortlisted'; },
    row: function (r) {
      return {
        RoundsCleared: roundsCleared_(r), CurrentStatus: stageLabel_(r),
        NextInterview: r.Status === 'Interview Scheduled' ? ('Round ' + (parseInt(r.CurrentRound, 10) || 1) + ' · ' + r.InterviewDate + ' ' + r.InterviewTime) : '',
        ShortlistedOn: r.ShortlistedDate, LastUpdated: new Date()
      };
    } },
  { name: HIRED_SHEET_NAME, headers: HIRED_HEADERS, key: 'schema_hired_v1', color: '#1F6B4B',
    include: function (r) { return r.Status === 'Hired'; },
    row: function (r) {
      return { Rounds: parseInt(r.CurrentRound, 10) || '', HiredOn: r.HiredDate || r.DecisionDate,
        HiredBy: r.DecisionBy, Notes: r.DecisionNotes, AppliedOn: r.Timestamp };
    } },
  { name: REJECTED_SHEET_NAME, headers: REJECTED_HEADERS, key: 'schema_rejected_v1', color: '#A3261C',
    include: function (r) { return r.Status === 'Rejected'; },
    row: function (r) {
      return { RejectedAt: r.RejectedAt || 'Screening', RejectedOn: r.DecisionDate || r.LastUpdated,
        RejectedBy: r.DecisionBy, Notes: r.DecisionNotes, AppliedOn: r.Timestamp };
    } }
];

function getStageSheet_(spec) {
  return ensureHeaders_(getOrCreateSheet_(spec.name, spec.headers), spec.headers, spec.key);
}

function roundsCleared_(r) {
  const n = parseInt(r.CurrentRound, 10) || 0;
  if (r.Status === 'Shortlisted' || r.Status === 'Hired') return n;
  if (r.Status === 'Interview Scheduled') return Math.max(n - 1, 0);
  if (r.Status === 'Rejected') return /^Round/.test(String(r.RejectedAt || '')) ? Math.max(n - 1, 0) : n;
  return 0;
}

function stageLabel_(r) {
  const n = parseInt(r.CurrentRound, 10) || 1;
  switch (r.Status) {
    case 'Interview Scheduled': return 'Round ' + n + ' scheduled';
    case 'Shortlisted': return 'Shortlisted — awaiting round ' + (n + 1);
    case 'Hired': return 'Hired';
    case 'Rejected': return 'Rejected' + (r.RejectedAt ? ' (' + String(r.RejectedAt).toLowerCase() + ')' : '');
    default: return 'New application';
  }
}

function stageRecordFromApp_(app) {
  const rec = {};
  Object.keys(app.map).forEach(function (h) { rec[h] = app.values[app.map[h] - 1]; });
  return rec;
}

// Adds, updates or removes this candidate's row on every stage sheet.
function syncStageSheets_(app) {
  try {
    const r = stageRecordFromApp_(app);
    STAGE_SHEETS.forEach(function (spec) {
      const sheet = getStageSheet_(spec);
      const map = getHeaderMap_(sheet);
      const lastRow = sheet.getLastRow();
      let row = -1;
      if (lastRow > 1) {
        const ids = sheet.getRange(2, map['ApplicationID'], lastRow - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(r.ID)) { row = i + 2; break; }
      }
      if (!spec.include(r)) {
        if (row !== -1) sheet.deleteRow(row);
        return;
      }
      const values = Object.assign({
        ApplicationID: r.ID, Candidate: r.FullName, Email: r.Email, Phone: r.Phone, Role: r.JobTitle,
        Qualification: r.Qualification, Experience: r.Experience, Resume: r.ResumeLink
      }, spec.row(r));
      if (row === -1) {
        appendRowByHeaders_(sheet, values);
      } else {
        const rowValues = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
        Object.keys(values).forEach(function (h) { if (map[h]) rowValues[map[h] - 1] = values[h]; });
        sheet.getRange(row, 1, 1, rowValues.length).setValues([rowValues]);
      }
    });
  } catch (err) {
    Logger.log('Stage sheet sync failed: ' + err.toString());
  }
}

/** REBUILD STAGE SHEETS — regenerates Shortlisted / Hired / Rejected from Applications. */
function rebuildStageSheets(silent) {
  const appsSheet = getApplicationsSheet();
  const data = appsSheet.getDataRange().getValues();
  const headers = data[0];
  const records = data.slice(1).map(function (row) {
    const r = {}; headers.forEach(function (h, i) { r[h] = row[i]; }); return r;
  });
  const report = [];
  STAGE_SHEETS.forEach(function (spec) {
    const sheet = getStageSheet_(spec);
    if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
    const map = getHeaderMap_(sheet);
    const width = sheet.getLastColumn();
    const rows = records.filter(spec.include).map(function (r) {
      const values = Object.assign({
        ApplicationID: r.ID, Candidate: r.FullName, Email: r.Email, Phone: r.Phone, Role: r.JobTitle,
        Qualification: r.Qualification, Experience: r.Experience, Resume: r.ResumeLink
      }, spec.row(r));
      const out = new Array(width).fill('');
      Object.keys(values).forEach(function (h) { if (map[h]) out[map[h] - 1] = values[h]; });
      return out;
    });
    if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows);
    report.push('✔ ' + spec.name + ' — ' + rows.length + ' candidate' + (rows.length === 1 ? '' : 's'));
  });
  if (silent !== true) notify_('Stage sheets rebuilt', report.join('\n'));
  return report;
}

// ============================================================================
// 7. EMAIL — branded HTML templates
// Every email shares one layout: Kalimark logo on white, a red brand stripe,
// a title band, the message, an optional details card and button, and a
// dark footer with the company's contact details. A plain-text version goes
// with each one for mail apps that do not show HTML.
// ============================================================================

const SITE_URL = 'https://sparkling.co.in';
const LOGO_URL = SITE_URL + '/images/email-logo.png';   // upload images/email-logo.png with the site
const CAREERS_URL = SITE_URL + '/careers.html';
const DASHBOARD_URL = SITE_URL + '/admin.html';
const LEGAL_NAME = 'Kalis Sparkling Water Pvt Ltd';
const COMPANY_ADDRESS = 'No. 612, 610, 610A, Chaitanya Imperial Building, 6th Floor, Anna Salai, Teynampet, Chennai – 600 018';
const COMPANY_PHONE = '044-24311253';
const COMPANY_SUPPORT_EMAIL = 'support@kalimark.net';
const MAIL_SENDER_NAME = 'Kalimark Careers';
const MAIL_TIMEZONE = 'Asia/Kolkata';

function h_(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function nl2br_(s) { return h_(s).replace(/\n/g, '<br>'); }

// "2026-10-12" → "Monday, 12 October 2026"
function prettyDate_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Utilities.formatDate(d, MAIL_TIMEZONE, 'EEEE, d MMMM yyyy');
}

// "14:30" → "2:30 PM"
function prettyTime_(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return String(t || '');
  let hr = Number(m[1]);
  const ap = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return hr + ':' + m[2] + ' ' + ap + ' IST';
}

function roundLabel_(n) {
  const names = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
  return (names[n] || ('Round ' + n)) + (names[n] ? ' round' : '');
}

// Google Calendar "add event" link for a 1-hour interview slot.
function calendarLink_(d) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.date || ''));
  const tm = /^(\d{1,2}):(\d{2})/.exec(String(d.time || ''));
  if (!dm || !tm) return '';
  const pad = function (n) { return ('0' + n).slice(-2); };
  const start = dm[1] + dm[2] + dm[3] + 'T' + pad(Number(tm[1])) + tm[2] + '00';
  const endH = Number(tm[1]) + 1;
  const end = dm[1] + dm[2] + dm[3] + 'T' + pad(endH > 23 ? 23 : endH) + (endH > 23 ? '59' : tm[2]) + '00';
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(roundLabel_(d.round) + ' interview — ' + d.jobTitle + ' at ' + COMPANY_NAME) +
    '&dates=' + start + '/' + end +
    '&ctz=' + encodeURIComponent(MAIL_TIMEZONE) +
    '&details=' + encodeURIComponent('Interview for the ' + d.jobTitle + ' role at ' + COMPANY_NAME + '.' + (d.notes ? '\n\n' + d.notes : '')) +
    (d.location ? '&location=' + encodeURIComponent(d.location) : '');
}

/**
 * Builds the HTML and plain-text body for one email.
 * c = {
 *   preheader,            inbox preview line
 *   tag,                  small label above the title, e.g. "Interview invitation"
 *   title,                headline in the red band
 *   tone,                 'brand' (red) | 'success' (green) | 'neutral' (ink)
 *   greeting,             "Dear Priya,"
 *   paragraphs: [],       body text (plain strings)
 *   details: [[k, v]],    card of key/value rows
 *   detailsTitle,
 *   button: { label, url }, secondary: { label, url },
 *   steps: { title, items: [] },   numbered "what happens next"
 *   note,                 highlighted note (e.g. HR's message)
 *   noteTitle,
 *   closing,              paragraph before the sign-off
 *   signoff               defaults to "Kalimark Hiring Team"
 * }
 */
function buildEmail_(c) {
  const band = { brand: ['#781517', '#d02527'], success: ['#14513A', '#1F7A55'], neutral: ['#17130F', '#3A312A'] }[c.tone || 'brand'];
  const font = "'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif";

  let detailsHtml = '';
  if (c.details && c.details.length) {
    detailsHtml =
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;border:1px solid #EADFCB;border-radius:12px;background:#FBF7EE;">' +
      (c.detailsTitle ? '<tr><td colspan="2" style="padding:16px 22px 4px;font:700 11px/1.4 ' + font + ';letter-spacing:.12em;text-transform:uppercase;color:#B07D22;">' + h_(c.detailsTitle) + '</td></tr>' : '') +
      c.details.map(function (kv, i) {
        const top = i === 0 && !c.detailsTitle ? '16px' : '10px';
        const bottom = i === c.details.length - 1 ? '18px' : '10px';
        const border = i === c.details.length - 1 ? '' : 'border-bottom:1px solid #EFE6D4;';
        return '<tr>' +
          '<td valign="top" style="padding:' + top + ' 10px ' + bottom + ' 22px;width:34%;font:600 13px/1.5 ' + font + ';color:#8C8079;' + border + '">' + h_(kv[0]) + '</td>' +
          '<td valign="top" style="padding:' + top + ' 22px ' + bottom + ' 10px;font:600 14px/1.5 ' + font + ';color:#17130F;' + border + '">' + (kv[2] ? kv[1] : nl2br_(kv[1])) + '</td>' +
          '</tr>';
      }).join('') +
      '</table>';
  }

  let noteHtml = '';
  if (c.note) {
    noteHtml =
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;"><tr>' +
      '<td style="border-left:4px solid #d02527;background:#FDF3F2;border-radius:0 10px 10px 0;padding:14px 18px;">' +
      (c.noteTitle ? '<div style="font:700 11px/1.4 ' + font + ';letter-spacing:.1em;text-transform:uppercase;color:#A3261C;margin-bottom:4px;">' + h_(c.noteTitle) + '</div>' : '') +
      '<div style="font:400 14px/1.65 ' + font + ';color:#3A312A;">' + nl2br_(c.note) + '</div>' +
      '</td></tr></table>';
  }

  function btn(b, primary) {
    if (!b || !b.url) return '';
    const style = primary
      ? 'background-color:#a31d20;background-image:linear-gradient(90deg,#781517,#d02527,#781517);color:#ffffff;'
      : 'background-color:#ffffff;color:#781517;border:1.5px solid #E3D9C6;';
    return '<td style="padding:0 10px 10px 0;"><a href="' + h_(b.url) + '" target="_blank" style="display:inline-block;' + style +
      'font:700 14px/1 ' + font + ';text-decoration:none;padding:15px 30px;border-radius:999px;">' + h_(b.label) + '</a></td>';
  }
  const buttonsHtml = (c.button || c.secondary)
    ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 6px;"><tr>' + btn(c.button, true) + btn(c.secondary, false) + '</tr></table>'
    : '';

  let stepsHtml = '';
  if (c.steps && c.steps.items && c.steps.items.length) {
    stepsHtml =
      '<div style="margin:30px 0 4px;font:700 11px/1.4 ' + font + ';letter-spacing:.12em;text-transform:uppercase;color:#B07D22;">' + h_(c.steps.title || 'What happens next') + '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">' +
      c.steps.items.map(function (s, i) {
        return '<tr><td valign="top" style="width:38px;padding:0 0 14px;">' +
          '<div style="width:28px;height:28px;border-radius:50%;background-color:#a31d20;background-image:linear-gradient(135deg,#781517,#d02527);color:#fff;font:700 13px/28px ' + font + ';text-align:center;">' + (i + 1) + '</div></td>' +
          '<td valign="top" style="padding:4px 0 14px;font:400 14px/1.6 ' + font + ';color:#4A403A;">' + h_(s) + '</td></tr>';
      }).join('') +
      '</table>';
  }

  const paras = (c.paragraphs || []).map(function (p) {
    return '<p style="margin:0 0 16px;font:400 15px/1.7 ' + font + ';color:#4A403A;">' + nl2br_(p) + '</p>';
  }).join('');

  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light only"><title>' + h_(c.title) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet"></head>' +
    '<body style="margin:0;padding:0;background:#F2EADA;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">' + h_(c.preheader || c.title) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2EADA;"><tr><td align="center" style="padding:28px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 18px 40px -24px rgba(23,19,15,.45);">' +

    // logo
    '<tr><td align="center" style="padding:30px 32px 24px;background:#ffffff;">' +
    '<a href="' + SITE_URL + '" target="_blank" style="text-decoration:none;"><img src="' + LOGO_URL + '" width="190" alt="Kalimark" style="display:block;width:190px;max-width:60%;height:auto;border:0;"></a>' +
    '</td></tr>' +

    // title band
    '<tr><td style="background-color:' + band[0] + ';background-image:linear-gradient(120deg,' + band[0] + ' 0%,' + band[1] + ' 55%,' + band[0] + ' 100%);padding:34px 40px 36px;">' +
    (c.tag ? '<div style="font:700 11px/1.4 ' + font + ';letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.78);margin-bottom:10px;">' + h_(c.tag) + '</div>' : '') +
    '<div style="font:700 26px/1.3 ' + font + ';color:#ffffff;">' + h_(c.title) + '</div>' +
    '</td></tr>' +

    // body
    '<tr><td style="padding:36px 40px 12px;">' +
    (c.greeting ? '<p style="margin:0 0 16px;font:600 16px/1.6 ' + font + ';color:#17130F;">' + h_(c.greeting) + '</p>' : '') +
    paras + detailsHtml + noteHtml + buttonsHtml + stepsHtml +
    (c.closing ? '<p style="margin:22px 0 0;font:400 15px/1.7 ' + font + ';color:#4A403A;">' + nl2br_(c.closing) + '</p>' : '') +
    '<p style="margin:26px 0 0;font:400 15px/1.6 ' + font + ';color:#4A403A;">Warm regards,<br><strong style="color:#17130F;">' + h_(c.signoff || (COMPANY_NAME + ' Hiring Team')) + '</strong><br>' +
    '<span style="font-size:13px;color:#8C8079;">' + h_(LEGAL_NAME) + '</span></p>' +
    '</td></tr>' +

    '<tr><td style="padding:26px 40px 0;"><div style="height:1px;background:#EFE6D4;"></div></td></tr>' +
    '<tr><td style="padding:16px 40px 30px;font:400 12px/1.6 ' + font + ';color:#8C8079;">' +
    'Trusted across Tamil Nadu since 1916 — Bovonto, Kalimark beverages and Kalimark Foods.' +
    '</td></tr>' +

    // footer
    '<tr><td style="background:#17130F;padding:26px 40px 28px;">' +
    '<div style="font:700 14px/1.5 ' + font + ';color:#ffffff;">' + h_(LEGAL_NAME) + '</div>' +
    '<div style="font:400 12px/1.7 ' + font + ';color:#B9AEA4;margin-top:6px;">' + h_(COMPANY_ADDRESS) + '</div>' +
    '<div style="font:400 12px/1.7 ' + font + ';color:#B9AEA4;margin-top:6px;">' +
    '<a href="tel:+914424311253" style="color:#E8D4A8;text-decoration:none;">' + COMPANY_PHONE + '</a> &nbsp;·&nbsp; ' +
    '<a href="mailto:' + COMPANY_SUPPORT_EMAIL + '" style="color:#E8D4A8;text-decoration:none;">' + COMPANY_SUPPORT_EMAIL + '</a> &nbsp;·&nbsp; ' +
    '<a href="' + CAREERS_URL + '" style="color:#E8D4A8;text-decoration:none;">sparkling.co.in/careers</a></div>' +
    '<div style="height:3px;margin-top:18px;border-radius:3px;background-color:#a31d20;background-image:linear-gradient(90deg,#781517,#d02527,#781517);"></div>' +
    '</td></tr>' +

    '</table>' +
    '<div style="font:400 11px/1.6 ' + font + ';color:#8C8079;padding:16px 20px 0;max-width:560px;">This email was sent by the ' + h_(COMPANY_NAME) + ' careers portal. ' +
    'Please do not share interview links or passwords from this email with anyone else.</div>' +
    '</td></tr></table></body></html>';

  // plain-text twin
  const lines = [];
  if (c.title) lines.push(c.title.toUpperCase(), '');
  if (c.greeting) lines.push(c.greeting, '');
  (c.paragraphs || []).forEach(function (p) { lines.push(p, ''); });
  if (c.details && c.details.length) {
    if (c.detailsTitle) lines.push(c.detailsTitle);
    c.details.forEach(function (kv) { lines.push(kv[0] + ': ' + (kv[2] ? String(kv[3] || '').trim() : kv[1])); });
    lines.push('');
  }
  if (c.note) lines.push((c.noteTitle ? c.noteTitle + ':\n' : '') + c.note, '');
  if (c.button && c.button.url) lines.push(c.button.label + ': ' + c.button.url);
  if (c.secondary && c.secondary.url) lines.push(c.secondary.label + ': ' + c.secondary.url);
  if ((c.button && c.button.url) || (c.secondary && c.secondary.url)) lines.push('');
  if (c.steps && c.steps.items) {
    lines.push(c.steps.title || 'What happens next');
    c.steps.items.forEach(function (s, i) { lines.push((i + 1) + '. ' + s); });
    lines.push('');
  }
  if (c.closing) lines.push(c.closing, '');
  lines.push('Warm regards,', c.signoff || (COMPANY_NAME + ' Hiring Team'), LEGAL_NAME, '',
    COMPANY_ADDRESS, COMPANY_PHONE + ' | ' + COMPANY_SUPPORT_EMAIL);

  return { html: html, text: lines.join('\n') };
}

function sendBrandedEmail_(to, subject, content, replyTo) {
  const built = buildEmail_(content);
  const opts = { htmlBody: built.html, name: MAIL_SENDER_NAME };
  if (replyTo && isValidEmail_(replyTo)) opts.replyTo = replyTo;
  MailApp.sendEmail(to, subject, built.text, opts);
}

// ---------- To the hiring manager ----------

function sendEmployerNotification_(a) {
  try {
    const to = a.employerEmail || FALLBACK_EMPLOYER_EMAIL;
    sendBrandedEmail_(to, 'New application: ' + a.jobTitle + ' — ' + a.fullName, {
      preheader: a.fullName + ' applied for ' + a.jobTitle + '.',
      tag: 'New application',
      title: a.fullName + ' applied for ' + a.jobTitle,
      tone: 'neutral',
      greeting: 'Hello,',
      paragraphs: ['A new application has come in through the ' + COMPANY_NAME + ' careers portal. The candidate\'s details are below.'],
      detailsTitle: 'Candidate',
      details: [
        ['Name', a.fullName],
        ['Role', a.jobTitle + (a.department ? ' · ' + a.department : '')],
        ['Email', '<a href="mailto:' + h_(a.email) + '" style="color:#781517;">' + h_(a.email) + '</a>', true, a.email],
        ['Phone', a.phone],
        ['Date of birth', a.dob || '—'],
        ['Qualification', a.qualification || '—'],
        ['Experience', a.experience || '—'],
        ['Reference', a.id]
      ],
      note: a.coverNote,
      noteTitle: 'Note from the candidate',
      button: a.resumeUrl ? { label: 'Open resume', url: a.resumeUrl } : null,
      secondary: { label: 'Open hiring dashboard', url: DASHBOARD_URL },
      closing: 'Review the application and schedule the first round from the Applications tab.',
      signoff: COMPANY_NAME + ' Careers Portal'
    });
  } catch (err) {
    Logger.log('Employer notification failed: ' + err.toString());
  }
}

// ---------- To the candidate ----------

function sendApplicantConfirmation_(a) {
  try {
    sendBrandedEmail_(a.email, 'Application received — ' + a.jobTitle + ' at ' + COMPANY_NAME, {
      preheader: 'Thank you for applying. Here is what happens next.',
      tag: 'Application received',
      title: 'Thank you for applying, ' + firstName_(a.fullName) + '!',
      greeting: 'Dear ' + a.fullName + ',',
      paragraphs: [
        'Thank you for your interest in joining ' + COMPANY_NAME + '. We have received your application for the role below, and our hiring team will review it carefully.'
      ],
      detailsTitle: 'Your application',
      details: [
        ['Role', a.jobTitle],
        ['Team', a.department || '—'],
        ['Location', a.location || '—'],
        ['Reference', a.id],
        ['Received on', Utilities.formatDate(new Date(), MAIL_TIMEZONE, 'd MMMM yyyy')]
      ],
      steps: {
        title: 'What happens next',
        items: [
          'Our hiring team reviews your profile against what the role needs.',
          'If you are a good match, we email you an interview invitation with the date, time and venue.',
          'After each interview round, we write to you with the outcome.'
        ]
      },
      secondary: { label: 'See other open roles', url: CAREERS_URL },
      closing: 'You do not need to do anything else for now. Please keep your reference number handy if you write to us about this application.'
    }, a.replyTo);
  } catch (err) {
    Logger.log('Applicant confirmation failed: ' + err.toString());
  }
}

function sendInterviewInvitation_(d) {
  try {
    if (!d.applicantEmail) return false;
    const online = d.mode === 'Online';
    const isLink = /^https?:\/\//i.test(d.location || '');
    const whereLabel = online ? 'Meeting link' : (d.mode === 'Phone' ? 'Phone' : 'Venue');
    const whereValue = d.location
      ? (isLink ? '<a href="' + h_(d.location) + '" style="color:#781517;word-break:break-all;">' + h_(d.location) + '</a>' : nl2br_(d.location))
      : (d.mode === 'Phone' ? 'We will call you on the number you gave us.' : 'We will confirm this shortly.');

    const calendar = calendarLink_(d);
    const subject = (d.isReschedule ? 'Updated: ' : '') + roundLabel_(d.round) + ' interview — ' + d.jobTitle + ' at ' + COMPANY_NAME;

    sendBrandedEmail_(d.applicantEmail, subject, {
      preheader: prettyDate_(d.date) + ' at ' + prettyTime_(d.time) + ' — ' + d.mode,
      tag: d.isReschedule ? 'Interview rescheduled · Round ' + d.round : 'Interview invitation · Round ' + d.round,
      title: d.isReschedule
        ? 'Your interview has a new time'
        : (d.round > 1 ? 'You are invited to round ' + d.round : 'You are invited to interview'),
      greeting: 'Dear ' + d.applicantName + ',',
      paragraphs: [
        d.isReschedule
          ? 'Your ' + roundLabel_(d.round).toLowerCase() + ' interview for the ' + d.jobTitle + ' role at ' + COMPANY_NAME + ' has moved. The updated details are below — please use these and disregard the earlier time.'
          : (d.round > 1
            ? 'Congratulations on clearing the previous round. We would like to invite you to the ' + roundLabel_(d.round).toLowerCase() + ' interview for the ' + d.jobTitle + ' role at ' + COMPANY_NAME + '.'
            : 'Thank you for applying for the ' + d.jobTitle + ' role at ' + COMPANY_NAME + '. We were impressed by your profile and would like to invite you to an interview.')
      ],
      detailsTitle: 'Interview details',
      details: [
        ['Role', d.jobTitle],
        ['Round', 'Round ' + d.round],
        ['Date', prettyDate_(d.date)],
        ['Time', prettyTime_(d.time)],
        ['Mode', d.mode === 'In-Person' ? 'In person' : d.mode],
        [whereLabel, whereValue, true, d.location || '']
      ],
      note: d.notes,
      noteTitle: 'A note from our hiring team',
      button: online && isLink ? { label: 'Join the meeting', url: d.location } : (calendar ? { label: 'Add to calendar', url: calendar } : null),
      secondary: online && isLink && calendar ? { label: 'Add to calendar', url: calendar } : null,
      steps: {
        title: 'Before the interview',
        items: online
          ? ['Join 5 minutes early from a quiet place with a steady internet connection.', 'Keep a copy of your resume and a valid photo ID within reach.', 'Test your camera and microphone beforehand.']
          : (d.mode === 'Phone'
            ? ['Keep your phone charged and be somewhere quiet at the scheduled time.', 'Keep a copy of your resume in front of you.']
            : ['Please arrive 10–15 minutes early and report at the reception.', 'Bring a printed copy of your resume and a valid photo ID.', 'Carry copies of your educational and experience certificates.'])
      },
      closing: 'If this time does not work for you, simply reply to this email and we will find another slot. We look forward to speaking with you.'
    }, d.replyTo);
    return true;
  } catch (err) {
    Logger.log('Interview email failed: ' + err.toString());
    return false;
  }
}

/**
 * Shortlisted / Rejected / Hired email. `message` is the optional personal
 * note HR typed in the dashboard; it appears in a highlighted box.
 */
function sendDecisionEmail_(app, decision, round, message) {
  try {
    const email = app.get('Email');
    if (!email) return false;
    const name = app.get('FullName');
    const job = app.get('JobTitle');
    const replyTo = getJobReplyTo_(app.get('JobID'));

    if (decision === 'Shortlisted') {
      sendBrandedEmail_(email, 'Good news — you have been shortlisted for ' + job, {
        preheader: 'You have cleared round ' + round + '. Here is what happens next.',
        tag: 'Shortlisted · Round ' + round + ' cleared',
        title: 'Congratulations, you are shortlisted!',
        tone: 'success',
        greeting: 'Dear ' + name + ',',
        paragraphs: [
          'Thank you for taking the time to interview with us for the ' + job + ' role. We are pleased to let you know that you have cleared round ' + round + ' and have been shortlisted for the next stage of our selection process.'
        ],
        detailsTitle: 'Your progress',
        details: [['Role', job], ['Completed', 'Round ' + round], ['Status', 'Shortlisted']],
        note: message, noteTitle: 'A note from our hiring team',
        steps: { title: 'What happens next', items: [
          'Our hiring team will email you the details of the next round shortly.',
          'Keep an eye on your inbox (and spam folder) for the invitation.'
        ] },
        closing: 'Well done so far — we look forward to meeting you again.'
      }, replyTo);
    } else if (decision === 'Hired') {
      sendBrandedEmail_(email, 'Welcome to ' + COMPANY_NAME + ' — ' + job, {
        preheader: 'Congratulations! We are delighted to offer you the role.',
        tag: 'Selected',
        title: 'Welcome to the ' + COMPANY_NAME + ' family!',
        tone: 'success',
        greeting: 'Dear ' + name + ',',
        paragraphs: [
          'Congratulations! After careful consideration, we are delighted to let you know that you have been selected for the ' + job + ' role at ' + COMPANY_NAME + '.',
          'Your skills and the way you came across through our interview process stood out, and we are excited to have you join a team that Tamil Nadu has trusted since 1916.'
        ],
        detailsTitle: 'Your selection',
        details: [['Role', job], ['Status', 'Selected'], ['Selected on', Utilities.formatDate(new Date(), MAIL_TIMEZONE, 'd MMMM yyyy')]],
        note: message, noteTitle: 'A note from our hiring team',
        steps: { title: 'Next steps', items: [
          'Our HR team will share your offer letter with the joining date and compensation details.',
          'Please keep your educational, experience and ID documents ready for verification.',
          'Reply to this email if you have any questions in the meantime.'
        ] },
        closing: 'Once again, congratulations — we look forward to working with you.'
      }, replyTo);
    } else {
      const after = String(app.get('RejectedAt') || '');
      const wasInterviewed = after.indexOf('Round') > -1 || after.indexOf('After') > -1;
      sendBrandedEmail_(email, 'Update on your application — ' + job + ' at ' + COMPANY_NAME, {
        preheader: 'An update on your application with ' + COMPANY_NAME + '.',
        tag: 'Application update',
        title: 'An update on your application',
        tone: 'neutral',
        greeting: 'Dear ' + name + ',',
        paragraphs: [
          wasInterviewed
            ? 'Thank you for the time and effort you put into interviewing with us for the ' + job + ' role. We genuinely enjoyed learning more about you.'
            : 'Thank you for your interest in the ' + job + ' role at ' + COMPANY_NAME + ' and for taking the time to apply.',
          'After careful consideration, we have decided to move forward with other candidates whose experience more closely matches the needs of this role at this time. This was not an easy decision.',
          'We will keep your profile on file, and we encourage you to apply for future openings that match your skills.'
        ],
        note: message, noteTitle: 'A note from our hiring team',
        button: { label: 'View current openings', url: CAREERS_URL },
        closing: 'We wish you every success in your career ahead.'
      }, replyTo);
    }
    return true;
  } catch (err) {
    Logger.log('Decision email failed: ' + err.toString());
    return false;
  }
}

function firstName_(full) {
  return String(full || '').trim().split(/\s+/)[0] || 'there';
}


// ============================================================================
// 8. AUTH — Admins sheet
// Columns: Username | Password | FullName | Email | Role | CreatedDate | MustChangePassword
//
// Only two roles exist: 'admin' and 'hr'. Candidates have no accounts at all.
// Passwords are stored as plain text in the sheet.
//
// A login returns a session token held in CacheService, so every later request
// authenticates from cache instead of re-reading the Admins sheet twice.
// ============================================================================

const ADMIN_HEADERS = [
  'Username', 'Password', 'FullName', 'Email', 'Role', 'CreatedDate', 'MustChangePassword'
];

function getAdminsSheet() {
  const sheet = getOrCreateSheet_(ADMINS_SHEET_NAME, ADMIN_HEADERS);
  return ensureHeaders_(sheet, ADMIN_HEADERS, 'schema_admins_v2');
}

function hashPassword_(plain, salt) {
  // Passwords are kept as plain text, so this just returns the value as-is
  // (the salt argument is ignored). Left in place so every existing call
  // site below still works unchanged.
  return String(plain);
}

function verifyPassword_(stored, plain) {
  return String(stored || '') === String(plain).trim();
}

// One read of the Admins sheet gives credentials, role and reset flag together.
function getAdminRecord_(username) {
  const sheet = getAdminsSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  const headers = data[0];
  const col = {};
  headers.forEach(function (h, i) { col[h] = i; });

  const uname = normalizeUsername_(username);
  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][col['Username']]) !== uname) continue;
    const role = String(data[i][col['Role']] || '').trim().toLowerCase();
    return {
      row: i + 1,
      username: String(data[i][col['Username']]).trim(),
      password: data[i][col['Password']],
      fullName: data[i][col['FullName']],
      email: String(data[i][col['Email']] || '').trim(),
      role: role === 'superadmin' ? 'admin' : role,
      mustChange: String(data[i][col['MustChangePassword']] || '').toUpperCase() === 'TRUE',
      col: col
    };
  }
  return null;
}

function findAdminAccount_() {
  const sheet = getAdminsSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0];
  const col = {};
  headers.forEach(function (h, i) { col[h] = i; });

  for (let i = 1; i < data.length; i++) {
    const role = String(data[i][col['Role']] || '').trim().toLowerCase();
    if (role === 'admin' || role === 'superadmin') {
      return {
        username: String(data[i][col['Username']]).trim(),
        fullName: data[i][col['FullName']],
        email: String(data[i][col['Email']] || '').trim()
      };
    }
  }
  return null;
}

// ---------- Sessions ----------

function createSession_(record) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify({
    username: record.username,
    role: record.role,
    fullName: record.fullName,
    mustChange: !!record.mustChange
  }), SESSION_TTL_SECONDS);
  return token;
}

function readSession_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('sess_' + token);
  return raw ? JSON.parse(raw) : null;
}

function updateSession_(token, changes) {
  const session = readSession_(token);
  if (!session) return;
  Object.keys(changes).forEach(function (k) { session[k] = changes[k]; });
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(session), SESSION_TTL_SECONDS);
}

const SESSION_EXPIRED = {
  status: 'error',
  code: 'SESSION_EXPIRED',
  message: 'Your session has ended. Please sign in again.'
};

// Every HR/Admin action starts here. Returns the session, or an { error }
// object the caller returns straight to the client.
function requireRole_(token, role) {
  const session = readSession_(token);
  if (!session) return { error: SESSION_EXPIRED };
  if (session.mustChange) {
    return { error: { status: 'error', code: 'MUST_CHANGE_PASSWORD', message: 'Set a new password before continuing.' } };
  }
  if (session.role !== role) {
    return { error: { status: 'error', message: 'Your account does not have access to this.' } };
  }
  return session;
}

// ---------- Login ----------

/**
 * PUBLIC — HR and Admin sign in here. The role comes from the account itself,
 * so nobody has to pick it, and a wrong username and a wrong password are
 * reported separately so the person knows which one to fix.
 */
function login(username, password) {
  if (!escapeText_(username) || !escapeText_(password)) {
    return { status: 'error', message: 'Enter your username and password.' };
  }

  const sheet = getAdminsSheet();
  if (sheet.getLastRow() < 2) {
    return {
      status: 'error',
      message: 'No accounts exist yet. In the Apps Script editor, run createInitialAdmin once, then sign in.'
    };
  }

  const record = getAdminRecord_(username);
  if (!record) {
    return { status: 'error', code: 'NO_SUCH_USER', message: 'No account found with that username.' };
  }
  if (!verifyPassword_(record.password, password)) {
    return { status: 'error', code: 'WRONG_PASSWORD', message: 'Wrong password. Check it and try again, or use "Forgot password".' };
  }

  const token = createSession_(record);
  return {
    status: 'success',
    token: token,
    role: record.role,
    fullName: record.fullName || record.username,
    username: record.username,
    mustChangePassword: record.mustChange
  };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return { status: 'success' };
}

// ---------- Forgot password ----------

function generateTempPassword_() {
  // Avoids look-alike characters so the password is easy to retype from email.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out + '#7';
}

function maskEmail_(email) {
  const parts = String(email || '').split('@');
  if (parts.length !== 2) return 'your registered address';
  const name = parts[0];
  const shown = name.length <= 2 ? name.charAt(0) : name.substring(0, 2);
  return shown + '•••@' + parts[1];
}

/**
 * PUBLIC — "Forgot password" on the sign-in screen.
 *
 *   HR account    → the administrator is emailed that this person needs a
 *                   reset. The admin sets a new password from the dashboard.
 *   Admin account → a temporary password is generated, emailed to the admin's
 *                   registered address, and the account is flagged so the next
 *                   sign-in must set a new password before anything else works.
 */
function forgotPassword(username) {
  if (!escapeText_(username)) return { status: 'error', message: 'Enter your username first.' };

  const record = getAdminRecord_(username);
  if (!record) return { status: 'error', message: 'No account found with that username.' };

  const sheet = getAdminsSheet();

  if (record.role === 'admin') {
    const target = record.email || Session.getEffectiveUser().getEmail();
    if (!target) {
      return { status: 'error', message: 'This admin account has no email address on file. Add one in the Admins sheet first.' };
    }

    const tempPassword = generateTempPassword_();
    sheet.getRange(record.row, record.col['Password'] + 1)
      .setValue(hashPassword_(tempPassword, Utilities.getUuid()));
    sheet.getRange(record.row, record.col['MustChangePassword'] + 1).setValue('TRUE');

    try {
      sendBrandedEmail_(target, 'Temporary password for the ' + COMPANY_NAME + ' careers portal', {
        preheader: 'Use this temporary password to sign in, then set your own.',
        tag: 'Account security', title: 'Your temporary password', tone: 'neutral',
        greeting: 'Hello ' + (record.fullName || record.username) + ',',
        paragraphs: ['A password reset was requested for the admin account "' + record.username + '". Use the temporary password below to sign in.'],
        details: [['Username', record.username], ['Temporary password', '<span style="font-family:Consolas,Menlo,monospace;font-size:16px;letter-spacing:.06em;color:#781517;">' + h_(tempPassword) + '</span>', true, tempPassword]],
        button: { label: 'Sign in to the dashboard', url: DASHBOARD_URL },
        note: 'You will be asked to set a new password straight away, and nothing else in the dashboard opens until you do. If you did not request this, sign in and change the password immediately.',
        noteTitle: 'Important',
        signoff: COMPANY_NAME + ' Careers Portal'
      });
    } catch (err) {
      Logger.log('Temp password email failed: ' + err.toString());
      return { status: 'error', message: 'Could not send the email. Check the address on the admin account and try again.' };
    }

    return {
      status: 'success',
      message: 'A temporary password has been sent to ' + maskEmail_(target) + '. Sign in with it and you will be asked to set a new one.'
    };
  }

  // HR account — tell the administrator.
  const admin = findAdminAccount_();
  const adminEmail = (admin && admin.email) || Session.getEffectiveUser().getEmail();
  if (!adminEmail) {
    return { status: 'error', message: 'No administrator email is on file. Ask your administrator to reset the password directly.' };
  }

  try {
    sendBrandedEmail_(adminEmail, 'Password reset requested — ' + record.username, {
      preheader: record.username + ' needs a new password for the careers portal.',
      tag: 'Account security', title: 'An HR user needs a password reset', tone: 'neutral',
      greeting: 'Hello' + (admin && admin.fullName ? ' ' + admin.fullName : '') + ',',
      paragraphs: ['An HR user has asked for a password reset on the ' + COMPANY_NAME + ' careers portal.'],
      details: [['Username', record.username], ['Name', record.fullName || '—'], ['Email', record.email || '—'],
        ['Requested', Utilities.formatDate(new Date(), MAIL_TIMEZONE, 'd MMM yyyy, h:mm a')]],
      button: { label: 'Open the dashboard', url: DASHBOARD_URL },
      closing: 'Sign in, open HR accounts, and use "Reset password" on that account. The new password is emailed to them automatically.',
      signoff: COMPANY_NAME + ' Careers Portal'
    });
  } catch (err) {
    Logger.log('HR reset notification failed: ' + err.toString());
    return { status: 'error', message: 'Could not reach the administrator by email. Contact them directly.' };
  }

  return {
    status: 'success',
    message: 'Your administrator has been notified and will send you a new password.'
  };
}

// Signed-in user sets their own password. This is also the only action allowed
// while an account is flagged MustChangePassword, which is what forces a reset
// after signing in with a temporary password.
function changePassword(token, newPassword) {
  const session = readSession_(token);
  if (!session) return SESSION_EXPIRED;

  const password = String(newPassword || '').trim();
  if (password.length < 8) {
    return { status: 'error', message: 'Use at least 8 characters.' };
  }

  const record = getAdminRecord_(session.username);
  if (!record) return { status: 'error', message: 'Account not found.' };
  if (verifyPassword_(record.password, password)) {
    return { status: 'error', message: 'That is your current password. Choose a different one.' };
  }

  const sheet = getAdminsSheet();
  sheet.getRange(record.row, record.col['Password'] + 1)
    .setValue(hashPassword_(password, Utilities.getUuid()));
  sheet.getRange(record.row, record.col['MustChangePassword'] + 1).setValue('');

  updateSession_(token, { mustChange: false });
  return { status: 'success', message: 'Password updated.' };
}


// ============================================================================
// 9. ADMIN — HR account management and read-only applicant view
// ============================================================================

// HR — everything the dashboard needs in a single round trip. This replaces
// the four separate calls the old dashboard made on every sign-in.
function getDashboard(token) {
  const session = requireRole_(token, 'hr');
  if (session.error) return session.error;

  const jobs = getAllJobs_();
  const applications = getAllApplications_();
  const interviews = getInterviewRounds_(applications);
  const count = function (fn) { return applications.filter(fn).length; };

  return {
    status: 'success',
    jobs: jobs,
    applications: applications,
    interviews: interviews,
    stats: {
      activeJobs: jobs.filter(function (j) { return String(j.Status).toLowerCase() === 'active'; }).length,
      totalApplications: applications.length,
      interviews: count(function (a) { return a.Status === 'Interview Scheduled'; }),
      shortlisted: count(function (a) { return a.Shortlisted; }),
      hired: count(function (a) { return a.Status === 'Hired'; }),
      rejected: count(function (a) { return a.Status === 'Rejected'; })
    }
  };
}

function getJobPosterMap_() {
  const jobs = getAllJobs_();
  const map = {};
  jobs.forEach(function (j) { map[j.ID] = String(j.PostedBy || '').trim().toLowerCase(); });
  return map;
}

function getJobDepartmentMap_() {
  const jobs = getAllJobs_();
  const map = {};
  jobs.forEach(function (j) { map[j.ID] = String(j.Department || '').trim(); });
  return map;
}

// ADMIN — HR accounts with a rollup of what each one is running. Passwords are
// never sent to the client.
function getHrAccounts(token) {
  const session = requireRole_(token, 'admin');
  if (session.error) return session.error;

  const jobPosterById = getJobPosterMap_();
  const jobCountByHr = {};
  Object.keys(jobPosterById).forEach(function (jobId) {
    const poster = jobPosterById[jobId];
    if (poster) jobCountByHr[poster] = (jobCountByHr[poster] || 0) + 1;
  });

  const appStatsByHr = {};
  getAllApplications_().forEach(function (a) {
    const poster = jobPosterById[a.JobID];
    if (!poster) return;
    if (!appStatsByHr[poster]) appStatsByHr[poster] = { total: 0, hired: 0 };
    appStatsByHr[poster].total++;
    if (a.Status === 'Hired') appStatsByHr[poster].hired++;
  });

  const sheet = getAdminsSheet();
  const data = sheet.getDataRange().getValues();
  const col = {};
  data[0].forEach(function (h, i) { col[h] = i; });

  const accounts = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col['Role']] || '').trim().toLowerCase() !== 'hr') continue;
    const uname = normalizeUsername_(data[i][col['Username']]);
    const stats = appStatsByHr[uname] || { total: 0, hired: 0 };
    const created = data[i][col['CreatedDate']];
    accounts.push({
      username: data[i][col['Username']],
      fullName: data[i][col['FullName']],
      email: data[i][col['Email']],
      jobCount: jobCountByHr[uname] || 0,
      applicationCount: stats.total,
      hiredCount: stats.hired,
      createdDate: created instanceof Date ? created.toLocaleDateString() : created,
      needsReset: String(data[i][col['MustChangePassword']] || '').toUpperCase() === 'TRUE'
    });
  }
  return { status: 'success', accounts: accounts };
}

// ADMIN — create an HR account. Always role 'hr'; this app never creates a
// second admin.
function addHr(token, newHr) {
  const session = requireRole_(token, 'admin');
  if (session.error) return session.error;
  if (!newHr || !escapeText_(newHr.username) || !escapeText_(newHr.password)) {
    return { status: 'error', message: 'Username and password are required.' };
  }
  if (String(newHr.password).trim().length < 8) {
    return { status: 'error', message: 'The password must be at least 8 characters.' };
  }

  const sheet = getAdminsSheet();
  const data = sheet.getDataRange().getValues();
  const newUname = normalizeUsername_(newHr.username);
  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][0]) === newUname) {
      return { status: 'error', message: 'That username is already taken.' };
    }
  }

  appendRowByHeaders_(sheet, {
    Username: escapeText_(newHr.username),
    Password: hashPassword_(String(newHr.password).trim(), Utilities.getUuid()),
    FullName: escapeText_(newHr.fullName),
    Email: escapeText_(newHr.email),
    Role: 'hr',
    CreatedDate: new Date(),
    MustChangePassword: ''
  });
  return { status: 'success' };
}

// ADMIN — set a new password on an HR account. This is how an admin answers
// the "HR forgot their password" email.
function resetHrPassword(token, hrUsername, newPassword) {
  const session = requireRole_(token, 'admin');
  if (session.error) return session.error;

  const password = String(newPassword || '').trim();
  if (password.length < 8) return { status: 'error', message: 'Use at least 8 characters.' };

  const record = getAdminRecord_(hrUsername);
  if (!record || record.role !== 'hr') return { status: 'error', message: 'HR account not found.' };

  const sheet = getAdminsSheet();
  sheet.getRange(record.row, record.col['Password'] + 1)
    .setValue(hashPassword_(password, Utilities.getUuid()));

  if (record.email) {
    try {
      sendBrandedEmail_(record.email, 'Your ' + COMPANY_NAME + ' careers portal password has been reset', {
        preheader: 'Your administrator has set a new password for you.',
        tag: 'Account security', title: 'Your password has been reset', tone: 'neutral',
        greeting: 'Hello ' + (record.fullName || record.username) + ',',
        paragraphs: ['Your administrator has set a new password for your careers portal account.'],
        details: [['Username', record.username], ['New password', '<span style="font-family:Consolas,Menlo,monospace;font-size:16px;letter-spacing:.06em;color:#781517;">' + h_(password) + '</span>', true, password]],
        button: { label: 'Sign in to the dashboard', url: DASHBOARD_URL },
        closing: 'After signing in, change it from the "Change password" button in the dashboard.',
        signoff: COMPANY_NAME + ' Careers Portal'
      });
    } catch (err) {
      Logger.log('HR reset email failed: ' + err.toString());
      return { status: 'success', message: 'Password reset, but the email could not be sent. Share it with them directly.' };
    }
  }

  return { status: 'success', message: 'Password reset and emailed to the HR user.' };
}

// ADMIN — remove an HR account. Only ever deletes rows whose role is 'hr', so
// the admin account itself can never be removed this way.
function removeHr(token, hrUsername) {
  const session = requireRole_(token, 'admin');
  if (session.error) return session.error;

  const sheet = getAdminsSheet();
  const data = sheet.getDataRange().getValues();
  const targetUname = normalizeUsername_(hrUsername);
  for (let i = 1; i < data.length; i++) {
    if (normalizeUsername_(data[i][0]) === targetUname &&
        String(data[i][4] || '').trim().toLowerCase() === 'hr') {
      sheet.deleteRow(i + 1);
      return { status: 'success' };
    }
  }
  return { status: 'error', message: 'HR account not found.' };
}

// ADMIN — read-only view of every applicant, tagged with the job's department.
// Admin can see who applied but cannot act on applications; that stays with HR.
function getApplicantsOverview(token) {
  const session = requireRole_(token, 'admin');
  if (session.error) return session.error;

  const jobDeptById = getJobDepartmentMap_();
  const applicants = getAllApplications_().map(function (a) {
    a.Department = jobDeptById[a.JobID] || '';
    return a;
  });
  return { status: 'success', applicants: applicants };
}


// ============================================================================
// 10. ONE-TIME SETUP — run these from the Apps Script editor's function
//     dropdown (pick the name, press Run). Each is safe to run twice.
// ============================================================================

/**
 * Adds a "Careers Portal" menu to the Google Sheet (appears a few seconds after
 * the sheet opens). Every setup task below can be run from there — no need to
 * open the Apps Script editor.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Careers Portal')
    .addItem('Set up sheets', 'setupSheets')
    .addItem('Create admin account', 'createInitialAdmin')
    .addItem('Add sample jobs', 'seedSampleJobs')
    .addSeparator()
    .addItem('Reset admin password', 'resetAdminPasswordNow')
    .addItem('Rebuild stage sheets', 'rebuildStageSheets')
    .addItem('Check status', 'checkSetup')
    .addToUi();
}

/**
 * SET UP SHEETS — creates every tab the portal needs (Jobs, Applications,
 * Admins, Interviews) with the right column headers, formats them, adds
 * drop-downs for Status / Role / Visibility, and creates the Drive folder for
 * resumes. Safe to run any time: existing rows are never touched, and missing
 * columns are added at the end.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cache = CacheService.getScriptCache();
  const specs = [
    { name: JOBS_SHEET_NAME, headers: JOB_HEADERS, key: 'schema_jobs_v2', color: '#781517',
      lists: { Status: ['Active', 'Closed'] }, text: ['Deadline'],
      widths: { Title: 220, Description: 360, Requirements: 360, EmployerEmail: 200 } },
    { name: APPLICATIONS_SHEET_NAME, headers: APPLICATION_HEADERS, key: 'schema_apps_v3', color: '#17362C',
      lists: { Status: APPLICATION_STATUSES, Shortlisted: ['TRUE', ''] }, text: ['InterviewDate', 'InterviewTime', 'DOB'],
      widths: { FullName: 180, Email: 220, CoverNote: 320, ResumeLink: 260, JobTitle: 200 } },
    { name: ADMINS_SHEET_NAME, headers: ADMIN_HEADERS, key: 'schema_admins_v2', color: '#17130F',
      lists: { Role: ['admin', 'hr'], MustChangePassword: ['TRUE', ''] }, text: ['Password'],
      widths: { FullName: 180, Email: 220 } },
    { name: INTERVIEWS_SHEET_NAME, headers: INTERVIEW_HEADERS, key: 'schema_interviews_v3', color: '#B07D22',
      lists: { Mode: ['Online', 'In-Person', 'Phone'], Outcome: INTERVIEW_OUTCOMES }, text: ['InterviewDate', 'InterviewTime'],
      widths: { ApplicantName: 180, ApplicantEmail: 220, Notes: 320, JobTitle: 200 } }
  ].concat(STAGE_SHEETS.map(function (st) {
    return { name: st.name, headers: st.headers, key: st.key, color: st.color, lists: {}, text: [],
      widths: { Candidate: 180, Email: 220, Role: 200, CurrentStatus: 240, Notes: 300, Resume: 240 } };
  }));

  const report = [];
  specs.forEach(function (spec) {
    const existed = !!ss.getSheetByName(spec.name);
    cache.remove(spec.key);                                   // force a fresh header check
    const sheet = ensureHeaders_(getOrCreateSheet_(spec.name, spec.headers), spec.headers, spec.key);
    const map = getHeaderMap_(sheet);
    const lastCol = sheet.getLastColumn();
    const maxRows = Math.max(sheet.getMaxRows() - 1, 1);

    // header row: bold, coloured, frozen
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, lastCol)
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground(spec.color)
      .setVerticalAlignment('middle').setWrap(true);
    sheet.setRowHeight(1, 32);

    // column widths
    Object.keys(spec.widths).forEach(function (h) { if (map[h]) sheet.setColumnWidth(map[h], spec.widths[h]); });

    // drop-downs
    Object.keys(spec.lists).forEach(function (h) {
      if (!map[h]) return;
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(spec.lists[h], true).setAllowInvalid(true).build();
      sheet.getRange(2, map[h], maxRows, 1).setDataValidation(rule);
    });

    // keep dates/times typed by the site as plain text (stops the "1899" problem)
    spec.text.forEach(function (h) { if (map[h]) sheet.getRange(2, map[h], maxRows, 1).setNumberFormat('@'); });

    report.push((existed ? '✔ ' : '＋ ') + spec.name + (existed ? ' — checked' : ' — created') +
      ' (' + Math.max(sheet.getLastRow() - 1, 0) + ' rows)');
  });

  // tidy: remove the empty default "Sheet1" if the portal tabs now exist
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  // Drive folder for uploaded resumes
  getOrCreateDriveFolder_(RESUME_FOLDER_NAME);
  report.push('✔ Drive folder "' + RESUME_FOLDER_NAME + '" ready');

  clearJobsCache_();
  rebuildStageSheets(true);
  report.push('✔ Shortlisted / Hired / Rejected filled from Applications');

  const hasAdmin = !!findAdminAccount_();
  const msg = report.join('\n') + '\n\n' + (hasAdmin
    ? 'An admin account already exists.'
    : 'No admin account yet — use Careers Portal → Create admin account next.');
  notify_('Sheets are set up', msg);
}

/** CHECK STATUS — quick health check of the sheet, admin account and resume folder. */
function checkSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lines = [JOBS_SHEET_NAME, APPLICATIONS_SHEET_NAME, ADMINS_SHEET_NAME, INTERVIEWS_SHEET_NAME,
    SHORTLISTED_SHEET_NAME, HIRED_SHEET_NAME, REJECTED_SHEET_NAME].map(function (n) {
    const sh = ss.getSheetByName(n);
    return (sh ? '✔ ' : '✖ ') + n + (sh ? ' (' + Math.max(sh.getLastRow() - 1, 0) + ' rows)' : ' — missing, run Set up sheets');
  });
  let active = 0;
  try { active = getActiveJobs().length; } catch (e) {}
  lines.push('Open jobs on the careers page: ' + active);
  lines.push((findAdminAccount_() ? '✔ ' : '✖ ') + 'Admin account' + (findAdminAccount_() ? '' : ' — run Create admin account'));
  lines.push((DriveApp.getFoldersByName(RESUME_FOLDER_NAME).hasNext() ? '✔ ' : '✖ ') + 'Resume folder "' + RESUME_FOLDER_NAME + '"');
  notify_('Careers Portal status', lines.join('\n'));
}

// Shows a pop-up when run from the sheet's menu; falls back to the log when run from the editor.
function notify_(title, message) {
  try { SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(title + '\n' + message); }
}

/**
 * Run FIRST. Creates the single admin account.
 *
 * >>> Put a real address in ADMIN_EMAIL before running. That is where the
 *     temporary password goes if you ever use "Forgot password".
 */
function createInitialAdmin() {
  const ADMIN_USERNAME = 'admin';
  const ADMIN_PASSWORD = 'ChangeMe123!';
  const ADMIN_EMAIL = Session.getEffectiveUser().getEmail(); // replace with a real address

  const sheet = getAdminsSheet();
  if (sheet.getLastRow() > 1) {
    notify_('Admin already exists', 'Accounts already exist — nothing changed. If you are locked out, use Careers Portal → Reset admin password.');
    return;
  }
  appendRowByHeaders_(sheet, {
    Username: ADMIN_USERNAME,
    Password: hashPassword_(ADMIN_PASSWORD, Utilities.getUuid()),
    FullName: 'Administrator',
    Email: ADMIN_EMAIL,
    Role: 'admin',
    CreatedDate: new Date(),
    MustChangePassword: 'TRUE'
  });
  notify_('Admin account created', 'Username: ' + ADMIN_USERNAME + '\nPassword: ' + ADMIN_PASSWORD +
    '\n\nYou will be asked to set a new password on first sign-in.');
}

// Run this if you are locked out entirely. Forces the password back to a known
// value and requires a reset on the next sign-in.
function resetAdminPasswordNow() {
  const sheet = getAdminsSheet();
  const record = getAdminRecord_('admin');
  if (!record) {
    notify_('No admin account', 'No account named "admin" exists. Use Careers Portal → Create admin account first.');
    return;
  }
  sheet.getRange(record.row, record.col['Password'] + 1)
    .setValue(hashPassword_('ChangeMe123!', Utilities.getUuid()));
  sheet.getRange(record.row, record.col['MustChangePassword'] + 1).setValue('TRUE');
  notify_('Admin password reset', 'Password for "admin" is now ChangeMe123! — you will be asked to change it on sign-in.');
}

// Optional. Adds sample job listings so the careers page is not empty.
function seedSampleJobs() {
  const sheet = getJobsSheet();
  if (sheet.getLastRow() > 1) {
    notify_('Sample jobs skipped', 'The Jobs sheet already has rows — nothing added.');
    return;
  }

  const now = new Date();
  const sampleJobs = [
    {
      title: 'Production Supervisor', department: 'Operations', location: 'Virudhunagar, Tamil Nadu',
      type: 'Full-time', salary: 'Rs 5,00,000 - 8,00,000 / year',
      description: 'Run a bottling shift end to end: line readiness, output targets, hygiene standards and the handover to the next shift. You will work alongside the quality and maintenance teams to keep the line moving.',
      requirements: '- 3+ years on a food or beverage production floor\n- Comfortable leading a shift team of 15-30 people\n- Working knowledge of FSSAI hygiene requirements\n- Willing to rotate across morning and night shifts'
    },
    {
      title: 'Quality Analyst', department: 'Quality', location: 'Virudhunagar, Tamil Nadu',
      type: 'Full-time', salary: 'Rs 3,50,000 - 5,00,000 / year',
      description: 'Test incoming ingredients and finished batches against our specifications, log the results, and flag anything that drifts before it reaches the line.',
      requirements: '- B.Sc or M.Sc in Food Technology, Chemistry or Microbiology\n- 1-3 years in a QA or QC lab\n- Careful record keeping and comfort with lab instruments\n- Attention to detail under time pressure'
    },
    {
      title: 'Territory Sales Executive', department: 'Sales', location: 'Madurai, Tamil Nadu',
      type: 'Full-time', salary: 'Rs 3,00,000 - 5,00,000 / year',
      description: 'Own a distributor territory: visit retail outlets on a regular beat, keep stock moving, resolve supply issues and grow the number of outlets carrying our range.',
      requirements: '- 2+ years in FMCG field sales\n- Two-wheeler and a valid licence\n- Fluent in Tamil; working English\n- Willing to travel within the territory daily'
    },
    {
      title: 'HR Executive', department: 'Human Resources', location: 'Coimbatore, Tamil Nadu',
      type: 'Full-time', salary: 'Rs 3,50,000 - 5,00,000 / year',
      description: 'Handle recruitment end to end, run onboarding for new joiners, and keep employee records and engagement activities on track across plant and office staff.',
      requirements: '- Degree in HR, Business Administration or a related field\n- 1-3 years of recruitment or HR generalist experience\n- Strong written and spoken Tamil and English\n- Familiarity with an ATS or HRMS is a plus'
    },
    {
      title: 'Data Analyst Intern', department: 'Analytics', location: 'Remote',
      type: 'Internship', salary: 'Rs 15,000 / month stipend',
      description: 'A six-month internship supporting the analytics team: clean sales and production datasets, build dashboards, and answer ad-hoc questions from the commercial team.',
      requirements: '- Studying or recently finished a degree in Statistics, CS or a related field\n- Working knowledge of Excel and SQL\n- Python or R is a plus\n- Curious and careful with data'
    }
  ];

  sampleJobs.forEach(function (job, index) {
    appendRowByHeaders_(sheet, {
      ID: 'JOB-' + (now.getTime() + index),
      Title: job.title,
      Department: job.department,
      Location: job.location,
      Type: job.type,
      Salary: job.salary,
      Description: job.description,
      Requirements: job.requirements,
      EmployerEmail: FALLBACK_EMPLOYER_EMAIL,
      PostedDate: now,
      Deadline: '',
      Status: 'Active',
      PostedBy: ''
    });
  });

  clearJobsCache_();
  notify_('Sample jobs added', 'Added ' + sampleJobs.length + ' sample jobs. They show on the careers page right away.');
}