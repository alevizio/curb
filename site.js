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
  function links(list) {
    return list.map(function (x) {
      var a = on(x[0]);
      return '<a href="' + x[0] + '"' + (a ? ' class="sn-on" aria-current="page"' : '') + '>' + x[1] + '</a>';
    }).join('');
  }
  var chev = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var burgerIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var extLinks = '<hr><a href="' + GH + '" rel="noopener">Open source' + ext + '</a><a href="' + APP + '" rel="noopener">Get the app' + ext + '</a>';

  var nav =
    '<header class="sn-nav">' +
      '<div class="sn-mast">' +
        '<a class="sn-logo" href="/" aria-label="CURB — open the map"><img src="/icons/logo.svg" alt="" aria-hidden="true"></a>' +
        '<nav class="sn-links" aria-label="Pages">' + links(primary) +
          '<div class="sn-more">' +
            '<button class="sn-morebtn" type="button" aria-haspopup="true" aria-expanded="false">More ' + chev + '</button>' +
            '<div class="sn-pop" hidden>' + links(secondary) + extLinks + '</div>' +
          '</div>' +
        '</nav>' +
        '<a class="sn-cta sn-ghost" href="' + APP + '" rel="noopener">Download iOS app</a>' +
        '<a class="sn-cta" href="/">Open the map</a>' +
        '<button class="sn-burger" type="button" aria-label="Menu" aria-haspopup="true" aria-expanded="false">' + burgerIcon + '</button>' +
        '<div class="sn-menu" hidden>' + links(mapLink) + links(primary) + '<hr>' + links(secondary) + extLinks + '</div>' +
      '</div>' +
    '</header>';

  var foot =
    '<footer class="sn-foot">' +
      '<div class="sn-finner">' +
        '<div class="sn-fbrand">' +
          '<span class="sn-mark">CURB<span>.</span></span>' +
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
})();
