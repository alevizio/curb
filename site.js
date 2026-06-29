/* CURB — shared site chrome. Injects a consistent top nav (with a "More" dropdown) + footer into
   every back-of-map page, and wires the dropdown / mobile menu / active-state. One source of truth. */
(function () {
  if (window.__curbChrome) return; window.__curbChrome = 1;
  var path = location.pathname.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  var GH = 'https://github.com/alevizio/curb';
  var APP = 'https://apps.apple.com/us/app/curb-sf-street-parking/id6780998238';

  function on(href) {
    var h = href.replace(/\/+$/, '') || '/';
    if (h === '/') return path === '/';
    return path === h || path.indexOf(h + '/') === 0;
  }
  var ext = ' <span class="sn-ext">↗</span>';
  var mapLink = [['/', 'Map']];
  var primary = [['/n/', 'Neighborhoods'], ['/tickets', 'Tickets'], ['/about', 'About']];
  var secondary = [['/press', 'Press kit'], ['/changelog', 'Changelog'], ['/privacy', 'Privacy']];
  function svg(d, extra) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (extra || '') + '<path d="' + d + '"/></svg>'; }
  var IC = {
    '/': svg('M3 11.5 12 4l9 7.5M5 10v10h14V10'),
    '/n/': svg('M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z', '<circle cx="12" cy="10" r="2.5"/>'),
    '/tickets': svg('M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V7Z'),
    '/about': svg('M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM14 3v5h5'),
    '/press': svg('M3 11v2a1 1 0 0 0 1 1h2l9 4V6L6 10H4a1 1 0 0 0-1 1Z'),
    '/changelog': svg('M12 7.5V12l3 2', '<circle cx="12" cy="12" r="9"/>'),
    '/privacy': svg('M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10ZM9 12l2 2 4-4')
  };
  function links(list, ic) {
    return list.map(function (x) {
      var a = on(x[0]);
      return '<a href="' + x[0] + '"' + (a ? ' class="sn-on" aria-current="page"' : '') + '>' + (ic && IC[x[0]] ? IC[x[0]] : '') + '<span>' + x[1] + '</span></a>';
    }).join('');
  }
  var chev = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var burgerIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var extLinks = '<hr><a href="' + GH + '" rel="noopener">' + svg('m9 18-6-6 6-6M15 6l6 6-6 6') + '<span>Open source</span>' + ext + '</a><a href="' + APP + '" rel="noopener">' + svg('M11 18.5h2', '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/>') + '<span>Get the app</span>' + ext + '</a>';

  var nav =
    '<header class="sn-nav">' +
      '<div class="sn-mast">' +
        '<a class="sn-logo" href="/" aria-label="CURB — open the map"><img src="/icons/logo.svg" alt="" aria-hidden="true"></a>' +
        '<nav class="sn-links" aria-label="Pages">' + links(primary) +
          '<div class="sn-more">' +
            '<button class="sn-morebtn" type="button" aria-haspopup="true" aria-expanded="false">More ' + chev + '</button>' +
            '<div class="sn-pop" hidden>' + links(secondary, 1) + extLinks + '</div>' +
          '</div>' +
        '</nav>' +
        '<a class="sn-cta sn-ghost" href="' + APP + '" rel="noopener">Download iOS app</a>' +
        '<a class="sn-cta" href="/">Open the map</a>' +
        '<button class="sn-burger" type="button" aria-label="Menu" aria-haspopup="true" aria-expanded="false">' + burgerIcon + '</button>' +
        '<div class="sn-menu" hidden>' + links(mapLink, 1) + links(primary, 1) + '<hr>' + links(secondary, 1) + extLinks + '</div>' +
      '</div>' +
    '</header>';

  var foot =
    '<footer class="sn-foot">' +
      '<div class="sn-finner">' +
        '<div class="sn-fbrand">' +
          '<img class="sn-flogo" src="/icons/logo.svg" alt="CURB" width="48" height="48">' +
          '<p class="sn-ftag">Know where to park in San Francisco — block by block, including the part no sign tells you.</p>' +
          '<a class="sn-fapp" href="' + APP + '" rel="noopener">Download the iOS app' + ext + '</a>' +
        '</div>' +
        '<nav class="sn-fcol" aria-label="Explore"><h4>Explore</h4>' +
          '<a href="/">Map</a><a href="/n/">Neighborhoods</a><a href="/tickets">The ticket economy</a><a href="/about">About</a>' +
        '</nav>' +
        '<nav class="sn-fcol" aria-label="More"><h4>More</h4>' +
          '<a href="/press">Press kit</a><a href="/changelog">Changelog</a><a href="/privacy">Privacy</a>' +
          '<a href="' + GH + '/issues" rel="noopener">Report a bug</a>' +
        '</nav>' +
        '<nav class="sn-fcol" aria-label="Open"><h4>Open</h4>' +
          '<a href="' + GH + '" rel="noopener">Source on GitHub</a>' +
          '<a href="https://datasf.org" rel="noopener">Data: DataSF</a>' +
          '<a href="https://github.com/sponsors/alevizio" rel="noopener">♡ Sponsor</a>' +
        '</nav>' +
      '</div>' +
      '<div class="sn-fbar"><span class="sn-fine">The posted street sign is always the source of truth — temporary signs &amp; holidays override everything here. ' +
        'Free &amp; open source (MIT), no accounts, no ads, only anonymous page counts. Made in San Francisco, on public data — ' +
        'with thanks to <b>SF Public Works</b> &amp; <b>SFMTA</b> for the records behind it.</span></div>' +
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
