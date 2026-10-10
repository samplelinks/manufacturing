/* ==========================================================================
   admin.js — sign-in and dashboard (admin.html)

   Hiring flow: Applications → Interviews (round 1, 2, …, each with a result)
   → Shortlisted → Hired / Rejected. A candidate stays visible in every tab
   they have passed through; click any name for their full journey.

   Sign-in returns a session token that is sent with every later request, so
   the server checks a cached session instead of re-reading the Admins sheet
   on each call. The token lives in sessionStorage and dies with the tab.
   ========================================================================== */

const SESSION_KEY = 'kalimarkSession';

let session = null;       // { token, role, fullName, username }
let allJobsAdmin = [];
let allApps = [];

const APP_STATUSES = ['Received', 'Reviewed', 'Interview Scheduled', 'Shortlisted', 'Rejected', 'Hired'];
const STATUS_CLASS = {
  'Received': 'status-received',
  'Reviewed': 'status-reviewed',
  'Interview Scheduled': 'status-interview',
  'Shortlisted': 'status-shortlisted',
  'Rejected': 'status-rejected',
  'Hired': 'status-hired'
};

// ---------- Session storage ----------

function saveSession(s) {
  session = s;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (err) { /* private mode */ }
}

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (err) { return null; }
}

function dropSession() {
  session = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* nothing to clear */ }
}

/**
 * Every dashboard request goes through here so an expired session sends the
 * person back to the sign-in screen once, rather than failing silently in
 * five different places.
 */
async function call(action, payload) {
  const body = Object.assign({ token: session ? session.token : '' }, payload || {});
  const res = await apiPost(action, body);
  if (res.code === 'SESSION_EXPIRED') {
    dropSession();
    showLogin();
    showMsg('loginMsg', res.message, 'error');
    throw new Error(res.message);
  }
  if (res.code === 'MUST_CHANGE_PASSWORD') {
    openChangePassword(true);
    throw new Error(res.message);
  }
  return res;
}

// ---------- Sign in ----------

document.getElementById('loginBtn').addEventListener('click', signIn);
document.getElementById('forgotBtn').addEventListener('click', openForgot);
['loginUsername', 'loginPassword'].forEach(function (id) {
  document.getElementById(id).addEventListener('keydown', function (e) {
    if (e.key === 'Enter') signIn();
  });
});

async function signIn() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username || !password) {
    showMsg('loginMsg', 'Enter your username and password.', 'error');
    return;
  }

  const btn = document.getElementById('loginBtn');
  setBusy(btn, true, 'Signing in…');
  showMsg('loginMsg', '', '');

  try {
    const res = await apiPost('login', { username: username, password: password });

    if (res.status !== 'success') {
      // The server tells us which of the two was wrong, so the person knows
      // whether to fix the username or the password.
      showMsg('loginMsg', res.message, 'error');
      if (res.code === 'WRONG_PASSWORD') {
        const field = document.getElementById('loginPassword');
        field.value = '';
        field.focus();
      } else if (res.code === 'NO_SUCH_USER') {
        document.getElementById('loginUsername').focus();
      }
      return;
    }

    saveSession({
      token: res.token,
      role: res.role,
      fullName: res.fullName,
      username: res.username
    });
    document.getElementById('loginPassword').value = '';

    if (res.mustChangePassword) {
      showDashboardShell();
      openChangePassword(true);
      return;
    }
    startDashboard();
  } catch (err) {
    showMsg('loginMsg', err.message, 'error');
  } finally {
    setBusy(btn, false);
  }
}

function showLogin() {
  document.getElementById('loginPage').style.display = 'grid';
  document.getElementById('dashboard').style.display = 'none';
}

function showDashboardShell() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('adminName').textContent = session.fullName || session.username;
  document.getElementById('adminRoleTag').textContent = session.role === 'admin' ? 'Admin' : 'HR';
}

function setDashLoading(on) {
  document.getElementById('dashboard').classList.toggle('is-loading', !!on);
}
function setRefreshing(on) {
  document.getElementById('dashboard').classList.toggle('is-refreshing', !!on);
}

function startDashboard() {
  showDashboardShell();
  setDashLoading(true);
  applyRoleView(session.role);
}

// Shows only what the signed-in role can use, and opens its first tab.
function applyRoleView(role) {
  document.querySelectorAll('[data-role]').forEach(function (el) {
    el.style.display = el.getAttribute('data-role') === role ? '' : 'none';
  });
  const firstTab = document.querySelector('.tab-btn[data-role="' + role + '"]');
  if (firstTab) switchTab(firstTab.dataset.tab);
}

async function signOut() {
  const token = session ? session.token : '';
  dropSession();
  showLogin();
  document.getElementById('loginUsername').value = '';
  showMsg('loginMsg', '', '');
  try { await apiPost('logout', { token: token }); } catch (err) { /* already gone */ }
}

// ---------- Forgot password ----------

function openForgot() {
  document.getElementById('forgotUsername').value = document.getElementById('loginUsername').value.trim();
  showMsg('forgotMsg', '', '');
  document.getElementById('forgotModal').classList.add('open');
  document.getElementById('forgotUsername').focus();
}

function closeForgot() {
  document.getElementById('forgotModal').classList.remove('open');
}

document.getElementById('forgotModal').addEventListener('click', function (e) {
  if (e.target.id === 'forgotModal') closeForgot();
});
document.getElementById('forgotUsername').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') sendResetRequest();
});

async function sendResetRequest() {
  const username = document.getElementById('forgotUsername').value.trim();
  if (!username) {
    showMsg('forgotMsg', 'Enter your username.', 'error');
    return;
  }

  const btn = document.getElementById('forgotSubmitBtn');
  setBusy(btn, true, 'Sending…');

  try {
    const res = await apiPost('forgotPassword', { username: username });
    showMsg('forgotMsg', res.message, res.status === 'success' ? 'success' : 'error');
    if (res.status === 'success') {
      document.getElementById('loginUsername').value = username;
      setTimeout(function () {
        closeForgot();
        document.getElementById('loginPassword').focus();
      }, 4000);
    }
  } catch (err) {
    showMsg('forgotMsg', err.message, 'error');
  } finally {
    setBusy(btn, false);
  }
}

// ---------- Change password ----------

let passwordChangeForced = false;

// forced = true after signing in with a temporary password. The modal cannot
// be dismissed and nothing else in the dashboard will respond until a new
// password is set.
function openChangePassword(forced) {
  passwordChangeForced = !!forced;
  document.getElementById('changePasswordNew').value = '';
  document.getElementById('changePasswordConfirm').value = '';
  showMsg('changePasswordMsg', '', '');

  document.getElementById('changePasswordTitle').textContent =
    forced ? 'Set a new password' : 'Change password';
  document.getElementById('changePasswordSub').textContent = forced
    ? 'You signed in with a temporary password. Choose your own before you carry on.'
    : 'Set a new password for your account.';
  document.getElementById('changePasswordClose').style.display = forced ? 'none' : 'block';

  document.getElementById('changePasswordModal').classList.add('open');
  document.getElementById('changePasswordNew').focus();
}

