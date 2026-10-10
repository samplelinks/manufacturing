/* ==========================================================================
   main.js — the public careers page (index.html)

   Candidates have no account here. They pick a role, fill the form, attach a
   resume and submit. That is the whole flow.
   ========================================================================== */

let allJobs = [];
let selectedJob = null;
let resumeFile = null;

const JOBS_CACHE_SECONDS = 120;
const MAX_RESUME_MB = 5;

// ---------- Load ----------

async function loadJobs() {
  try {
    const res = await apiGet('getJobs', {}, JOBS_CACHE_SECONDS);
    allJobs = res.jobs || [];
    populateFilters();
    renderJobList(allJobs);

    document.getElementById('heroJobCount').textContent = allJobs.length;
    document.getElementById('heroJobLabel').textContent =
      allJobs.length === 1 ? 'role open right now' : 'roles open right now';

    if (allJobs.length > 0) selectJob(allJobs[0].ID);
  } catch (err) {
    document.getElementById('jobList').innerHTML =
      '<div class="empty-list">We could not load the roles just now. Refresh the page to try again.</div>';
    document.getElementById('heroJobCount').textContent = '—';
  }
}

function populateFilters() {
  fillSelect('deptFilter', allJobs.map(function (j) { return j.Department; }), 'All teams');
  fillSelect('locFilter', allJobs.map(function (j) { return j.Location; }), 'All locations');
}

function fillSelect(selectId, values, placeholder) {
  const select = document.getElementById(selectId);
  const current = select.value;
  const unique = Array.from(new Set(values.filter(Boolean))).sort();
  select.innerHTML = '<option value="">' + placeholder + '</option>';
  unique.forEach(function (v) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
  select.value = current;
}

// ---------- Job list ----------

function renderJobList(jobs) {
  const list = document.getElementById('jobList');
  if (jobs.length === 0) {
    list.innerHTML = '<div class="empty-list">No roles match that. Clear the filters to see everything open.</div>';
    return;
  }
  list.innerHTML = jobs.map(function (job) {
    return '<div class="job-item' + (selectedJob && selectedJob.ID === job.ID ? ' active' : '') +
      '" role="button" tabindex="0" data-id="' + escapeHtml(job.ID) + '">' +
      '<h3>' + escapeHtml(job.Title) + '</h3>' +
      '<div class="meta">' + escapeHtml(job.Department || '') +
        (job.Department && job.Location ? ' &middot; ' : '') + escapeHtml(job.Location || '') + '</div>' +
      '<span class="tag">' + escapeHtml(job.Type || 'Full-time') + '</span>' +
      '</div>';
  }).join('');
}

// One listener on the container rather than one per row.
document.getElementById('jobList').addEventListener('click', function (e) {
  const item = e.target.closest('.job-item');
  if (item) selectJob(item.dataset.id);
});
document.getElementById('jobList').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const item = e.target.closest('.job-item');
  if (item) { e.preventDefault(); selectJob(item.dataset.id); }
});

