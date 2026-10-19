/* CURB · French on a city page that offers it (Montréal: city.json `languages`, scripts/cities/city-page.mjs).
   The page is built in English from index.html; this layer translates what it shows, text and labels, once the page
   has drawn and then as it changes (a MutationObserver). Fixed strings come from EXACT, sentences inside longer text
   from PHRASES (the city's own words are added by the page), and the phrases the page builds (times, dates,
   countdowns, sides, weeks) from RULES. The map's tiles and curb lines are left alone. Switching language reloads
   the page (the ⓘ menu's language item); the choice is kept in localStorage, else the browser's language decides. */
(function (root) {
  'use strict';
  const DOW = { Sun: 'dim.', Mon: 'lun.', Tue: 'mar.', Wed: 'mer.', Thu: 'jeu.', Fri: 'ven.', Sat: 'sam.' };
  const DOW_UP = { SUN: 'DIM', MON: 'LUN', TUE: 'MAR', WED: 'MER', THU: 'JEU', FRI: 'VEN', SAT: 'SAM' };
  const DAY_LONG = { Sunday: 'dimanche', Monday: 'lundi', Tuesday: 'mardi', Wednesday: 'mercredi', Thursday: 'jeudi', Friday: 'vendredi', Saturday: 'samedi' };
  const MON = { Jan: 'janv.', Feb: 'févr.', Mar: 'mars', Apr: 'avr.', May: 'mai', Jun: 'juin', Jul: 'juil.', Aug: 'août', Sep: 'sept.', Oct: 'oct.', Nov: 'nov.', Dec: 'déc.' };
  const MONTH = { January: 'janvier', February: 'février', March: 'mars', April: 'avril', May: 'mai', June: 'juin', July: 'juillet',
    August: 'août', September: 'septembre', October: 'octobre', November: 'novembre', December: 'décembre' };
  const SIDE = { Northeast: 'nord-est', Northwest: 'nord-ouest', Southeast: 'sud-est', Southwest: 'sud-ouest', North: 'nord', South: 'sud', East: 'est', West: 'ouest' };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const de = (w) => (/^[aeiouyéèêàâîôûh]/i.test(w) ? 'd’' : 'de ') + w;   // "d’avril", "de mars"
  // 8AM → 8 h, 12:30PM → 12 h 30, 12AM → 0 h
  const clock = (h, m, ap) => { const H = (+h % 12) + (/p/i.test(ap) ? 12 : 0); return H + ' h' + (m ? ' ' + m : ''); };

  const EXACT = {
    // menu
    'Sweep alerts': 'Alertes', 'Street cleaning by Montréal neighborhood': 'Le nettoyage par arrondissement', 'None on yet': 'Aucune pour l’instant', 'How CURB works': 'Comment fonctionne CURB',
    'Curb colors, sweeping & alerts': 'Couleurs, nettoyage et alertes', 'Neighborhoods': 'Arrondissements',
    'About CURB': 'À propos de CURB', 'What it does & data sources': 'Ce que fait CURB, et ses données', 'Share': 'Partager',
    'Feedback': 'Commentaires', 'Rate': 'Évaluer', 'Open source': 'Code ouvert', 'Privacy': 'Confidentialité',
    'Get the iOS app': 'Obtenir l’app iOS', 'CURB on the App Store': 'CURB sur l’App Store',
    'Montréal open data': 'Données ouvertes de Montréal', 'Montréal\'s open data': 'les données ouvertes de Montréal',
    'Free & open source. Built on Montréal open data. The posted sign is always the final word.': 'Gratuit et ouvert. Fait avec les données ouvertes de Montréal. Le panneau sur place a toujours le dernier mot.',
    // top bar, chips, legend, layers
    'All': 'Tous', 'Layers': 'Couches', 'Map details': 'Détails de la carte', 'Permit zones': 'Zones de permis', 'Loading zones': 'Zones de livraison',
    'Meters': 'Parcomètres', 'Beta': 'Bêta', 'Truck routes': 'Trajets des balais', 'Permit areas': 'Secteurs de permis', 'Truck route': 'Trajet du balai',
    'Clear': 'Libre', 'Soon · within 24h': 'Bientôt · moins de 24 h', 'Now · under 3h': 'Maintenant · moins de 3 h',
    'Find your spot': 'Trouvez votre place', 'Tap locate, search a street, or tap the map where you parked.': 'Touchez Localiser, cherchez une rue ou touchez la carte là où vous êtes stationné.',
    'New here? What CURB does →': 'Nouveau? Ce que fait CURB →',
    // welcome card
    'A preview': 'Un aperçu', ', built on the City\'s open data.': ', fait avec les données ouvertes de la Ville.', 'clear': 'libre', 'sweeps soon': 'nettoyage bientôt',
    'move it now': 'déplacez l’auto', 'Show me the map': 'Voir la carte', 'How it works →': 'Comment ça marche →',
    'Street cleaning by neighborhood': 'Le nettoyage par arrondissement', 'Free, no account. Built on': 'Gratuit, sans compte. Fait avec',
    '. The posted sign always wins.': '. Le panneau sur place a toujours raison.',
    'CURB didn\'t load': 'CURB n’a pas chargé', 'Part of the map didn\'t download. Check your connection and try again.': 'Une partie de la carte n’a pas été téléchargée. Vérifiez votre connexion et réessayez.',
    'Try again': 'Réessayer',
    // iPhone: Home Screen
    'Get sweep alerts': 'Recevoir les alertes', 'Get the free iPhone app': 'Obtenir l’app iPhone gratuite',
    'Add this map to your Home Screen to get alerts on iPhone:': 'Ajoutez cette carte à votre écran d’accueil pour recevoir les alertes sur iPhone :',
    'Tap the': 'Touchez', 'button': '', 'in Safari\'s toolbar': 'dans la barre d’outils de Safari', 'Choose': 'Choisissez', 'Add to Home Screen': 'Sur l’écran d’accueil',
    'Open CURB from its new icon, then tap': 'Ouvrez CURB depuis sa nouvelle icône, puis touchez', '🔔 Sweep alerts': '🔔 Alertes',
    'Already a Home Screen app? Make sure you opened it from the icon (not Safari), then try again.': 'Déjà sur l’écran d’accueil? Ouvrez-la depuis l’icône (pas Safari), puis réessayez.',
    'On this device': 'Sur cet appareil',
    // sheet
    'That\'s this curb\'s verdict. 🔔 Sweep alerts pings you ~30 min before the truck.': 'Voilà le verdict pour cette bordure. 🔔 Les alertes vous préviennent environ 30 min avant le balai.',
    'Park until': 'Stationnez jusqu’à', 'Metered': 'Parcomètre', 'Calendar': 'Calendrier', 'Google Calendar': 'Google Agenda', 'Turn off alerts': 'Désactiver les alertes',
    'Keep them on': 'Les garder', 'Alert style': 'Style des alertes', 'Customize ▸': 'Personnaliser ▸', 'Intensity': 'Intensité', 'Light': 'Légère',
    'Normal': 'Normale', 'Intense': 'Intense', 'Voice': 'Ton', 'Cheeky': 'Taquin', 'Drill': 'Sergent', 'Deadpan': 'Pince-sans-rire', 'Send me a test': 'M’envoyer un test',
    'The': 'Le', 'posted sign': 'panneau sur place', 'wins. Temporary signs & holidays override.': 'a raison. Les panneaux temporaires et les fériés priment.',
    'Data notes ▸': 'Notes sur les données ▸', 'Doesn\'t match the posted sign?': 'Ça ne correspond pas au panneau?', 'Report a fix →': 'Signaler une correction →',
    'Other side': 'Autre côté', 'STREET CLEANING': 'NETTOYAGE', 'see posted sign': 'voir le panneau', 'Odd side': 'Côté impair', 'Even side': 'Côté pair',
    'Sweep alerts are on': 'Alertes activées', '✓ Alerts on': '✓ Alertes activées',
    // alerts panel
    'Your curbs': 'Vos bordures', 'No alerts on yet.': 'Aucune alerte pour l’instant.', 'Tap the curb where you parked, then': 'Touchez la bordure où vous êtes stationné, puis',
    '. You can have alerts on for up to 5 curbs.': '. Vous pouvez activer les alertes pour 5 bordures au plus.', 'Night before + 30 min before': 'La veille + 30 min avant',
    'Warm, funny, on your side': 'Chaleureux, drôle, de votre côté', 'Not getting alerts? ▸': 'Pas d’alertes? ▸',
    'Allow notifications for curb.guide in this browser\'s site settings.': 'Autorisez les notifications de curb.guide dans les réglages du site de ce navigateur.',
    'A Focus or Do Not Disturb mode holds alerts back.': 'Un mode Concentration ou Ne pas déranger retient les alertes.',
    'Send yourself a test above. It should arrive within a few seconds.': 'Envoyez-vous un test ci-dessus. Il devrait arriver en quelques secondes.',
    'Show on map': 'Voir sur la carte', 'Turn off': 'Désactiver', 'Turn off all': 'Tout désactiver', 'No sweep coming up here.': 'Aucun nettoyage à venir ici.',
    'Loading the schedule…': 'Chargement de l’horaire…',
    // map and labels
    '© OpenStreetMap contributors, © Protomaps': '© les contributeurs d’OpenStreetMap, © Protomaps',
    'Montréal street cleaning map: sweeping schedules by block (a CURB preview)': 'Carte du nettoyage des rues de Montréal : les horaires par tronçon (un aperçu de CURB)',
    // toasts
    'Alert style saved': 'Style des alertes enregistré', 'Back online. Refreshing.': 'De retour en ligne. Actualisation.', 'Found you.': 'Vous voilà.',
    'Link copied.': 'Lien copié.', 'Link copied. Text it to a friend.': 'Lien copié. Envoyez-le à quelqu’un.', 'Link copied. Text it to whoever asked.': 'Lien copié.',
    'Search failed. Try again.': 'La recherche a échoué. Réessayez.', 'No upcoming sweep on this side to alert on.': 'Aucun nettoyage à venir de ce côté.',
    'Could not send a test. Try again.': 'Le test n’a pas été envoyé. Réessayez.', 'Could not send a test.': 'Le test n’a pas été envoyé.',
    'Allow notifications to get move-your-car alerts.': 'Autorisez les notifications pour recevoir les alertes.', 'Allow notifications to feel a test.': 'Autorisez les notifications pour recevoir un test.',
    'Notifications are blocked. Re-enable them in your browser settings, then retry.': 'Les notifications sont bloquées. Réactivez-les dans les réglages du navigateur, puis réessayez.',
    'Notifications are blocked. Re-enable them to test.': 'Les notifications sont bloquées. Réactivez-les pour tester.',
    'This browser does not support push alerts. Use Calendar instead.': 'Ce navigateur ne reçoit pas d’alertes. Utilisez le calendrier.',
    'Test sent. Check your notifications. 🔔': 'Test envoyé. Regardez vos notifications. 🔔', 'Sending a test. Check your lock screen. 🔔': 'Envoi du test. Regardez votre écran verrouillé. 🔔',
    'Reminder downloaded. Open it to add to your calendar.': 'Rappel téléchargé. Ouvrez-le pour l’ajouter à votre calendrier.',
    'All matching curb colors are hidden. Re-show them in the legend (bottom left).': 'Les couleurs voulues sont masquées. Réaffichez-les dans la légende (en bas à gauche).',
    'Couldn\'t load the curbs. Pan and try again.': 'Les bordures n’ont pas chargé. Déplacez la carte et réessayez.',
    'No street-sweeping schedule here. This preview covers Montréal.': 'Pas d’horaire de nettoyage ici. Cet aperçu couvre Montréal.',
    'Alerts are off on this device. Tap Sweep alerts on a curb to turn them back on.': 'Les alertes sont désactivées sur cet appareil. Touchez Alertes sur une bordure pour les réactiver.',
    'Alerts are off on this device. Tap Sweep alerts to turn them back on.': 'Les alertes sont désactivées sur cet appareil. Touchez Alertes pour les réactiver.',
  };
  // attributes (placeholder, aria-label, title, data-tip)
  const ATTR = {
    'Montréal parking map': 'Carte du stationnement à Montréal', 'Map': 'Carte', 'Zoom in': 'Zoom avant', 'Zoom out': 'Zoom arrière',
    'About CURB: what the colors mean': 'À propos de CURB : ce que veulent dire les couleurs', 'Search a street…': 'Chercher une rue…',
    'Use my location': 'Utiliser ma position', 'Search suggestions': 'Suggestions', 'Sweep alerts, info and other pages': 'Alertes, infos et autres pages',
    'Alerts, guide & about': 'Alertes, guide et à propos', 'Info and pages': 'Infos et pages', 'More actions': 'Plus d’actions',
    'Filter by sweep day': 'Filtrer par jour de nettoyage', 'Show only today\'s sweeping': 'Seulement le nettoyage d’aujourd’hui',
    'Map layers': 'Couches de la carte', 'Map layers & permit areas': 'Couches de la carte', 'Map layers and legend': 'Couches et légende', 'Close': 'Fermer',
    'Map legend': 'Légende', 'Tap to show / hide': 'Toucher pour afficher ou masquer', 'Welcome to CURB': 'Bienvenue sur CURB',
    'Street cleaning by neighborhood': 'Le nettoyage par arrondissement', 'Parking details for this block': 'Le stationnement sur ce tronçon',
    'Expand details': 'Plus de détails', 'Share this block': 'Partager ce tronçon', 'Center map on this block': 'Centrer la carte sur ce tronçon',
    'Center on this block': 'Centrer sur ce tronçon', 'Alert intensity': 'Intensité des alertes', 'Alert voice': 'Ton des alertes',
    'A JavaScript library for interactive maps': 'Une bibliothèque JavaScript de cartes interactives',
    'Metered curb: pay at the meter; it shows the hours & rates': 'Parcomètre : payez à la borne, qui indique les heures et les tarifs',
  };
  const PHRASES = [];   // [english, french] sentences found inside longer text; the page adds the city's words

  const DOWS = 'Sun|Mon|Tue|Wed|Thu|Fri|Sat', MONS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
  const MONTHS_RE = 'January|February|March|April|May|June|July|August|September|October|November|December';
  const RULES = [
    // sign badges, uppercase: "8 TO 9AM", "12:30 TO 1:30PM"
    [/\b(\d{1,2})(?::(\d{2}))? TO (\d{1,2})(?::(\d{2}))?(AM|PM)\b/g, (_, a, b, c, d, ap) => (clock(a, b, ap) + ' À ' + clock(c, d, ap)).toUpperCase()],
    [/\b(SUN|MON|TUE|WED|THU|FRI|SAT)\b/g, (_, d) => DOW_UP[d]],
    // windows: "7AM to 8AM", night "12 to 2 AM"
    [/\b(\d{1,2})(?::(\d{2}))?(AM|PM) to (\d{1,2})(?::(\d{2}))?(AM|PM)\b/g, (_, a, b, ap, c, d, ap2) => clock(a, b, ap) + ' à ' + clock(c, d, ap2)],
    [/\b(\d{1,2})(?::(\d{2}))? to (\d{1,2})(?::(\d{2}))? (AM|PM)\b/g, (_, a, b, c, d, ap) => clock(a, b, ap) + ' à ' + clock(c, d, ap)],
    [/\b(\d{1,2})(?::(\d{2}))?\s?(AM|PM)\b/g, (_, a, b, ap) => clock(a, b, ap)],
    // dates: "Sun Oct 18", "Tue 10/20" (month/day → day/month), "Mon night 10/5"
    [new RegExp(`\\b(${DOWS}) (${MONS}) (\\d{1,2})\\b`, 'g'), (_, d, m, n) => DOW[d] + ' ' + n + ' ' + MON[m]],
    [new RegExp(`\\b(${DOWS}) night (\\d{1,2})/(\\d{1,2})\\b`, 'g'), (_, d, m, n) => DOW[d] + ' soir ' + n + '/' + m],
    [new RegExp(`\\b(${DOWS}) (\\d{1,2})/(\\d{1,2})\\b`, 'g'), (_, d, m, n) => DOW[d] + ' ' + n + '/' + m],
    [new RegExp(`\\b(${DOWS}) night\\b`, 'g'), (_, d) => DOW[d] + ' soir'],
    [new RegExp(`\\b(${DOWS})\\b`, 'g'), (_, d) => DOW[d]],
    [/\bToday\b/g, 'Aujourd’hui'],
    // countdowns and frequency
    [/\bin <1 hr\b/g, 'dans moins d’une heure'], [/\bin (\d+) hr\b/g, 'dans $1 h'], [/\bin (\d+) days\b/g, 'dans $1 jours'],
    [/\btomorrow night\b/g, 'demain soir'], [/\btonight\b/g, 'ce soir'], [/\btomorrow\b/g, 'demain'], [/\btoday\b/g, 'aujourd’hui'],
    [/^Sweeping now · until /, 'Nettoyage en cours · jusqu’à '],
    [/\bevery week\b/g, 'chaque semaine'], [/\b1st\b/g, '1re'], [/\b2nd\b/g, '2e'], [/\b3rd\b/g, '3e'], [/\b4th\b/g, '4e'], [/\b5th\b/g, '5e'], [/ & /g, ' et '],
    // season: "Swept April to November."
    [new RegExp(`^Swept (${MONTHS_RE}) to (${MONTHS_RE})\\.`), (_, a, b) => 'Nettoyage ' + de(MONTH[a]) + ' à ' + MONTH[b] + '.'],
    // sides: "East · every week", "Switch to the East side"
    [/^Switch to the (\w+) side$/, (_, s) => 'Passer au côté ' + (SIDE[s] || s.toLowerCase())],
    [/^(Northeast|Northwest|Southeast|Southwest|North|South|East|West)( ·|$)/, (_, s, rest) => cap(SIDE[s]) + rest],
    // house numbers and cross streets: "500 to 555", "· rue A to avenue B"
    [/^(\d+) to (\d+)$/, '$1 à $2'], [/^· (.+) to (.+)$/, '· $1 à $2'],
    // the alerts panel
    [/^(\d+) of (\d+)$/, '$1 sur $2'], [/^Next sweep /, 'Prochain nettoyage '], [/^Pings you /, 'Alerte '], [/ and (?=\d|lun|mar|mer|jeu|ven|sam|dim|demain)/g, ' et '],
    [/^In ([^.]+)\. Its next sweep shows on that map\.$/, 'À $1. Son prochain nettoyage est sur cette carte-là.'], [/^Open the (.+) map$/, 'Ouvrir la carte de $1'],
    // toasts with values
    [/^Sweep alert set for /, 'Alerte activée pour '], [/^Alerts off for /, 'Alertes désactivées pour '], [/^Could not enable alerts: /, 'Les alertes n’ont pas été activées : '],
    [/^No swept street matched "(.+)"\.$/, 'Aucune rue nettoyée ne correspond à « $1 ».'],
    [new RegExp(`^~([\\d,]+) Montréal blocks are swept on (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)s\\. The colored ones are the blocks to move off\\.$`),
      (_, n, d) => '~' + n.replace(/,/g, ' ') + ' tronçons de Montréal sont nettoyés le ' + DAY_LONG[d] + '. Ceux en couleur sont ceux à libérer.'],
  ];

  function fr(text) {
    const lead = text.match(/^\s*/)[0], tail = text.match(/\s*$/)[0], core = text.trim();
    if (!core) return text;
    if (Object.prototype.hasOwnProperty.call(EXACT, core)) return lead + EXACT[core] + tail;
    let s = core;
    for (const [en, f] of PHRASES) if (s.includes(en)) s = s.split(en).join(f);
    for (const [re, rep] of RULES) s = s.replace(re, rep);
    return lead + s + tail;
  }
  const skip = (el) => !el || el.closest('script,style,noscript,.leaflet-tile-pane,[data-no-i18n]');
  const done = new WeakMap();   // node → the French it was given, so a re-render of the same text is translated again
  function translateText(n) {
    if (skip(n.parentElement)) return;
    if (done.get(n) === n.data) return;
    const t = fr(n.data);
    if (t !== n.data) n.data = t;
    done.set(n, n.data);
  }
  function translateAttrs(el) {
    if (skip(el)) return;
    for (const a of ['placeholder', 'aria-label', 'title', 'data-tip']) {
      const v = el.getAttribute(a);
      if (v && Object.prototype.hasOwnProperty.call(ATTR, v.trim())) el.setAttribute(a, ATTR[v.trim()]);
      // labels built with a value ("Switch to the East side") go through the rules; any other label is left as it is
      else if (v && /\b(side|block|curb)\b/.test(v)) { const t = fr(v); if (t !== v) el.setAttribute(a, t); }
    }
  }
  function translateTree(rootEl) {
    if (rootEl.nodeType === 3) { translateText(rootEl); return; }
    if (rootEl.nodeType !== 1) return;
    translateAttrs(rootEl);
    const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) translateText(n); else translateAttrs(n); }
  }

  function langOf() {
    let v = ''; try { v = localStorage.getItem('curbLang') || ''; } catch (_) {}
    if (v === 'fr' || v === 'en') return v;
    return /^fr\b/i.test(navigator.language || '') ? 'fr' : 'en';
  }
  function setLang(v) { try { localStorage.setItem('curbLang', v); } catch (_) {} location.reload(); }

  function startI18n(words) {
    for (const [en, f] of words || []) if (en && f) PHRASES.push([en, f]);
    PHRASES.sort((a, b) => b[0].length - a[0].length);
    const lang = langOf();
    if (lang === 'fr') document.documentElement.lang = 'fr';
    const run = () => {
      // the ⓘ menu's language item names the other language, in that language
      const item = document.getElementById('imLang');
      if (item) {
        const b = item.querySelector('.im-tx b'), s = item.querySelector('.im-tx small');
        if (b) b.textContent = lang === 'fr' ? 'English' : 'Français';
        if (s) s.textContent = lang === 'fr' ? 'See the map in English' : 'Voir la carte en français';
        item.onclick = () => setLang(lang === 'fr' ? 'en' : 'fr');
      }
      if (lang !== 'fr') return;
      translateTree(document.body);
      new MutationObserver((list) => {
        for (const m of list) {
          if (m.type === 'characterData') translateText(m.target);
          else if (m.type === 'attributes') translateAttrs(m.target);
          else for (const n of m.addedNodes) translateTree(n);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title', 'data-tip'] });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  }

  Object.assign(root, { CURB_FR: { fr, startI18n } });
})(typeof globalThis !== 'undefined' ? globalThis : this);