function closeChangePassword() {
  if (passwordChangeForced) return;
  document.getElementById('changePasswordModal').classList.remove('open');
}

document.getElementById('changePasswordModal').addEventListener('click', function (e) {
  if (e.target.id === 'changePasswordModal') closeChangePassword();
});

async function saveNewPassword() {
  const newPassword = document.getElementById('changePasswordNew').value;
  const confirmPassword = document.getElementById('changePasswordConfirm').value;

  if (newPassword.length < 8) {
    showMsg('changePasswordMsg', 'Use at least 8 characters.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showMsg('changePasswordMsg', 'The two passwords do not match.', 'error');
    return;
  }

  try {
    const res = await apiPost('changePassword', { token: session.token, newPassword: newPassword });
    if (res.status !== 'success') {
      showMsg('changePasswordMsg', res.message, 'error');
      return;
    }
    showMsg('changePasswordMsg', 'Password updated.', 'success');
    const wasForced = passwordChangeForced;
    passwordChangeForced = false;
    setTimeout(function () {
      document.getElementById('changePasswordModal').classList.remove('open');
      if (wasForced) startDashboard();
    }, 900);
  } catch (err) {
    showMsg('changePasswordMsg', err.message, 'error');
  }
}

// ---------- Tabs ----------

const HR_DATA_TABS = ['postTab', 'jobsTab', 'appsTab', 'interviewsTab', 'shortlistTab', 'hiredTab', 'rejectedTab'];

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
  const btn = document.querySelector('.tab-btn[data-tab="' + tabId + '"]');
  if (btn) btn.classList.add('active');
  document.getElementById(tabId).classList.add('active');

  if (HR_DATA_TABS.indexOf(tabId) > -1) loadDashboard();
  if (tabId === 'hrTab') loadHrAccounts();
  if (tabId === 'applicantsTab') loadApplicantsOverview();
}

document.querySelectorAll('.stat-card[data-go]').forEach(function (card) {
  card.addEventListener('click', function () { switchTab(card.dataset.go); });
});

// ---------- Dashboard data (one call: jobs, applications, interview rounds, stats) ----------

let allRounds = [];
let dashboardLoadedAt = 0;

async function loadDashboard(force) {
  // Switching between HR tabs within a few seconds reuses what we already
  // have instead of hitting the server again.
  if (!force && Date.now() - dashboardLoadedAt < 8000) { setDashLoading(false); return; }

  setRefreshing(true);
  try {
    const res = await call('getDashboard');
    if (res.status !== 'success') return;

    dashboardLoadedAt = Date.now();
    allJobsAdmin = res.jobs || [];
    allApps = res.applications || [];
    allRounds = res.interviews || [];

    const s = res.stats || {};
    setText('statActiveJobs', s.activeJobs || 0);
    setText('statTotalApps', s.totalApplications || 0);
    setText('statInterviews', s.interviews || 0);
    setText('statShortlisted', s.shortlisted || 0);
    setText('statHired', s.hired || 0);
    setText('statRejected', s.rejected || 0);

    renderJobsTable();
    populateJobFilter();
    renderAllLists();

    // If the candidate profile is open, refresh it with the new data.
    const openId = document.getElementById('candidateModal').dataset.appId;
    if (openId && document.getElementById('candidateModal').classList.contains('open')) openCandidate(openId);
  } catch (err) { /* call() already surfaced it */ }
  finally {
    setRefreshing(false);
    setDashLoading(false);
  }
}

function renderAllLists() {
  renderAppsTable();
  renderInterviewsTable();
  renderShortlistTable();
  renderHiredTable();
  renderRejectedTable();
  updateTabCounts();
}

function filteredByRole(list) {
  const jobId = document.getElementById('appJobFilter').value;
  return jobId ? list.filter(function (a) { return a.JobID === jobId; }) : list;
}

function updateTabCounts() {
  const apps = filteredByRole(allApps);
  setText('cntApps', apps.length);
  setText('cntInterviews', roundsForView().filter(function (r) { return r.Outcome === 'Pending'; }).length);
  setText('cntShortlisted', apps.filter(function (a) { return a.Shortlisted; }).length);
  setText('cntHired', apps.filter(function (a) { return a.Status === 'Hired'; }).length);
  setText('cntRejected', apps.filter(function (a) { return a.Status === 'Rejected'; }).length);
}

// ---------- Post / edit a role ----------

function setupOtherToggle(selectId, otherId, triggerValue) {
  const select = document.getElementById(selectId);
  const other = document.getElementById(otherId);
  select.addEventListener('change', function () {
    const show = select.value === triggerValue;
    other.style.display = show ? 'block' : 'none';
    if (!show) other.value = '';
  });
}
setupOtherToggle('jobDepartment', 'jobDepartmentOther', 'Other');
setupOtherToggle('jobLocation', 'jobLocationOther', 'Other');
setupOtherToggle('jobSalary', 'jobSalaryOther', 'Custom');

function resolveSelectValue(selectId, otherId) {
  const select = document.getElementById(selectId);
  const other = document.getElementById(otherId);
  return (select.value === 'Other' || select.value === 'Custom') ? other.value.trim() : select.value;
}

function setSelectOrOther(selectId, otherId, value, fallbackOption) {
  const select = document.getElementById(selectId);
  const other = document.getElementById(otherId);
  const hasMatch = Array.prototype.some.call(select.options, function (o) { return o.value === value; });
  if (hasMatch) {
    select.value = value;
    other.style.display = 'none';
    other.value = '';
  } else {
    select.value = fallbackOption;
    other.style.display = 'block';
    other.value = value || '';
  }
}

async function saveJob() {
  const title = document.getElementById('jobTitle').value.trim();
  const description = document.getElementById('jobDescription').value.trim();
  const employerEmail = document.getElementById('jobEmployerEmail').value.trim();

  if (!title || !description || !employerEmail) {
    showMsg('jobFormMsg', 'Title, description and a notification email are all needed.', 'error');
    return;
  }

  const editId = document.getElementById('jobEditId').value;
  const fields = {
    title: title,
    department: resolveSelectValue('jobDepartment', 'jobDepartmentOther'),
    location: resolveSelectValue('jobLocation', 'jobLocationOther'),
    type: document.getElementById('jobType').value,
    salary: resolveSelectValue('jobSalary', 'jobSalaryOther'),
    deadline: document.getElementById('jobDeadline').value,
    employerEmail: employerEmail,
    description: description,
    requirements: document.getElementById('jobRequirements').value,
    status: document.getElementById('jobStatus').value
  };

  const btn = document.getElementById('saveJobBtn');
  setBusy(btn, true, editId ? 'Saving…' : 'Publishing…');

  try {
    let res;
    if (editId) {
      res = await call('updateJob', {
        job: {
          ID: editId,
          Title: fields.title, Department: fields.department, Location: fields.location,
          Type: fields.type, Salary: fields.salary, Deadline: fields.deadline,
          EmployerEmail: fields.employerEmail, Description: fields.description,
          Requirements: fields.requirements, Status: fields.status
        }
      });
    } else {
      res = await call('addJob', { job: fields });
    }

    if (res.status === 'success') {
      showMsg('jobFormMsg', editId ? 'Role updated.' : 'Role published.', 'success');
      resetJobForm();
      clearApiCache();
      loadDashboard(true);
    } else {
      showMsg('jobFormMsg', res.message, 'error');
    }
  } catch (err) {
    showMsg('jobFormMsg', err.message, 'error');
  } finally {
    setBusy(btn, false);
  }
}