function selectJob(jobId) {
  selectedJob = allJobs.find(function (j) { return j.ID === jobId; });
  renderJobList(filteredJobs());
  renderJobDetail(selectedJob);
  if (window.matchMedia('(max-width: 900px)').matches) {
    document.getElementById('jobDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function filteredJobs() {
  const q = document.getElementById('searchBox').value.toLowerCase();
  const dept = document.getElementById('deptFilter').value;
  const loc = document.getElementById('locFilter').value;
  return allJobs.filter(function (j) {
    const haystack = (j.Title + ' ' + j.Department + ' ' + j.Location + ' ' + j.Type).toLowerCase();
    return (!q || haystack.indexOf(q) > -1) &&
           (!dept || j.Department === dept) &&
           (!loc || j.Location === loc);
  });
}

['searchBox', 'deptFilter', 'locFilter'].forEach(function (id) {
  const el = document.getElementById(id);
  el.addEventListener(id === 'searchBox' ? 'input' : 'change', function () {
    renderJobList(filteredJobs());
  });
});

// ---------- Job detail ----------

function renderJobDetail(job) {
  const panel = document.getElementById('jobDetail');
  if (!job) {
    panel.innerHTML = '<div class="placeholder">Pick a role on the left to read the full description.</div>';
    return;
  }
  panel.innerHTML =
    '<div class="job-detail">' +
      '<h1>' + escapeHtml(job.Title) + '</h1>' +
      '<div class="company-line">' + escapeHtml(job.Department || '') +
        (job.Department && job.Location ? ' &middot; ' : '') + escapeHtml(job.Location || '') + '</div>' +
      '<div class="badges">' +
        '<span class="badge">' + escapeHtml(job.Type || 'Full-time') + '</span>' +
        (job.Salary ? '<span class="badge">' + escapeHtml(job.Salary) + '</span>' : '') +
        (job.Deadline ? '<span class="badge">Apply by ' + escapeHtml(job.Deadline) + '</span>' : '') +
      '</div>' +
      '<button class="apply-btn" id="openApplyBtn">Apply for this role</button>' +
      '<div class="section-title">About the role</div>' +
      '<div class="section-text">' + escapeHtml(job.Description || '') + '</div>' +
      (job.Requirements
        ? '<div class="section-title">What we are looking for</div><div class="section-text">' + escapeHtml(job.Requirements) + '</div>'
        : '') +
    '</div>';

  const btn = document.getElementById('openApplyBtn');
  if (btn) btn.onclick = openApplyForm;
}

// ---------- Application form ----------

function openApplyForm() {
  if (!selectedJob) return;
  resumeFile = null;

  document.getElementById('jobDetail').innerHTML =
    '<div class="apply-form">' +
      '<button class="back-link" id="backToJob">&larr; Back to the role</button>' +
      '<h2>Apply — ' + escapeHtml(selectedJob.Title) + '</h2>' +
      '<p class="apply-sub">' + escapeHtml(selectedJob.Department || '') +
        (selectedJob.Department && selectedJob.Location ? ' &middot; ' : '') +
        escapeHtml(selectedJob.Location || '') + '</p>' +

      '<div class="grid-2">' +
        '<div><label for="apName">Full name <span class="required">*</span></label>' +
        '<input type="text" id="apName" autocomplete="name"></div>' +
        '<div><label for="apEmail">Email <span class="required">*</span></label>' +
        '<input type="email" id="apEmail" autocomplete="email"></div>' +
      '</div>' +

      '<div class="grid-2">' +
        '<div><label for="apPhone">Phone <span class="required">*</span></label>' +
        '<input type="tel" id="apPhone" autocomplete="tel"></div>' +
        '<div><label for="apDob">Date of birth</label>' +
        '<input type="date" id="apDob"></div>' +
      '</div>' +

      '<div class="grid-2">' +
        '<div><label for="apQualification">Highest qualification</label>' +
        '<input type="text" id="apQualification" placeholder="e.g. B.Sc Food Technology"></div>' +
        '<div><label for="apExperience">Years of experience</label>' +
        '<select id="apExperience">' +
          '<option value="">Select</option>' +
          '<option>Fresher</option><option>Less than 1 year</option>' +
          '<option>1-3 years</option><option>3-5 years</option>' +
          '<option>5-10 years</option><option>More than 10 years</option>' +
        '</select></div>' +
      '</div>' +

      '<label for="apResume">Resume <span class="required">*</span></label>' +
      '<div class="file-row">' +
        '<input type="file" id="apResume" accept=".pdf,.doc,.docx">' +
      '</div>' +
      '<p class="form-hint">PDF or Word, up to ' + MAX_RESUME_MB + ' MB.</p>' +

      '<label for="apNote">Anything you would like us to know</label>' +
      '<textarea id="apNote" rows="4" placeholder="Optional — a few lines about why this role suits you."></textarea>' +

      '<button class="primary-btn full" id="submitApplyBtn" style="margin-top:24px;">Send application</button>' +
      '<div class="msg" id="applyMsg"></div>' +
    '</div>';

  document.getElementById('backToJob').onclick = function () { renderJobDetail(selectedJob); };
  document.getElementById('apResume').onchange = handleResumePick;
  document.getElementById('submitApplyBtn').onclick = submitApplication;
  document.getElementById('apName').focus();
  document.getElementById('jobDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handleResumePick(e) {
  const file = e.target.files[0];
  resumeFile = null;
  if (!file) return;

  if (file.size > MAX_RESUME_MB * 1024 * 1024) {
    showMsg('applyMsg', 'That file is over ' + MAX_RESUME_MB + ' MB. Attach a smaller one.', 'error');
    e.target.value = '';
    return;
  }
  resumeFile = file;
  showMsg('applyMsg', '', '');
}

function readFileAsBase64(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(new Error('We could not read that file. Try attaching it again.')); };
    reader.readAsDataURL(file);
  });
}

async function submitApplication() {
  const name = document.getElementById('apName').value.trim();
  const email = document.getElementById('apEmail').value.trim();
  const phone = document.getElementById('apPhone').value.trim();

  if (!name) return failWith('apName', 'Enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return failWith('apEmail', 'Enter a valid email address.');
  if (!phone) return failWith('apPhone', 'Enter a phone number we can reach you on.');
  if (!resumeFile) return failWith('apResume', 'Attach your resume.');

  const btn = document.getElementById('submitApplyBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  showMsg('applyMsg', 'Uploading your resume — this takes a few seconds.', 'info');

  try {
    const resumeData = await readFileAsBase64(resumeFile);
    const res = await apiPost('submitApplication', {
      jobId: selectedJob.ID,
      fullName: name,
      email: email,
      phone: phone,
      dob: document.getElementById('apDob').value,
      qualification: document.getElementById('apQualification').value.trim(),
      experience: document.getElementById('apExperience').value,
      coverNote: document.getElementById('apNote').value.trim(),
      resumeData: resumeData,
      resumeFileName: resumeFile.name,
      resumeMimeType: resumeFile.type || 'application/octet-stream'
    });

    if (res.status === 'success') {
      showApplySuccess(email);
    } else {
      showMsg('applyMsg', res.message, 'error');
    }
  } catch (err) {
    showMsg('applyMsg', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send application';
  }
}

function failWith(fieldId, message) {
  showMsg('applyMsg', message, 'error');
  const field = document.getElementById(fieldId);
  if (field) field.focus();
}

function showApplySuccess(email) {
  document.getElementById('jobDetail').innerHTML =
    '<div class="apply-success">' +
      '<div class="tick">&check;</div>' +
      '<h2>Application sent</h2>' +
      '<p>We have your application for ' + escapeHtml(selectedJob.Title) +
      ' and sent a confirmation to ' + escapeHtml(email) +
      '. Our hiring team will email you if your profile matches what the role needs.</p>' +
      '<button class="ghost-btn" id="browseMoreBtn">Browse other roles</button>' +
    '</div>';
  document.getElementById('browseMoreBtn').onclick = function () { renderJobDetail(selectedJob); };
}

function showMsg(elId, text, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.className = 'msg ' + (text ? type : '');
}

loadJobs();
