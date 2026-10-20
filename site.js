/* CURB — shared site chrome. Injects a consistent top nav (with a "More" dropdown) + footer into
   every back-of-map page, and wires the dropdown / mobile menu / active-state. One source of truth. */
(function () {
  if (window.__curbChrome) return; window.__curbChrome = 1;
  // The Android app's status bar is cream like the page, as on the map (index.html): Chrome colors it from this tag.
  try {
    if (document.referrer.indexOf('android-app://guide.curb.android') === 0 || sessionStorage.getItem('curbAndroidApp') === '1') {
      var tc = document.querySelector('meta[name="theme-color"]');
      if (!tc) { tc = document.createElement('meta'); tc.name = 'theme-color'; document.head.appendChild(tc); }
      tc.content = '#F2ECDF';
    }
  } catch (e) {}
  // Vercel Speed Insights — anonymous real-user web vitals (no cookies); served by Vercel at the edge.
  // Injected here so every back-of-map page (incl. generated /n/ pages) gets it from one source.
  if (!window.si) {
    window.si = function () { (window.siq = window.siq || []).push(arguments); };
    var siEl = document.createElement('script');
    siEl.defer = true; siEl.src = '/_vercel/speed-insights/script.js';
    document.head.appendChild(siEl);
  }
  var path = location.pathname.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  var GH = 'https://github.com/alevizio/curb';
  var APP = 'https://apps.apple.com/us/app/curb-sf-street-parking/id6780998238';
  // The Boston preview's pages (/boston/…, scripts/cities/boston-pages.mjs) get Boston's links; the iOS app is SF only.
  var BOS = path === '/boston' || path.indexOf('/boston/') === 0;
  var HOME = BOS ? '/boston' : '/';

  function on(href) {
    var h = href.replace(/\/+$/, '') || '/';
    if (h === '/' || h === '/boston') return path === h;
    return path === h || path.indexOf(h + '/') === 0;
  }
  var ext = ' <span class="sn-ext">↗</span>';
  var mapLink = [[HOME, 'Map']];
  var primary = BOS ? [['/boston/about', 'How it works'], ['/boston/fixes', 'Map fixes'], ['/boston/about#holidays', 'Holidays']]
    : [['/n/', 'Neighborhoods'], ['/tickets', 'Tickets'], ['/about', 'About']];
  var secondary = BOS ? [['/about', 'About CURB'], ['/', 'San Francisco map'], ['/privacy', 'Privacy']]
    : [['/holidays', 'Sweeping holidays'], ['/support', 'Support'], ['/press', 'Press kit'], ['/changelog', 'Changelog'], ['/privacy', 'Privacy']];
  function svg(d, extra) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (extra || '') + '<path d="' + d + '"/></svg>'; }
  var IC = {
    '/': svg('M3 11.5 12 4l9 7.5M5 10v10h14V10'),
    '/boston/fixes': svg('m14.7 6.3 3 3M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z'),
    '/holidays': svg('M3.5 9.5h17M8 3v4M16 3v4', '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/>'),
    '/support': svg('M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54Z'),
    '/n/': svg('M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z', '<circle cx="12" cy="10" r="2.5"/>'),
    '/tickets': svg('M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V7Z'),
    '/about': svg('M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM14 3v5h5'),
    '/press': svg('M3 11v2a1 1 0 0 0 1 1h2l9 4V6L6 10H4a1 1 0 0 0-1 1Z'),
    '/changelog': svg('M12 7.5V12l3 2', '<circle cx="12" cy="12" r="9"/>'),
    '/privacy': svg('M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10ZM9 12l2 2 4-4')
  };
  IC['/boston'] = IC['/']; IC['/boston/about'] = IC['/about']; IC['/boston/about#holidays'] = IC['/holidays'];
  function links(list, ic) {
    return list.map(function (x) {
      var a = on(x[0]);
      return '<a href="' + x[0] + '"' + (a ? ' class="sn-on" aria-current="page"' : '') + '>' + (ic && IC[x[0]] ? IC[x[0]] : '') + '<span>' + x[1] + '</span></a>';
    }).join('');
  }
  var chev = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var burgerIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var extLinks = '<hr><a href="' + GH + '" rel="noopener">' + svg('m9 18-6-6 6-6M15 6l6 6-6 6') + '<span>Open source</span>' + ext + '</a>'
    + (BOS ? '' : '<a href="' + APP + '" rel="noopener">' + svg('M11 18.5h2', '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/>') + '<span>Get the app</span>' + ext + '</a>');

  var nav =
    '<header class="sn-nav">' +
      '<div class="sn-mast">' +
        '<a class="sn-logo" href="' + HOME + '" aria-label="CURB — open the map"><img src="/icons/logo.svg" alt="" aria-hidden="true"></a>' +
        '<nav class="sn-links" aria-label="Pages">' + links(primary) +
          '<div class="sn-more">' +
            '<button class="sn-morebtn" type="button" aria-haspopup="true" aria-expanded="false">More ' + chev + '</button>' +
            '<div class="sn-pop" hidden>' + links(secondary, 1) + extLinks + '</div>' +
          '</div>' +
        '</nav>' +
        (BOS ? '' : '<a class="sn-cta sn-ghost" href="' + APP + '" rel="noopener">Download iOS app</a>') +
        '<a class="sn-cta" href="' + HOME + '">Open the map</a>' +
        '<button class="sn-burger" type="button" aria-label="Menu" aria-haspopup="true" aria-expanded="false">' + burgerIcon + '</button>' +
        '<div class="sn-menu" hidden>' + links(mapLink, 1) + links(primary, 1) + '<hr>' + links(secondary, 1) + extLinks + '</div>' +
      '</div>' +
    '</header>';

  var F = BOS ? {
    tag: 'Know where to park in Boston, block by block. A preview of CURB, built on the City of Boston\'s open data.',
    app: '',
    explore: '<a href="/boston">Map</a><a href="/boston/about">How it works</a><a href="/boston/about#holidays">Sweeping holidays</a><a href="/boston/fixes">Map fixes</a>',
    more: '<a href="/about">About CURB</a><a href="/">San Francisco map</a><a href="/privacy">Privacy</a>',
    data: '<a href="https://data.boston.gov" rel="noopener">Data: Analyze Boston</a>',
    fine: 'The posted street sign is always the source of truth: temporary signs &amp; holidays override everything here. ' +
      'Free &amp; open source (MIT), no accounts, no ads, no cookies. Built on public data from the City of Boston: ' +
      '<b>Public Works</b>\' sweeping schedules, the City\'s street centerlines and the <b>Curb Lab</b>\'s curb signs.'
  } : {
    tag: 'Know where to park in San Francisco — block by block, including the part no sign tells you.',
    app: '<a class="sn-fapp" href="' + APP + '" rel="noopener">Download the iOS app' + ext + '</a>',
    explore: '<a href="/">Map</a><a href="/n/">Neighborhoods</a><a href="/holidays">Sweeping holidays</a><a href="/tickets">The ticket economy</a><a href="/about">About</a>',
    more: '<a href="/support">Support CURB</a><a href="/press">Press kit</a><a href="/changelog">Changelog</a><a href="/privacy">Privacy</a>',
    data: '<a href="https://datasf.org" rel="noopener">Data: DataSF</a>',
    fine: 'The posted street sign is always the source of truth — temporary signs &amp; holidays override everything here. ' +
      'Free &amp; open source (MIT), no accounts, no ads, no cookies. Made in San Francisco, on public data — ' +
      'with thanks to <b>SF Public Works</b> &amp; <b>SFMTA</b> for the records behind it.'
  };
  var foot =
    '<footer class="sn-foot">' +
      '<div class="sn-finner">' +
        '<div class="sn-fbrand">' +
          '<img class="sn-flogo" src="/icons/logo.svg" alt="CURB" width="48" height="48">' +
          '<p class="sn-ftag">' + F.tag + '</p>' + F.app +
        '</div>' +
        '<nav class="sn-fcol" aria-label="Explore"><h4>Explore</h4>' + F.explore + '</nav>' +
        '<nav class="sn-fcol" aria-label="More"><h4>More</h4>' + F.more +
          '<a href="' + GH + '/issues" rel="noopener">Report a bug</a>' +
        '</nav>' +
        '<nav class="sn-fcol" aria-label="Open"><h4>Open</h4>' +
          '<a href="' + GH + '" rel="noopener">Source on GitHub</a>' + F.data +
        '</nav>' +
      '</div>' +
      '<div class="sn-fbar"><span class="sn-fine">' + F.fine + '</span></div>' +
    '</footer>';

  document.body.insertAdjacentHTML('afterbegin', nav);
  document.body.insertAdjacentHTML('beforeend', foot);

  var moreBtn = document.querySelector('.sn-morebtn'), pop = document.querySelector('.sn-pop');
  var burger = document.querySelector('.sn-burger'), menu = document.querySelector('.sn-menu');
  function set(btn, panel, open) { panel.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  function closeAll() { set(moreBtn, pop, false); set(burger, menu, false); }
  moreBtn.addEventListener('click', function (e) { e.stopPropagation(); var o = pop.hidden; closeAll(); set(moreBtn, pop, o); });
  burger.addEventListener('click', function (e) { e.stopPropagation(); var o = menu.hidden; closeAll(); set(burger, menu, o); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.sn-more,.sn-burger,.sn-menu')) closeAll(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

  // reveal on scroll-up, hide on scroll-down (always shown near the top / when a menu is open)
  var navEl = document.querySelector('.sn-nav');
  var lastY = window.pageYOffset, tick = false;
  window.addEventListener('scroll', function () {
    if (tick) return; tick = true;
    requestAnimationFrame(function () {
      var y = window.pageYOffset;
      if (pop.hidden && menu.hidden && y > 90 && y > lastY + 4) navEl.classList.add('sn-hide');
      else if (y < lastY - 4 || y < 90) navEl.classList.remove('sn-hide');
      lastY = y; tick = false;
    });
  }, { passive: true });
})();