function resetJobForm() {
  document.getElementById('jobEditId').value = '';
  document.getElementById('jobFormHeading').textContent = 'New role';
  document.getElementById('saveJobBtn').textContent = 'Publish role';
  document.getElementById('cancelEditBtn').style.display = 'none';
  ['jobTitle', 'jobDeadline', 'jobEmployerEmail', 'jobDescription', 'jobRequirements']
    .forEach(function (id) { document.getElementById(id).value = ''; });
  ['jobDepartmentOther', 'jobLocationOther', 'jobSalaryOther'].forEach(function (id) {
    const el = document.getElementById(id);
    el.value = '';
    el.style.display = 'none';
  });
  document.getElementById('jobDepartment').selectedIndex = 0;
  document.getElementById('jobLocation').selectedIndex = 0;
  document.getElementById('jobSalary').value = 'Not disclosed';
  document.getElementById('jobType').value = 'Full-time';
  document.getElementById('jobStatus').value = 'Active';
}

function editJob(jobId) {
  const job = allJobsAdmin.find(function (j) { return j.ID === jobId; });
  if (!job) return;
  switchTab('postTab');
  document.getElementById('jobEditId').value = job.ID;
  document.getElementById('jobFormHeading').textContent = 'Edit role';
  document.getElementById('saveJobBtn').textContent = 'Save changes';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  document.getElementById('jobTitle').value = job.Title || '';
  setSelectOrOther('jobDepartment', 'jobDepartmentOther', job.Department || '', 'Other');
  setSelectOrOther('jobLocation', 'jobLocationOther', job.Location || '', 'Other');
  setSelectOrOther('jobSalary', 'jobSalaryOther', job.Salary || 'Not disclosed', 'Custom');
  document.getElementById('jobType').value = job.Type || 'Full-time';
  document.getElementById('jobDeadline').value = job.Deadline || '';
  document.getElementById('jobEmployerEmail').value = job.EmployerEmail || '';
  document.getElementById('jobDescription').value = job.Description || '';
  document.getElementById('jobRequirements').value = job.Requirements || '';
  document.getElementById('jobStatus').value = job.Status || 'Active';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function removeJob(jobId) {
  if (!confirm('Delete this role? Applications already received are kept.')) return;
  try {
    await call('deleteJob', { jobId: jobId });
    clearApiCache();
    loadDashboard(true);
  } catch (err) { /* handled in call() */ }
}

// ---------- Roles table ----------

function renderJobsTable() {
  const body = document.getElementById('jobsTableBody');
  if (allJobsAdmin.length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="table-empty">No roles yet. Post one from the first tab.</td></tr>';
    return;
  }
  body.innerHTML = '';
  allJobsAdmin.forEach(function (job) {
    const tr = document.createElement('tr');
    const statusClass = String(job.Status).toLowerCase() === 'active' ? 'status-active' : 'status-closed';
    tr.innerHTML =
      '<td><strong>' + escapeHtml(job.Title) + '</strong></td>' +
      '<td>' + escapeHtml(job.Department) + '</td>' +
      '<td>' + escapeHtml(job.Location) + '</td>' +
      '<td>' + escapeHtml(job.Type) + '</td>' +
      '<td><span class="status-pill ' + statusClass + '">' +
        escapeHtml(String(job.Status).toLowerCase() === 'active' ? 'Open' : 'Closed') + '</span></td>' +
      '<td>' + escapeHtml(job.PostedDate) + '</td>' +
      '<td></td>';
    const actionTd = tr.lastElementChild;
    actionTd.appendChild(makeBtn('Edit', 'icon-btn', function () { editJob(job.ID); }));
    actionTd.appendChild(makeBtn('Delete', 'icon-btn delete', function () { removeJob(job.ID); }));
    body.appendChild(tr);
  });
}

function populateJobFilter() {
  const select = document.getElementById('appJobFilter');
  const current = select.value;
  select.innerHTML = '<option value="">Every role</option>';
  allJobsAdmin.forEach(function (job) {
    const opt = document.createElement('option');
    opt.value = job.ID;
    opt.textContent = job.Title;
    select.appendChild(opt);
  });
  select.value = current;
}

// ---------- Pipeline helpers ----------

function appById(id) {
  return allApps.find(function (a) { return a.ID === id; });
}

function roundsFor(appId) {
  return allRounds
    .filter(function (r) { return r.ApplicationID === appId; })
    .sort(function (a, b) { return a.Round - b.Round; });
}

function isNew(app) {
  return !app.Status || app.Status === 'Received' || app.Status === 'Reviewed';
}

function roundOf(app) {
  return parseInt(app.CurrentRound, 10) || 1;
}

function roundsCleared(app) {
  const n = roundsFor(app.ID).filter(function (r) { return r.Outcome === 'Shortlisted' || r.Outcome === 'Hired'; }).length;
  return n || (app.Shortlisted ? roundOf(app) - (app.Status === 'Interview Scheduled' ? 1 : 0) : 0);
}

function stageInfo(app) {
  const r = roundOf(app);
  switch (app.Status) {
    case 'Interview Scheduled': return { label: 'Round ' + r + ' interview', cls: 'status-interview' };
    case 'Shortlisted':         return { label: 'Shortlisted', cls: 'status-shortlisted' };
    case 'Hired':               return { label: 'Hired', cls: 'status-hired' };
    case 'Rejected':            return { label: 'Rejected', cls: 'status-rejected' };
    default:                    return { label: 'New', cls: 'status-received' };
  }
}

// One plain sentence under the status saying what happens next.
function nextHint(app) {
  const r = roundOf(app);
  switch (app.Status) {
    case 'Interview Scheduled':
      return '<b>' + escapeHtml(fmtWhen(app.InterviewDate, app.InterviewTime)) + '</b><br>Next: enter the result after the interview';
    case 'Shortlisted':
      return 'Cleared round ' + r + '<br>Next: schedule round ' + (r + 1) + ', or hire';
    case 'Hired':
      return 'Hired' + (app.HiredDate ? ' on ' + escapeHtml(String(app.HiredDate).split(',')[0]) : '');
    case 'Rejected':
      return 'At ' + escapeHtml(String(app.RejectedAt || 'screening').toLowerCase());
    default:
      return 'Next: schedule an interview, or reject';
  }
}

function statusCell(app) {
  return '<div class="status-cell">' + stagePill(app) + '<span class="next-hint">' + nextHint(app) + '</span></div>';
}

function stagePill(app) {
  const s = stageInfo(app);
  return '<span class="status-pill ' + s.cls + '">' + escapeHtml(s.label) + '</span>';
}

// Applied › Round 1 ✓ › Round 2 · pending › Hired
function journeyHtml(app) {
  const parts = [];
  const rounds = roundsFor(app.ID);
  rounds.forEach(function (r) {
    const map = {
      Pending:     ['iv',    'Round ' + r.Round + ' · pending'],
      Shortlisted: ['ok',    'Round ' + r.Round + ' ✓'],
      Hired:       ['hired', 'Round ' + r.Round + ' ✓'],
      Rejected:    ['rej',   'Round ' + r.Round + ' ✗']
    };
    const m = map[r.Outcome] || ['', 'Round ' + r.Round];
    parts.push('<span class="j ' + m[0] + '">' + escapeHtml(m[1]) + '</span>');
  });
  if (app.Status === 'Shortlisted') parts.push('<span class="j ok">Shortlisted</span>');
  if (app.Status === 'Hired') parts.push('<span class="j hired">Hired</span>');
  if (app.Status === 'Rejected') parts.push('<span class="j rej">Rejected</span>');
  if (!rounds.length) return '';
  return '<div class="journey">' + parts.join('<span class="sep">›</span>') + '</div>';
}

function nameCell(app, sub) {
  return '<button class="cand-link" data-open="' + escapeHtml(app.ID) + '">' + escapeHtml(app.FullName) + '</button>' +
    '<span class="cell-sub">' + escapeHtml(sub === undefined ? (app.Qualification || '') : sub) + '</span>';
}

function contactCell(app) {
  return escapeHtml(app.Email) + '<span class="cell-sub">' + escapeHtml(app.Phone || '') + '</span>';
}

// "2026-10-12" + "14:30" → "Mon, 12 Oct 2026 · 2:30 PM"
function fmtWhen(date, time) {
  let out = date || '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    out = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  const t = /^(\d{1,2}):(\d{2})/.exec(time || '');
  if (t) {
    let h = Number(t[1]);
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    out += ' · ' + h + ':' + t[2] + ' ' + ap;
  } else if (time) {
    out += ' · ' + time;
  }
  return out;
}

function modeLabel(mode) {
  return mode === 'In-Person' ? 'In person' : (mode || '');
}

function whereHtml(loc) {
  if (!loc) return '';
  if (/^https?:\/\//i.test(loc)) {
    return '<a class="link-btn" href="' + escapeHtml(loc) + '" target="_blank" rel="noopener">Meeting link</a>';
  }
  return escapeHtml(loc);
}

// The buttons that move a candidate forward from wherever they are now.
function stageActions(app, opts) {
  opts = opts || {};
  const btns = [];
  const r = roundOf(app);
  if (isNew(app)) {
    btns.push(makeBtn('Schedule interview', 'icon-btn solid', function () { openInterviewModal(app); }));
    btns.push(makeBtn('Reject', 'icon-btn delete', function () { openResult(app, 'screen', 'Rejected'); }));
  } else if (app.Status === 'Interview Scheduled') {
    btns.push(makeBtn('Enter result', 'icon-btn solid', function () { openResult(app, 'interview', ''); }));
    btns.push(makeBtn('Reschedule', 'icon-btn', function () { openInterviewModal(app); }));
  } else if (app.Status === 'Shortlisted') {
    btns.push(makeBtn('Schedule round ' + (r + 1), 'icon-btn solid', function () { openInterviewModal(app); }));
    btns.push(makeBtn('Hire', 'icon-btn', function () { openResult(app, 'decision', 'Hired'); }));
    btns.push(makeBtn('Reject', 'icon-btn delete', function () { openResult(app, 'decision', 'Rejected'); }));
  } else if (opts.viewWhenClosed) {
    btns.push(makeBtn('View details', 'icon-btn', function () { openCandidate(app.ID); }));
  }
  return btns;
}

// Mobile-only last cell: current status + a View button that opens the
// candidate pop-up, where every action for that person is available.
function mobileCell(app, pillHtml) {
  return '<td class="m-cell"><div class="m-row">' + (pillHtml || stagePill(app)) +
    '<button type="button" class="icon-btn solid m-view" data-open="' + escapeHtml(app.ID) + '">' +
    iconSvg('eye') + '<span>View</span></button></div></td>';
}

function appendAll(td, btns) {
  if (!btns.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'row-actions';
  btns.forEach(function (b) { wrap.appendChild(b); });
  td.appendChild(wrap);
}

function emptyRow(body, cols, text) {
  body.innerHTML = '<tr><td colspan="' + cols + '" class="table-empty">' + text + '</td></tr>';
}

// One click handler for every candidate name in every table.
document.addEventListener('click', function (e) {
  const link = e.target.closest('[data-open]');
  if (link) openCandidate(link.getAttribute('data-open'));
});

// ---------- Applications tab ----------

function renderAppsTable() {
  const q = (document.getElementById('appSearch').value || '').trim().toLowerCase();
  const stage = document.getElementById('appStageFilter').value;
  const rows = filteredByRole(allApps).filter(function (a) {
    if (stage === 'new' && !isNew(a)) return false;
    if (stage && stage !== 'new' && stage !== 'Shortlisted' && a.Status !== stage) return false;
    if (stage === 'Shortlisted' && !a.Shortlisted) return false;
    if (q) {
      const hay = [a.FullName, a.Email, a.Phone, a.JobTitle].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
  const body = document.getElementById('appsTableBody');
  if (rows.length === 0) return emptyRow(body, 8, allApps.length ? 'No candidates match this filter.' : 'No applications yet.');

  body.innerHTML = '';
  rows.forEach(function (app) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + nameCell(app) + '</td>' +
      '<td>' + escapeHtml(app.JobTitle) + '</td>' +
      '<td>' + contactCell(app) + '</td>' +
      '<td>' + escapeHtml(app.Experience || '—') + '</td>' +
      '<td>' + (app.ResumeLink
        ? '<a class="link-btn" href="' + escapeHtml(app.ResumeLink) + '" target="_blank" rel="noopener">Open</a>'
        : '<span class="cell-sub">None</span>') + '</td>' +
      '<td>' + statusCell(app) + '</td>' +
      '<td><span class="cell-sub" style="margin:0;white-space:nowrap">' + escapeHtml(String(app.Timestamp || '').split(',')[0]) + '</span></td>' +
      '<td></td>';
    appendAll(tr.lastElementChild, stageActions(app, { viewWhenClosed: true }));
    tr.insertAdjacentHTML('beforeend', mobileCell(app));
    body.appendChild(tr);
  });
}

// ---------- Interviews tab ----------

let ivFilter = 'pending';

function setIvFilter(f) {
  ivFilter = f;
  document.querySelectorAll('#ivChips .chip').forEach(function (c) { c.classList.toggle('on', c.dataset.f === f); });
  renderInterviewsTable();
}

function roundsForView() {
  return filteredByRole(allRounds);
}

function renderInterviewsTable() {
  const rows = roundsForView().filter(function (r) {
    if (ivFilter === 'pending') return r.Outcome === 'Pending';
    if (ivFilter === 'done') return r.Outcome && r.Outcome !== 'Pending';
    return true;
  });
  // Upcoming first for pending; most recent first otherwise.
  if (ivFilter === 'pending') {
    rows.sort(function (a, b) { return String(a.InterviewDate + a.InterviewTime).localeCompare(String(b.InterviewDate + b.InterviewTime)); });
  }

  const body = document.getElementById('interviewsTableBody');
  if (rows.length === 0) {
    return emptyRow(body, 8, ivFilter === 'pending'
      ? 'No interviews waiting for a result. Schedule round 1 from the Applications tab.'
      : 'No interview rounds here yet.');
  }

  body.innerHTML = '';
  rows.forEach(function (iv) {
    const app = appById(iv.ApplicationID) || { ID: iv.ApplicationID, FullName: iv.ApplicantName, Email: iv.ApplicantEmail };
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + nameCell(app, iv.ApplicantEmail || app.Email || '') + '</td>' +
      '<td>' + escapeHtml(iv.JobTitle) + '</td>' +
      '<td><span class="round-tag">Round ' + escapeHtml(iv.Round) + '</span>' +
        (iv.Action === 'Rescheduled' ? '<span class="cell-sub">Rescheduled</span>' : '') + '</td>' +
      '<td>' + escapeHtml(fmtWhen(iv.InterviewDate, iv.InterviewTime)) + '</td>' +
      '<td>' + escapeHtml(modeLabel(iv.Mode)) + '<span class="cell-sub">' + whereHtml(iv.Location) + '</span></td>' +
      '<td></td><td></td>' +
      '<td>' + escapeHtml(iv.ScheduledBy || '') + '</td>';

    const resultTd = tr.children[5];
    const actionTd = tr.children[6];
    const live = app.Status === 'Interview Scheduled' && roundOf(app) === Number(iv.Round);

    if (iv.Outcome === 'Pending' && live) {
      const wrap = document.createElement('div');
      wrap.className = 'result-btns';
      wrap.appendChild(makeBtn('Shortlist', 'icon-btn solid', function () { openResult(app, 'interview', 'Shortlisted'); }));
      wrap.appendChild(makeBtn('Hire', 'icon-btn', function () { openResult(app, 'interview', 'Hired'); }));
      wrap.appendChild(makeBtn('Reject', 'icon-btn delete', function () { openResult(app, 'interview', 'Rejected'); }));
      resultTd.appendChild(wrap);
      appendAll(actionTd, [makeBtn('Reschedule', 'icon-btn', function () { openInterviewModal(app); })]);
    } else {
      const cls = { Shortlisted: 'status-shortlisted', Hired: 'status-hired', Rejected: 'status-rejected', Pending: 'status-interview' }[iv.Outcome] || 'status-received';
      resultTd.innerHTML = '<span class="status-pill ' + cls + '">' + escapeHtml(iv.Outcome || '—') + '</span>' +
        (iv.OutcomeBy || iv.OutcomeDate ? '<span class="cell-sub">' + escapeHtml([iv.OutcomeBy, iv.OutcomeDate].filter(Boolean).join(' · ')) + '</span>' : '') +
        (iv.OutcomeNotes ? '<span class="outcome-note">' + escapeHtml(iv.OutcomeNotes) + '</span>' : '');
      actionTd.innerHTML = '<span class="muted">—</span>';
    }
    const ivCls = { Shortlisted: 'status-shortlisted', Hired: 'status-hired', Rejected: 'status-rejected' }[iv.Outcome] || 'status-interview';
    const ivLabel = iv.Outcome && iv.Outcome !== 'Pending'
      ? 'Round ' + iv.Round + ' · ' + iv.Outcome.toLowerCase()
      : 'Round ' + iv.Round + ' · ' + (iv.InterviewDate ? fmtWhen(iv.InterviewDate, '').replace(/, \d{4}$/, '') : 'pending');
    tr.insertAdjacentHTML('beforeend', mobileCell(app, '<span class="status-pill ' + ivCls + '">' + escapeHtml(ivLabel) + '</span>'));
    body.appendChild(tr);
  });
}

// ---------- Shortlisted tab ----------

function renderShortlistTable() {
  const rows = filteredByRole(allApps).filter(function (a) { return a.Shortlisted; });
  const body = document.getElementById('shortlistTableBody');
  if (rows.length === 0) return emptyRow(body, 6, 'No one shortlisted yet. Shortlist a candidate from the Interviews tab after their interview.');

  body.innerHTML = '';
  rows.forEach(function (app) {
    const tr = document.createElement('tr');
    const cleared = roundsCleared(app);
    tr.innerHTML =
      '<td>' + nameCell(app) + '</td>' +
      '<td>' + escapeHtml(app.JobTitle) + '</td>' +
      '<td><strong>' + cleared + '</strong> <span class="muted">round' + (cleared === 1 ? '' : 's') + '</span></td>' +
      '<td>' + statusCell(app) + journeyHtml(app) + '</td>' +
      '<td><span class="cell-sub" style="margin:0">' + escapeHtml(app.ShortlistedDate || '—') + '</span></td>' +
      '<td></td>';
    appendAll(tr.lastElementChild, stageActions(app, { viewWhenClosed: true }));
    tr.insertAdjacentHTML('beforeend', mobileCell(app));
    body.appendChild(tr);
  });
}

// ---------- Hired tab ----------

function renderHiredTable() {
  const rows = filteredByRole(allApps).filter(function (a) { return a.Status === 'Hired'; });
  const body = document.getElementById('hiredTableBody');
  if (rows.length === 0) return emptyRow(body, 6, 'No hires yet.');
  body.innerHTML = rows.map(function (app) {
    const n = roundsFor(app.ID).length;
    return '<tr>' +
      '<td>' + nameCell(app) + journeyHtml(app) + '</td>' +
      '<td>' + escapeHtml(app.JobTitle) + '</td>' +
      '<td>' + contactCell(app) + '</td>' +
      '<td>' + (n || '—') + '</td>' +
      '<td>' + escapeHtml(app.HiredDate || app.DecisionDate || '—') + '</td>' +
      '<td><span class="outcome-note" style="margin:0">' + escapeHtml(app.DecisionNotes || '') + '</span></td>' +
      mobileCell(app) +
      '</tr>';
  }).join('');
}

// ---------- Rejected tab ----------

function renderRejectedTable() {
  const rows = filteredByRole(allApps).filter(function (a) { return a.Status === 'Rejected'; });
  const body = document.getElementById('rejectedTableBody');
  if (rows.length === 0) return emptyRow(body, 6, 'No rejected candidates.');
  body.innerHTML = rows.map(function (app) {
    return '<tr>' +
      '<td>' + nameCell(app) + journeyHtml(app) + '</td>' +
      '<td>' + escapeHtml(app.JobTitle) + '</td>' +
      '<td>' + contactCell(app) + '</td>' +
      '<td><span class="status-pill status-rejected">' + escapeHtml(app.RejectedAt || 'Rejected') + '</span></td>' +
      '<td>' + escapeHtml(app.DecisionDate || app.LastUpdated || '—') + '</td>' +
      '<td><span class="outcome-note" style="margin:0">' + escapeHtml(app.DecisionNotes || '') + '</span></td>' +
      mobileCell(app) +
      '</tr>';
  }).join('');
}

// ---------- Schedule / reschedule a round ----------

function openInterviewModal(app) {
  const reschedule = app.Status === 'Interview Scheduled';
  const r = reschedule ? roundOf(app) : (app.Status === 'Shortlisted' ? roundOf(app) + 1 : 1);

  document.getElementById('interviewAppId').value = app.ID;
  document.getElementById('interviewModalTitle').textContent =
    (reschedule ? 'Reschedule round ' : 'Schedule round ') + r + ' — ' + app.FullName;
  document.getElementById('interviewModalSub').textContent = app.JobTitle + ' · ' + app.Email;
  document.getElementById('interviewDate').value = reschedule ? (app.InterviewDate || '') : '';
  document.getElementById('interviewTime').value = reschedule ? (app.InterviewTime || '') : '';
  document.getElementById('interviewMode').value = app.InterviewMode || 'Online';
  document.getElementById('interviewLocation').value = reschedule ? (app.InterviewLocation || '') : (app.InterviewLocation || '');
  document.getElementById('interviewNotes').value = reschedule ? (app.InterviewNotes || '') : '';
  document.getElementById('scheduleInterviewBtn').textContent =
    (reschedule ? 'Reschedule round ' : 'Schedule round ') + r + ' and email candidate';
  showMsg('interviewFormMsg', '', '');
  closeCandidate();
  document.getElementById('interviewModal').classList.add('open');
}

function closeInterviewModal() {
  document.getElementById('interviewModal').classList.remove('open');
}

document.getElementById('interviewModal').addEventListener('click', function (e) {
  if (e.target.id === 'interviewModal') closeInterviewModal();
});

async function submitInterview() {
  const date = document.getElementById('interviewDate').value;
  const time = document.getElementById('interviewTime').value;
  if (!date || !time) {
    showMsg('interviewFormMsg', 'Pick a date and a time.', 'error');
    return;
  }

  const btn = document.getElementById('scheduleInterviewBtn');
  setBusy(btn, true, 'Scheduling and emailing…');

  try {
    const res = await call('scheduleInterview', {
      interview: {
        applicationId: document.getElementById('interviewAppId').value,
        date: date,
        time: time,
        mode: document.getElementById('interviewMode').value,
        location: document.getElementById('interviewLocation').value.trim(),
        notes: document.getElementById('interviewNotes').value.trim()
      }
    });

    if (res.status === 'success') {
      showMsg('interviewFormMsg',
        res.emailSent
          ? res.message + ' The candidate has been emailed.'
          : res.message + ' The email did not go out — contact the candidate directly.',
        res.emailSent ? 'success' : 'error');
      loadDashboard(true);
      setTimeout(closeInterviewModal, 1500);
    } else {
      showMsg('interviewFormMsg', res.message, 'error');
    }
  } catch (err) {
    showMsg('interviewFormMsg', err.message, 'error');
  } finally {
    setBusy(btn, false);
  }
}

// ---------- Record a result / decide ----------
// kind: 'interview' — result of the current round (Shortlist / Hire / Reject)
//       'decision'  — from the Shortlisted tab, no round pending (Hire / Reject)
//       'screen'    — reject a new application before any interview

const CHOICES = {
  Shortlisted: { label: 'Shortlist', sub: 'Cleared — goes to the next round' },
  Hired:       { label: 'Hire', sub: 'Selected — no more rounds' },
  Rejected:    { label: 'Reject', sub: 'Not moving forward' }
};

function openResult(app, kind, preselect) {
  const r = roundOf(app);
  const options = kind === 'interview' ? ['Shortlisted', 'Hired', 'Rejected']
    : kind === 'decision' ? ['Hired', 'Rejected'] : ['Rejected'];

  document.getElementById('resultAppId').value = app.ID;
  document.getElementById('resultKind').value = kind;
  document.getElementById('resultTitle').textContent =
    kind === 'interview' ? 'Round ' + r + ' result — ' + app.FullName
    : kind === 'decision' ? 'Final decision — ' + app.FullName
    : 'Reject application — ' + app.FullName;
  document.getElementById('resultSub').textContent = app.JobTitle +
    (kind === 'interview' ? ' · interviewed ' + fmtWhen(app.InterviewDate, app.InterviewTime) : '') +
    (kind === 'decision' ? ' · cleared ' + roundsCleared(app) + ' round(s)' : '');

  const row = document.getElementById('resultChoices');
  row.className = 'choice-row' + (options.length === 2 ? ' two' : '') ;
  if (options.length === 1) row.className = 'choice-row two';
  row.innerHTML = '';
  options.forEach(function (o) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.dataset.value = o;
    b.innerHTML = escapeHtml(CHOICES[o].label) + '<small>' + escapeHtml(CHOICES[o].sub) + '</small>';
    b.onclick = function () { pickChoice(o); };
    row.appendChild(b);
  });
  pickChoice(preselect || (options.length === 1 ? options[0] : ''));

  document.getElementById('resultNotes').value = '';
  document.getElementById('resultMessage').value = '';
  document.getElementById('resultNotify').checked = true;
  showMsg('resultMsg', '', '');
  closeCandidate();
  document.getElementById('resultModal').classList.add('open');
}

function pickChoice(value) {
  document.querySelectorAll('#resultChoices .choice').forEach(function (c) {
    c.classList.toggle('on', c.dataset.value === value);
  });
  document.getElementById('resultModal').dataset.choice = value || '';
  const label = { Shortlisted: 'Shortlist candidate', Hired: 'Mark as hired', Rejected: 'Reject candidate' }[value] || 'Save result';
  document.getElementById('resultSaveBtn').textContent = label;
}

function closeResultModal() {
  document.getElementById('resultModal').classList.remove('open');
}

document.getElementById('resultModal').addEventListener('click', function (e) {
  if (e.target.id === 'resultModal') closeResultModal();
});

async function submitResult() {
  const choice = document.getElementById('resultModal').dataset.choice;
  if (!choice) {
    showMsg('resultMsg', 'Pick Shortlist, Hire or Reject.', 'error');
    return;
  }
  const kind = document.getElementById('resultKind').value;
  const payload = {
    applicationId: document.getElementById('resultAppId').value,
    notes: document.getElementById('resultNotes').value.trim(),
    message: document.getElementById('resultMessage').value.trim(),
    notify: document.getElementById('resultNotify').checked
  };

  const btn = document.getElementById('resultSaveBtn');
  setBusy(btn, true, 'Saving…');

  try {
    let res;
    if (kind === 'interview') {
      payload.outcome = choice;
      res = await call('recordInterviewOutcome', { result: payload });
    } else {
      payload.decision = choice;
      res = await call('decideCandidate', { decision: payload });
    }
    if (res.status === 'success') {
      const mail = !payload.notify ? ' No email sent.'
        : (res.emailSent ? ' The candidate has been emailed.' : ' The email did not go out — contact the candidate directly.');
      showMsg('resultMsg', res.message + mail, res.emailSent || !payload.notify ? 'success' : 'error');
      loadDashboard(true);
      setTimeout(closeResultModal, 1400);
    } else {
      showMsg('resultMsg', res.message, 'error');
    }
  } catch (err) {
    showMsg('resultMsg', err.message, 'error');
  } finally {
    setBusy(btn, false);
  }
}

// ---------- Candidate profile + journey ----------

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
}

function openCandidate(appId) {
  const app = appById(appId);
  if (!app) return;
  const modal = document.getElementById('candidateModal');
  modal.dataset.appId = appId;

  const items = [];
  items.push({ cls: 'done', title: 'Applied for ' + app.JobTitle, sub: app.Timestamp || '' });

  roundsFor(app.ID).forEach(function (r) {
    const sub = [fmtWhen(r.InterviewDate, r.InterviewTime), modeLabel(r.Mode), r.ScheduledBy ? 'set by ' + r.ScheduledBy : '']
      .filter(Boolean).join(' · ') + (r.Action === 'Rescheduled' ? ' · rescheduled' : '');
    items.push({ cls: r.Outcome === 'Pending' ? 'wait' : 'done', title: 'Round ' + r.Round + ' interview', sub: sub,
      note: r.Notes ? 'Note to candidate: ' + r.Notes : '' });
    if (r.Outcome === 'Pending') {
      items.push({ cls: 'wait', title: 'Awaiting round ' + r.Round + ' result', sub: 'Record it from the Interviews tab or below.' });
    } else if (r.Outcome) {
      const cls = { Shortlisted: 'ok', Hired: 'hired', Rejected: 'rej' }[r.Outcome] || 'done';
      const word = { Shortlisted: 'Shortlisted', Hired: 'Hired', Rejected: 'Rejected' }[r.Outcome] || r.Outcome;
      items.push({ cls: cls, title: word + ' after round ' + r.Round,
        sub: [r.OutcomeBy, r.OutcomeDate].filter(Boolean).join(' · '), note: r.OutcomeNotes });
    }
  });

  const lastOutcome = (roundsFor(app.ID).slice(-1)[0] || {}).Outcome;
  if (app.Status === 'Shortlisted') {
    items.push({ cls: 'wait', title: 'Next: schedule round ' + (roundOf(app) + 1) + ', hire or reject', sub: 'Shortlisted ' + (app.ShortlistedDate || '') });
  }
  if (app.Status === 'Hired' && lastOutcome !== 'Hired') {
    items.push({ cls: 'hired', title: 'Hired', sub: [app.DecisionBy, app.HiredDate || app.DecisionDate].filter(Boolean).join(' · '), note: app.DecisionNotes });
  }
  if (app.Status === 'Rejected' && lastOutcome !== 'Rejected') {
    items.push({ cls: 'rej', title: 'Rejected' + (app.RejectedAt ? ' · ' + app.RejectedAt.toLowerCase() : ''),
      sub: [app.DecisionBy, app.DecisionDate].filter(Boolean).join(' · '), note: app.DecisionNotes });
  }
  if (isNew(app)) items.push({ cls: 'wait', title: 'Next: schedule round 1 or reject', sub: '' });

  const meta = [
    ['Email', '<a class="link-btn" href="mailto:' + escapeHtml(app.Email) + '">' + escapeHtml(app.Email) + '</a>'],
    ['Phone', escapeHtml(app.Phone || '—')],
    ['Qualification', escapeHtml(app.Qualification || '—')],
    ['Experience', escapeHtml(app.Experience || '—')],
    ['Date of birth', escapeHtml(app.DOB || '—')],
    ['Resume', app.ResumeLink ? '<a class="link-btn" href="' + escapeHtml(app.ResumeLink) + '" target="_blank" rel="noopener">Open resume</a>' : '—']
  ];

  document.getElementById('candidateBody').innerHTML =
    '<div class="cand-head"><div class="avatar">' + escapeHtml(initials(app.FullName)) + '</div>' +
      '<div><h2>' + escapeHtml(app.FullName) + '</h2><div class="modal-sub" style="margin:0">' + escapeHtml(app.JobTitle) + ' &nbsp;' + stagePill(app) + '</div></div></div>' +
    '<div class="cand-meta">' + meta.map(function (m) { return '<div><span>' + m[0] + '</span>' + m[1] + '</div>'; }).join('') + '</div>' +
    (app.CoverNote ? '<div class="section-label">Note from the candidate</div><p style="white-space:pre-wrap;color:var(--ink-soft);font-size:13.5px;margin:0 0 20px;">' + escapeHtml(app.CoverNote) + '</p>' : '') +
    '<div class="section-label">Hiring journey</div>' +
    '<ul class="timeline">' + items.map(function (it) {
      return '<li class="' + it.cls + '"><span class="dot"></span><div class="t-title">' + escapeHtml(it.title) + '</div>' +
        (it.sub ? '<div class="t-sub">' + escapeHtml(it.sub) + '</div>' : '') +
        (it.note ? '<div class="t-note">' + escapeHtml(it.note) + '</div>' : '') + '</li>';
    }).join('') + '</ul>' +
    '<div class="cand-actions" id="candActions"></div>';

  const actions = stageActions(app);
  const holder = document.getElementById('candActions');
  if (actions.length) appendAll(holder, actions); else holder.remove();
  modal.classList.add('open');
}

function closeCandidate() {
  document.getElementById('candidateModal').classList.remove('open');
}

document.getElementById('candidateModal').addEventListener('click', function (e) {
  if (e.target.id === 'candidateModal') closeCandidate();
});

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  closeCandidate();
  closeResultModal();
  closeInterviewModal();
});

