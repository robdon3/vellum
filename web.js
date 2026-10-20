/* Vellum web: the browser stand-in for the BlackBerry's Java bridge (window.VB).
   Settings and the config link live in this browser's localStorage only. */
(function () {
'use strict';
var LS = window.localStorage, R = {}, DEF = { city: 'New York, NY', lat: 40.7128, lon: -74.006, units: 'f', h24: false, rotate: 45, theme: 'dark', cfgApplied: 0 };
function get(k, d) { try { var v = LS.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
function put(k, v) { try { LS.setItem(k, v); return true; } catch (e) { return false; } }
function S() { var s = {}, o = {}; try { o = JSON.parse(get('vellum.s', '{}')) || {}; } catch (e) {} for (var k in DEF) s[k] = o.hasOwnProperty(k) ? o[k] : DEF[k]; return s; }
function saveS(s) { put('vellum.s', JSON.stringify(s)); }
function okUrl(u) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]{8,300}$/.test(u); }
function key(u) { return 'vc:' + u.replace(/[?&]_=\d+$/, ''); }

// one-time import of the config link from the address bar: ...#cfg=<url>
(function () {
  var m = (location.hash || '').match(/(?:^#|&)cfg=([^&]+)/);
  if (!m) return;
  var u = decodeURIComponent(m[1]);
  if (okUrl(u)) put('vellum.cfgUrl', u);
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
})();

function timeout(p, ms) { return new Promise(function (ok, no) { var t = setTimeout(function () { no(new Error('timeout')); }, ms); p.then(function (v) { clearTimeout(t); ok(v); }, function (e) { clearTimeout(t); no(e); }); }); }
function grab(u) { return timeout(fetch(u, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }), 20000).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }); }

window.VB = {
  settings: function () { return JSON.stringify(S()); },
  setPref: function (k, v) { var s = S(); if (k === 'theme' && (v === 'dark' || v === 'paper')) s.theme = v; if (k === 'rotate') s.rotate = +v || 0; saveS(s); },
  applyConfig: function (json) {        // values were validated by app.js; re-checked here
    var a = JSON.parse(json), s = S();
    if (a.rotate === 0 || (a.rotate >= 10 && a.rotate <= 3600)) s.rotate = a.rotate;
    if (a.theme === 'dark' || a.theme === 'paper') s.theme = a.theme;
    if (a.units === 'f' || a.units === 'c') s.units = a.units;
    if (typeof a.h24 === 'boolean') s.h24 = a.h24;
    if (typeof a.city === 'string' && a.city.length <= 40 && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180) { s.city = a.city; s.lat = a.lat; s.lon = a.lon; }
    if (a.version >= 1) s.cfgApplied = a.version;
    saveS(s);
  },
  cfgUrl: function () { var u = get('vellum.cfgUrl', ''); return okUrl(u) ? u : ''; },
  saveCfg: function (b) { if (b && b.length <= 16384) put('vellum.cfgJson', b); },
  loadCfg: function () { return VB.cfgUrl() ? get('vellum.cfgJson', '') : ''; },
  appVersion: function () { return '1.2'; },
  otaReady: function () { return ''; },
  tzOffset: function (tz) {
    try {
      var d = new Date(), s = d.toLocaleString('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      var m = s.match(/(\d+)\/(\d+)\/(\d+),? (\d+):(\d+)/), t = Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4] % 24, +m[5]);
      return Math.round((t - Math.floor(d.getTime() / 60000) * 60000) / 60000);
    } catch (e) { return -new Date().getTimezoneOffset(); }
  },
  cached: function (u) { var c = get(key(u), ''); if (!c) return ''; try { var o = JSON.parse(c); return JSON.stringify({ ok: true, cached: true, ts: o.ts, body: o.body }); } catch (e) { return ''; } },
  request: function (id, u, fb) {
    var done = function (o) { R[id] = JSON.stringify(o); window.Vellum.done(id); };
    grab(u).catch(function (e) { if (!fb) throw e; return grab(fb); }).then(function (body) {
      if (body.length < 600000) put(key(u), JSON.stringify({ ts: Date.now(), body: body }));
      done({ ok: true, cached: false, ts: Date.now(), body: body });
    }).catch(function (e) {
      var c = VB.cached(u); if (c) { var o = JSON.parse(c); o.err = String(e); done(o); } else done({ ok: false, err: String(e) });
    });
  },
  take: function (id) { var r = R[id]; delete R[id]; return r || ''; },
  insets: function () {
    var p = document.getElementById('insets'); if (!p) return [0, 0];
    var cs = getComputedStyle(p); return [parseFloat(cs.paddingTop) || 0, parseFloat(cs.paddingBottom) || 0];
  },
  fullscreen: function () {
    var d = document, e = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else if (e.requestFullscreen) e.requestFullscreen(); else if (e.webkitRequestFullscreen) e.webkitRequestFullscreen();
  },
  openSettings: function () { panel(true); }
};

/* ---------------------------------------------------------------- settings panel */
function el(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
var open = false;
function row(label, val, act) { return '<button class="srow" data-act="' + act + '"><span class="sl">' + label + '</span><span class="sv">' + val + '</span></button>'; }
function render(msg) {
  var s = S(), u = VB.cfgUrl();
  el('sett').innerHTML = '<div class="sbox"><div class="shd">SETTINGS<button class="sx" data-act="close">CLOSE \u00d7</button></div>' +
    '<div class="ssec">CONFIG LINK</div>' +
    '<div class="snote dim">' + (u ? 'Using your Vellum config. Pages, rotation, theme, location and markets follow it.' : 'Paste the config link once (this browser only). Without it Vellum shows its defaults.') + '</div>' +
    '<div class="sin"><input id="cfgin" type="url" autocomplete="off" spellcheck="false" placeholder="https://gist.githubusercontent.com/\u2026/raw/vellum-config.json" value="' + esc(u) + '">' +
    '<button data-act="savecfg">SAVE</button>' + (u ? '<button data-act="clearcfg">FORGET</button>' : '') + '</div>' +
    '<div class="ssec">THIS DEVICE</div>' +
    '<div class="sin"><input id="cityin" type="text" placeholder="Weather city, e.g. Boston" value=""><button data-act="city">SEARCH</button></div><div id="cities"></div>' +
    row('Location', esc(s.city), 'noop') + row('Units', s.units === 'f' ? '\u00b0F \u00b7 mph' : '\u00b0C \u00b7 km/h', 'units') +
    row('Clock', s.h24 ? '24-hour' : '12-hour', 'clock') + row('Auto-advance', s.rotate ? s.rotate + ' s' : 'off', 'rotate') +
    row('Theme', s.theme === 'paper' ? 'Paper (light)' : 'Ink (dark)', 'theme') +
    '<div class="snote dim">' + (msg ? esc(msg) : 'A new config version overrides changes made here.') + '</div>' +
    '<div class="snote dim">Keys: N/Space next \u00b7 P prev \u00b7 1\u20139 jump \u00b7 R refresh \u00b7 A hold \u00b7 T theme \u00b7 F full screen \u00b7 S settings. Swipe or tap the sides to flip pages.<br>Data: Open-Meteo, CNBC quotes, CoinGecko (optional), Wikipedia, Hacker News (Algolia). No accounts, no tracking.</div></div>';
}
function panel(on) { open = on; el('sett').style.display = on ? 'block' : 'none'; if (on) render(); }
function changed() { window.Vellum.settingsChanged(); render(); }
document.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!b || !open) return;
  var a = b.getAttribute('data-act'), s = S();
  if (a === 'close') panel(false);
  else if (a === 'savecfg') { var u = el('cfgin').value.replace(/^\s+|\s+$/g, ''); if (!okUrl(u)) { render('That doesn\u2019t look like an https link.'); return; } put('vellum.cfgUrl', u); location.reload(); }
  else if (a === 'clearcfg') { try { LS.removeItem('vellum.cfgUrl'); LS.removeItem('vellum.cfgJson'); } catch (x) {} location.reload(); }
  else if (a === 'units') { s.units = s.units === 'f' ? 'c' : 'f'; saveS(s); changed(); }
  else if (a === 'clock') { s.h24 = !s.h24; saveS(s); changed(); }
  else if (a === 'theme') { s.theme = s.theme === 'paper' ? 'dark' : 'paper'; saveS(s); changed(); }
  else if (a === 'rotate') { var o = [15, 30, 45, 90, 0], i = o.indexOf(s.rotate); s.rotate = o[(i + 1) % o.length]; saveS(s); changed(); }
  else if (a === 'city') {
    var q = el('cityin').value.replace(/^\s+|\s+$/g, ''); if (!q) return;
    grab('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=' + encodeURIComponent(q)).then(function (t) {
      var r = (JSON.parse(t).results || []), h = '';
      for (var k = 0; k < r.length; k++) {
        var reg = r[k].country_code === 'US' ? (r[k].admin1 || '') : (r[k].country || '');
        h += '<button class="srow" data-act="pick" data-n="' + esc(r[k].name + (reg ? ', ' + reg : '')).substr(0, 40) + '" data-la="' + r[k].latitude + '" data-lo="' + r[k].longitude + '"><span class="sl">' + esc(r[k].name) + '</span><span class="sv">' + esc((r[k].admin1 ? r[k].admin1 + ', ' : '') + (r[k].country || '')) + '</span></button>';
      }
      el('cities').innerHTML = h || '<div class="snote dim">No match.</div>';
    }).catch(function () { el('cities').innerHTML = '<div class="snote dim">Couldn\u2019t search (offline?).</div>'; });
  }
  else if (a === 'pick') { s.city = b.getAttribute('data-n'); s.lat = +b.getAttribute('data-la'); s.lon = +b.getAttribute('data-lo'); saveS(s); el('cities').innerHTML = ''; changed(); }
}, false);

/* ---------------------------------------------------------------- keys, mouse, visibility */
var KEYMAP = { ArrowRight: 'next', ArrowDown: 'next', ArrowLeft: 'prev', ArrowUp: 'prev', Enter: 'enter', ' ': 'next', Backspace: 'prev', PageDown: 'next', PageUp: 'prev' };
document.addEventListener('keydown', function (e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (open) { if (e.key === 'Escape') panel(false); return; }
  var k = KEYMAP[e.key] || (e.key && e.key.length === 1 ? e.key.toLowerCase() : null);
  if (e.key === 'Escape') k = 'h';
  if (!k || !window.Vellum) return;
  e.preventDefault(); window.Vellum.key(k);
}, false);
document.addEventListener('click', function (e) {
  if (open || e.target.closest && e.target.closest('#sett')) return;
  if (e.target.closest && e.target.closest('#hd')) { panel(true); return; }
  var w = window.innerWidth, x = e.clientX;
  window.Vellum.key(x > w * 0.6 ? 'next' : x < w * 0.4 ? 'prev' : 'h');
}, false);
document.addEventListener('visibilitychange', function () { if (window.Vellum) window.Vellum.visible(!document.hidden); }, false);
})();
