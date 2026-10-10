// ==========================================================
// Kalimark — shared behaviour (aeratedbovonto.com + sparkling.co.in)
// ==========================================================

document.addEventListener('DOMContentLoaded', () => {

  // ---- scroll reveal ----
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach((el, i) => {
      el.style.transitionDelay = (i % 5) * 60 + 'ms';
      io.observe(el);
    });
  } else {
    revealEls.forEach(el => el.classList.add('in'));
  }

  // ---- product card tilt ----
  document.querySelectorAll('.pcard.tilt').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(700px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(700px) rotateY(0) rotateX(0) translateY(0)';
    });
  });

  // ---- hero parallax ----
  const heroVisual = document.getElementById('heroVisual');
  if (heroVisual) {
    window.addEventListener('mousemove', (e) => {
      if (window.innerWidth < 980) return;
      const x = (e.clientX / window.innerWidth - 0.5) * 18;
      const y = (e.clientY / window.innerHeight - 0.5) * 18;
      heroVisual.style.transform = `translate(${x}px, ${y}px)`;
    });
  }

  // ---- mobile menu toggle ----
  const burger = document.querySelector('.burger');
  const mobileMenu = document.querySelector('.mobile-menu');
  if (burger && mobileMenu) {
    burger.addEventListener('click', () => {
      const open = mobileMenu.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    mobileMenu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => mobileMenu.classList.remove('open'));
    });
  }

  // ---- contact form ----
  // There is no mail server behind these static pages, so the form opens the
  // visitor's email app with the message filled in, addressed to the inbox in
  // the form's data-to attribute.
  const form = document.getElementById('contactForm');
  if (form) {
    const msg = document.getElementById('formMsg');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const to = form.dataset.to;
      const site = form.dataset.site || location.hostname;
      const name = form.name.value.trim();
      const email = form.email.value.trim();
      const phone = form.phone ? form.phone.value.trim() : '';
      const topic = form.topic.value;
      const body = form.message.value.trim() +
        '\n\n— ' + name + '\n' + email + (phone ? '\n' + phone : '') +
        '\n\nSent from the contact form on ' + site;
      const href = 'mailto:' + to +
        '?subject=' + encodeURIComponent(topic + ' — ' + name) +
        '&body=' + encodeURIComponent(body);
      window.location.href = href;
      msg.textContent = 'Your email app should open with the message ready to send. If it doesn\'t, write to ' + to + '.';
      msg.classList.add('show');
    });
  }

  // ---- product catalogue: filters ----
  const filterBar = document.getElementById('filters');
  if (filterBar) {
    const cards = Array.from(document.querySelectorAll('.pcard[data-cat]'));
    const apply = (cat) => {
      filterBar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
      cards.forEach(c => c.classList.toggle('hide', cat !== 'all' && c.dataset.cat !== cat));
    };
    filterBar.querySelectorAll('button').forEach(b => {
      const n = b.dataset.cat === 'all' ? cards.length : cards.filter(c => c.dataset.cat === b.dataset.cat).length;
      const ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = n; b.appendChild(ct);
      b.addEventListener('click', () => {
        apply(b.dataset.cat);
        history.replaceState(null, '', b.dataset.cat === 'all' ? location.pathname : '#' + b.dataset.cat);
      });
    });
    const fromHash = location.hash.replace('#', '');
    if (fromHash && filterBar.querySelector('[data-cat="' + fromHash + '"]')) apply(fromHash);
  }

  // ---- product catalogue: detail dialog ----
  const dlg = document.getElementById('productDialog');
  if (dlg) {
    const open = (card) => {
      const tpl = card.querySelector('template');
      dlg.querySelector('.pd-img').innerHTML = '';
      const img = card.querySelector('.pimg-wrap img');
      if (img) {
        const big = document.createElement('img');
        big.src = img.src; big.alt = img.alt;
        dlg.querySelector('.pd-img').appendChild(big);
      } else {
        dlg.querySelector('.pd-img').innerHTML = card.querySelector('.pimg-wrap').innerHTML;
      }
      dlg.querySelector('.pd-type').textContent = card.querySelector('.ptype').textContent;
      dlg.querySelector('.pd-name').textContent = card.querySelector('.pname').textContent;
      dlg.querySelector('.pd-body').innerHTML = tpl ? tpl.innerHTML : '';
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    };
    document.querySelectorAll('.pcard[data-cat]').forEach(card => {
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.addEventListener('click', () => open(card));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(card); }
      });
    });
    dlg.querySelector('.pd-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }

  // ---- YouTube grid ----
  // Put the video IDs in the data-videos attribute on #ytGrid, comma separated
  // (the part after "v=" in a YouTube link). Empty slots link to the channel.
  const yt = document.getElementById('ytGrid');
  if (yt) {
    const ids = (yt.dataset.videos || '').split(',').map(s => s.trim()).filter(Boolean);
    const channel = yt.dataset.channel;
    const slots = Math.max(3, ids.length);
    let html = '';
    for (let i = 0; i < slots; i++) {
      if (ids[i]) {
        html += '<div class="vcard reveal in"><iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/' +
          encodeURIComponent(ids[i]) + '" title="Kalimark video" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>';
      } else {
        html += '<a class="vcard empty reveal in" href="' + channel + '" target="_blank" rel="noopener">' +
          '<span class="play">▶</span><strong>Watch on YouTube</strong><small>Kalimark official</small></a>';
      }
    }
    yt.innerHTML = html;
  }

  // ---- footer year ----
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

});