// ---------- HR accounts (Admin) ----------

async function loadHrAccounts() {
  try {
    setRefreshing(true);
    const res = await call('getHrAccounts');
    if (res.status !== 'success') return;

    const body = document.getElementById('hrTableBody');
    if (res.accounts.length === 0) {
      body.innerHTML = '<tr><td colspan="8" class="table-empty">No HR accounts yet. Add one above.</td></tr>';
      return;
    }
    body.innerHTML = '';
    res.accounts.forEach(function (acc) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><strong>' + escapeHtml(acc.username) + '</strong></td>' +
        '<td>' + escapeHtml(acc.fullName) + '</td>' +
        '<td>' + escapeHtml(acc.email) + '</td>' +
        '<td>' + escapeHtml(acc.jobCount) + '</td>' +
        '<td>' + escapeHtml(acc.applicationCount) + '</td>' +
        '<td>' + escapeHtml(acc.hiredCount) + '</td>' +
        '<td>' + escapeHtml(acc.createdDate) + '</td>' +
        '<td></td>';
      const actionTd = tr.lastElementChild;
      actionTd.appendChild(makeBtn('Reset password', 'icon-btn', function () { resetHrPassword(acc.username); }));
      actionTd.appendChild(makeBtn('Remove', 'icon-btn delete', function () { removeHrAccount(acc.username); }));
      body.appendChild(tr);
    });
  } catch (err) { /* handled in call() */ }
  finally { setRefreshing(false); setDashLoading(false); }
}

