// ==========================================================================
// sparkling.co.in — Home, Products and Contact behaviour
// ==========================================================================
document.addEventListener('DOMContentLoaded', function () {

  // ---- reveal on scroll ----
  var reveal = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    reveal.forEach(function (el, i) { el.style.transitionDelay = (i % 4) * 70 + 'ms'; io.observe(el); });
  } else {
    reveal.forEach(function (el) { el.classList.add('in'); });
  }

  // ---- product catalogue: range filter + search ----
  var filterBar = document.getElementById('filters');
  if (filterBar) {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.pcard[data-cat]'));
    var search = document.getElementById('productSearch');
    var results = document.getElementById('results');
    var empty = document.getElementById('emptyResults');
    var current = 'all';

    filterBar.querySelectorAll('button').forEach(function (b) {
      var n = b.dataset.cat === 'all' ? cards.length : cards.filter(function (c) { return c.dataset.cat === b.dataset.cat; }).length;
      var ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = n; b.appendChild(ct);
      b.addEventListener('click', function () {
        current = b.dataset.cat; apply();
        history.replaceState(null, '', current === 'all' ? location.pathname : '#' + current);
      });
    });

    function apply() {
      var q = search ? search.value.trim().toLowerCase() : '';
      var shown = 0;
      filterBar.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.cat === current); });
      cards.forEach(function (c) {
        var okCat = current === 'all' || c.dataset.cat === current;
        var okQ = !q || c.textContent.toLowerCase().indexOf(q) > -1;
        var show = okCat && okQ;
        c.classList.toggle('hide', !show);
        if (show) shown++;
      });
      if (results) results.textContent = 'Showing ' + shown + ' of ' + cards.length + ' products';
      if (empty) empty.classList.toggle('show', shown === 0);
    }
    if (search) search.addEventListener('input', apply);
    var fromHash = location.hash.replace('#', '');
    if (fromHash && filterBar.querySelector('[data-cat="' + fromHash + '"]')) current = fromHash;
    apply();
  }

  // ---- product detail dialog ----
  var dlg = document.getElementById('productDialog');
  if (dlg) {
    var open = function (card) {
      var img = card.querySelector('.pimg-wrap');
      var box = dlg.querySelector('.pd-img');
      box.innerHTML = img.innerHTML;
      box.style.background = getComputedStyle(img).background;
      dlg.querySelector('.pd-type').textContent = card.querySelector('.ptype').textContent;
      dlg.querySelector('.pd-name').textContent = card.querySelector('.pname').textContent;
      dlg.querySelector('.pd-body').innerHTML = card.querySelector('template').innerHTML;
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    };
    document.querySelectorAll('.pcard[data-cat]').forEach(function (card) {
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.addEventListener('click', function () { open(card); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(card); }
      });
    });
    // flavour variants inside the dialog
    dlg.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.pv'); if (!b) return;
      dlg.querySelectorAll('.pv').forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      var im = dlg.querySelector('.pd-img img');
      if (im) { im.src = b.dataset.src; im.alt = dlg.querySelector('.pd-name').textContent + ' — ' + b.dataset.name; }
    });
    dlg.querySelector('.pd-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  }

  // ---- contact form: sends the message to its own Apps Script backend (Contact.gs): saved to the "Enquiries" sheet + confirmation emailed to the sender ----
  var form = document.getElementById('contactForm');
  if (form) {
    var msg = document.getElementById('formMsg');
    var btn = form.querySelector('button[type="submit"]');
    var btnHtml = btn ? btn.innerHTML : '';
    function say(text, kind) { msg.textContent = text; msg.className = 'form-msg show' + (kind ? ' ' + kind : ''); }
    function mailtoLink(to, subject, body) {
      return 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var to = form.dataset.to;
      var data = {
        topic: (form.elements.topic && form.elements.topic.value) || 'General enquiry',
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        phone: form.elements.phone.value.trim(),
        message: form.elements.message.value.trim(),
        website: form.elements.website ? form.elements.website.value : '',
        page: location.pathname.split('/').pop() || 'contact.html'
      };
      if (!data.name) { say('Enter your full name.', 'error'); form.elements.name.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { say('Enter a valid email address.', 'error'); form.elements.email.focus(); return; }
      if (!data.message) { say('Write a short message.', 'error'); form.elements.message.focus(); return; }

      var subject = data.topic + ' — ' + data.name;
      var body = data.message + '\n\n— ' + data.name + '\n' + data.email + (data.phone ? '\n' + data.phone : '') +
        '\n\nSent from the contact form on sparkling.co.in';
      function fallback(reason) {
        msg.className = 'form-msg show error';
        msg.innerHTML = '';
        msg.appendChild(document.createTextNode(reason + ' You can '));
        var a = document.createElement('a'); a.href = mailtoLink(to, subject, body); a.textContent = 'send it by email instead';
        msg.appendChild(a); msg.appendChild(document.createTextNode(' (to ' + to + ').'));
      }

      var url = (typeof CONTACT_FORM_URL !== 'undefined') ? CONTACT_FORM_URL : '';
      if (!url || url.indexOf('PASTE_') === 0) { fallback('The form is not connected yet.'); return; }
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      say('Sending your message…', 'info');
      var ctrl = new AbortController(); var timer = setTimeout(function () { ctrl.abort(); }, 20000);
      // Apps Script answers via a redirect whose reply browsers often refuse to let the page read
      // (especially when the site is opened from a file). The message itself still arrives, so send it
      // "no-cors": we can't read the reply, but if the request goes out, the enquiry is saved and emailed.
      fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'submitEnquiry', payload: data }),
        signal: ctrl.signal
      }).then(function () {
        form.reset();
        say('Thank you, ' + data.name.split(' ')[0] + '. Your message has been received — a confirmation email is on its way to ' + data.email + '.', 'ok');
      }).catch(function () {
        fallback('We couldn\'t reach our server just now.');
      }).finally(function () {
        clearTimeout(timer);
        if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
      });
    });
  }

  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
});