async function addHrAccount() {
  const username = document.getElementById('newHrUsername').value.trim();
  const password = document.getElementById('newHrPassword').value;
  if (!username || !password) {
    showMsg('hrFormMsg', 'A username and password are needed.', 'error');
    return;
  }

  try {
    const res = await call('addHr', {
      newHr: {
        username: username,
        password: password,
        fullName: document.getElementById('newHrFullName').value,
        email: document.getElementById('newHrEmail').value
      }
    });
    if (res.status === 'success') {
      showMsg('hrFormMsg', 'Account added. Share the password with them directly.', 'success');
      ['newHrUsername', 'newHrPassword', 'newHrFullName', 'newHrEmail'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      loadHrAccounts();
    } else {
      showMsg('hrFormMsg', res.message, 'error');
    }
  } catch (err) {
    showMsg('hrFormMsg', err.message, 'error');
  }
}

// Admin's answer to a "password reset requested" email from an HR user.
async function resetHrPassword(hrUsername) {
  const newPassword = prompt('New password for "' + hrUsername + '" (at least 8 characters):');
  if (newPassword === null) return;
  if (newPassword.trim().length < 8) {
    alert('That is too short. Use at least 8 characters.');
    return;
  }
  try {
    const res = await call('resetHrPassword', { hrUsername: hrUsername, newPassword: newPassword.trim() });
    alert(res.message || res.status);
    loadHrAccounts();
  } catch (err) { /* handled in call() */ }
}

async function removeHrAccount(hrUsername) {
  if (!confirm('Remove the account "' + hrUsername + '"? This cannot be undone.')) return;
  try {
    await call('removeHr', { hrUsername: hrUsername });
    loadHrAccounts();
  } catch (err) { /* handled in call() */ }
}

// ---------- Applicants overview (Admin, read-only) ----------

async function loadApplicantsOverview() {
  try {
    setRefreshing(true);
    const res = await call('getApplicantsOverview');
    if (res.status !== 'success') return;

    const body = document.getElementById('applicantsTableBody');
    if (res.applicants.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="table-empty">No applications yet.</td></tr>';
      return;
    }
    body.innerHTML = res.applicants.map(function (a) {
      return '<tr>' +
        '<td><strong>' + escapeHtml(a.FullName) + '</strong>' +
          '<span class="cell-sub">' + escapeHtml(a.Qualification || '') + '</span></td>' +
        '<td><span class="badge">' + escapeHtml(a.Department || '—') + '</span></td>' +
        '<td>' + escapeHtml(a.JobTitle) + '</td>' +
        '<td>' + escapeHtml(a.Email) + '<span class="cell-sub">' + escapeHtml(a.Phone || '') + '</span></td>' +
        '<td>' + stagePill(a) + '</td>' +
        '<td>' + escapeHtml(a.Timestamp) + '</td>' +
        '</tr>';
    }).join('');
  } catch (err) { /* handled in call() */ }
  finally { setRefreshing(false); setDashLoading(false); }
}

// ---------- Helpers ----------

// Small line icons, picked from the button's label.
const ICONS = {
  calendar: '<rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4"/>',
  clock:    '<circle cx="10" cy="10" r="7"/><path d="M10 6.5V10l2.5 1.5"/>',
  check:    '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
  star:     '<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
  x:        '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
  eye:      '<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.3"/>',
  edit:     '<path d="M12.5 4l3.5 3.5L7.5 16H4v-3.5z"/>',
  trash:    '<path d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6"/>',
  key:      '<circle cx="7" cy="12" r="3.2"/><path d="M9.3 9.7L16 3M13 6l2 2"/>',
  pen:      '<path d="M4 16l1-4 8-8 3 3-8 8z"/><path d="M11 6l3 3"/>'
};
function iconFor(text) {
  const t = String(text).toLowerCase();
  if (t.indexOf('reschedule') === 0) return 'clock';
  if (t.indexOf('schedule') === 0) return 'calendar';
  if (t === 'shortlist') return 'check';
  if (t === 'hire') return 'star';
  if (t === 'reject' || t === 'remove') return 'x';
  if (t.indexOf('view') === 0) return 'eye';
  if (t === 'edit') return 'edit';
  if (t === 'delete') return 'trash';
  if (t.indexOf('reset') === 0) return 'key';
  if (t.indexOf('enter result') === 0) return 'pen';
  return '';
}
function iconSvg(name) {
  return ICONS[name]
    ? '<svg class="btn-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>'
    : '';
}

// Puts a button into its "working" state (spinner + text) and back again.
function setBusy(btn, busy, text) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.idle) btn.dataset.idle = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.innerHTML = '<span class="btn-spin" aria-hidden="true"></span>' + escapeHtml(text || 'Working…');
  } else {
    btn.disabled = false;
    btn.classList.remove('is-busy');
    if (btn.dataset.idle) btn.innerHTML = btn.dataset.idle;
    delete btn.dataset.idle;
  }
}

function makeBtn(text, className, onClick) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.type = 'button';
  btn.innerHTML = iconSvg(iconFor(text)) + '<span>' + escapeHtml(text) + '</span>';
  btn.onclick = onClick;
  return btn;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showMsg(elId, text, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.className = 'msg ' + (text ? type : '');
}

// ---------- Start ----------
// Runs last, once every piece of state above has been initialised. Reloading
// the tab keeps you signed in; a new tab or a closed browser does not.
(function start() {
  const saved = loadSession();
  if (saved && saved.token) {
    session = saved;
    startDashboard();
  } else {
    showLogin();
  }
})();
