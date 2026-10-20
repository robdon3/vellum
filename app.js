/* Vellum web (iPhone Home Screen / Mac browser). Same faces as Vellum for BlackBerry; data straight from CORS-friendly keyless APIs. */
(function () {
'use strict';
var VB = window.MOCKVB || window.VB;
var $ = function (id) { return document.getElementById(id); };
var DEFAULT_FACES = ['clock', 'weather', 'markets', 'headlines', 'hackernews', 'onthisday'];
var FACES = DEFAULT_FACES.slice();
var LABEL = { clock: 'TIME', weather: 'WEATHER', markets: 'MARKETS', headlines: 'HEADLINES', hackernews: 'HACKER NEWS', onthisday: 'ON THIS DAY', custom: 'NOTE' };
var ALIAS = { clock: 'clock', weather: 'weather', markets: 'markets', news: 'headlines', headlines: 'headlines', hn: 'hackernews', hackernews: 'hackernews', otd: 'onthisday', onthisday: 'onthisday', custom: 'custom' };
/* Remote display config (secret gist). Read as data only; every field is validated and length-limited. */
var CFG_URL = VB.cfgUrl();   // pasted once in Settings (localStorage); never shipped in the page
var CFG = null, cfgInflight = false, cfgLast = 0;
var MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var DAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var CITIES = [['Los Angeles','America/Los_Angeles'],['London','Europe/London'],['Paris','Europe/Paris'],
              ['Dubai','Asia/Dubai'],['Tokyo','Asia/Tokyo'],['Sydney','Australia/Sydney']];
var S = {}, cur = 0, paused = false, lastFlip = Date.now(), visible = true, reqN = 0, pending = {};
var src = {};   // name -> {data, ts, offline, err, inflight, url}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function clip(s, n) { s = String(s || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); return s.length > n ? s.substr(0, n - 1).replace(/[\s,;:.-]+\S*$/, '') + '\u2026' : s; }
function fmtTime(d, withAp) {
  var h = d.getHours(), m = d.getMinutes();
  if (S.h24) return pad(h) + ':' + pad(m);
  var ap = h < 12 ? 'AM' : 'PM'; h = h % 12; if (!h) h = 12;
  return h + ':' + pad(m) + (withAp ? ' ' + ap : '');
}
function hm(h, m) {
  if (S.h24) return pad(h) + ':' + pad(m);
  var ap = h < 12 ? 'a' : 'p', hh = h % 12; if (!hh) hh = 12;
  return hh + ':' + pad(m) + ap;
}
function ago(ts) {
  var m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
  var h = Math.round(m / 60); if (h < 48) return h + 'h ago'; return Math.round(h / 24) + 'd ago';
}
function money(v) {
  var dec = v >= 1000 ? 0 : 2, s = v.toFixed(dec), p = s.split('.');
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return p;
}

/* ---------------------------------------------------------------- data */
function urls(name) {
  var d = new Date();
  if (name === 'wx') {
    var q = '/v1/forecast?latitude=' + S.lat.toFixed(4) + '&longitude=' + S.lon.toFixed(4) +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
      '&hourly=temperature_2m,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
      '&timezone=auto&forecast_days=6' + (S.units === 'f' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '');
    return ['https://api.open-meteo.com' + q, 'http://api.open-meteo.com' + q, 900];
  }
  if (name === 'mk') return ['https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + mkList().coins.join(',') + '&sparkline=true&price_change_percentage=24h', '', 300];
  if (name === 'stq')                  // CNBC quote service (keyless, CORS *): price, change %, session, all tickers in one call
    return ['https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' + encodeURIComponent(mkSyms().map(cnbc).join('|')) + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json', '', 300];
  if (name.substr(0, 3) === 'sc:')     // CNBC daily bars (keyless, CORS *) for the 1-month sparkline
    return ['https://ts-api.cnbc.com/harmony/app/charts/1M.json?symbol=' + encodeURIComponent(name.substr(3)), '', 3600];
  if (name === 'itn') {                // Wikipedia "In the news" + most read (BBC RSS has no CORS)
    var y = new Date(Date.now() - 6 * 3600e3);   // today's feed fills in during the UTC morning
    return ['https://en.wikipedia.org/api/rest_v1/feed/featured/' + y.getUTCFullYear() + '/' + pad(y.getUTCMonth() + 1) + '/' + pad(y.getUTCDate()), '', 1800];
  }
  if (name === 'hn') return ['https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=' + (TALL ? 24 : 14), '', 900];
  if (name === 'otd') return ['https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()), '', 10800];
}
var SRC_FOR = { weather: 'wx', markets: 'mk', headlines: 'itn', hackernews: 'hn', onthisday: 'otd' };
var TALL = false, FACE_H = 584;
var DEFAULT_STOCKS = ['SPY', 'QQQ', 'DIA'], DEFAULT_COINS = [];
// tickers (MSFT, BRK.B), indexes (^GSPC) and futures (CL=F), Yahoo-style: strict, length-limited
var SYM_RE = /^\^?[A-Z][A-Z0-9.=-]{0,9}$/, MKNAME_RE = /^[A-Za-z0-9 &.,'()+\/-]{1,24}$/;
var MK_NAMES = { SPY: 'S&P 500 ETF', QQQ: 'Nasdaq 100 ETF', DIA: 'Dow ETF', '^GSPC': 'S&P 500', '^DJI': 'Dow', '^IXIC': 'Nasdaq', 'CL=F': 'Crude Oil', 'GC=F': 'Gold', 'NG=F': 'Nat Gas', 'SI=F': 'Silver' };
// Yahoo index / front-month futures symbols -> CNBC quote symbols (the browser can only reach CNBC: CORS)
var CNBC_SYM = { '^GSPC': '.SPX', '^DJI': '.DJI', '^IXIC': '.IXIC', 'CL=F': '@CL.1', 'GC=F': '@GC.1', 'NG=F': '@NG.1', 'SI=F': '@SI.1' };
function cnbc(sym) { return Object.prototype.hasOwnProperty.call(CNBC_SYM, sym) ? CNBC_SYM[sym] : sym; }
function isWatch(sym) { return /[\^=]/.test(sym); }          // index or futures contract
function mkName(sym, fb) {
  var n = CFG && CFG.names; if (n && Object.prototype.hasOwnProperty.call(n, sym)) return n[sym];
  return Object.prototype.hasOwnProperty.call(MK_NAMES, sym) ? MK_NAMES[sym] : (fb || sym);
}
function mkList() {   // stocks + watch (indexes, futures), deduped, at most 8 rows with coins
  var st = (CFG && CFG.stocks) ? CFG.stocks : DEFAULT_STOCKS, w = (CFG && CFG.watch) ? CFG.watch : [], co = (CFG && CFG.coins) ? CFG.coins : DEFAULT_COINS;
  var all = [], seen = {}, i, a = st.concat(w), out = { stocks: [], watch: [], coins: [] };
  for (i = 0; i < a.length && all.length < 8; i++) if (!seen[a[i]]) { seen[a[i]] = 1; all.push(a[i]); }
  for (i = 0; i < all.length; i++) (isWatch(all[i]) ? out.watch : out.stocks).push(all[i]);
  out.coins = co.slice(0, Math.max(0, 8 - all.length));
  return out;
}
function srcsFor(face) {
  if (face !== 'markets') return SRC_FOR[face] ? [SRC_FOR[face]] : [];
  var m = mkList(), out = m.coins.length ? ['mk'] : [];
  var a = m.stocks.concat(m.watch);
  if (a.length) out.push('stq');
  for (var i = 0; i < a.length; i++) out.push('sc:' + cnbc(a[i]));
  return out;
}
function mkSyms() { var m = mkList(); return m.stocks.concat(m.watch); }

function strip(h) { var d = document.createElement('div'); d.innerHTML = String(h || '').replace(/<(script|style|img)[^>]*>[\s\S]*?<\/\1>|<img[^>]*>/gi, ''); return (d.textContent || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }
function shortName(n) { return String(n).replace(/,? (Inc\.?|Corp\.?|Corporation|Co\.?|Ltd\.?|plc|Holdings|Technologies|Class [A-C])(?=\s|,|$)/gi, '').replace(/\s+$/, ''); }
function parse(name, body) {
  var j = JSON.parse(body);
  if (name === 'wx' && !j.current) throw 'bad weather';
  if (name === 'stq') {
    var qs = j.FormattedQuoteResult && j.FormattedQuoteResult.FormattedQuote, out = {};
    if (!qs || !qs.length) throw 'bad quotes';
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i], px = parseFloat(String(q.last).replace(/,/g, ''));
      if (!q.symbol || !isFinite(px)) continue;
      out[q.symbol] = { sym: q.symbol, name: shortName(q.name || q.symbol), price: px,
        chg: parseFloat(String(q.change_pct).replace(/[%+,]/g, '')) || 0, t: Date.parse(String(q.last_time).replace(/\.\d+/, '').replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) || 0,
        status: String(q.curmktstatus || '') };
    }
    return out;
  }
  if (name.substr(0, 3) === 'sc:') {
    var b = j.barData && j.barData.priceBars, c = [];
    if (!b || !b.length) throw 'no bars';
    for (var k = Math.max(0, b.length - 22); k < b.length; k++) { var v = parseFloat(b[k].close); if (isFinite(v)) c.push(v); }
    return c;
  }
  if (name === 'itn') {
    var n = j.news || [], o = { news: [], top: [] };
    for (var a = 0; a < n.length; a++) { var t = strip(n[a].story); if (t) o.news.push({ t: t, d: (n[a].links && n[a].links[0] && n[a].links[0].extract) || '' }); }
    var mr = (j.mostread && j.mostread.articles) || [];
    for (a = 0; a < mr.length && o.top.length < 14; a++) {
      var ar = mr[a]; if (!ar.titles || /^(Main_Page|Special:|Wikipedia:|Portal:)/.test(ar.title || '')) continue;
      o.top.push({ t: strip(ar.titles.normalized), d: String(ar.description || ''), v: ar.views || 0 });
    }
    if (!o.news.length && !o.top.length) throw 'empty';
    return o;
  }
  return j;
}

function adopt(name, r) {
  var s = src[name];
  if (!r || !r.ok) { s.offline = true; s.err = r && r.err; return; }
  try { s.data = parse(name, r.body); s.ts = r.ts; s.offline = !!r.cached; }
  catch (e) { s.offline = true; }
}

function load(name, force) {
  var u = urls(name), s = src[name];
  if (!s || s.url !== u[0]) {           // first use or location changed: show disk cache instantly
    s = src[name] = { url: u[0], ttl: u[2] * 1000, retry: 0 };
    var c = VB.cached(u[0]);
    if (c) adopt(name, JSON.parse(c)), s.offline = false;
  }
  if (s.inflight) return;
  if (!force && s.ts && !s.offline && Date.now() - s.ts < s.ttl) return;
  if (!force && Date.now() < s.retry) return;
  s.inflight = true;
  var id = 'r' + (++reqN); pending[id] = name;
  VB.request(id, u[0], u[1]);
}
function loadAll(force) { for (var k in SRC_FOR) { var l = srcsFor(k); for (var i = 0; i < l.length; i++) load(l[i], force); } }
function loadFace(face, force) { var l = srcsFor(face); for (var i = 0; i < l.length; i++) load(l[i], force); return l.length; }
function faceSrc(face) {   // the source whose state the footer badge reports (worst of the face's sources)
  var l = srcsFor(face), best = null;
  for (var i = 0; i < l.length; i++) { var s = src[l[i]]; if (!s) continue; if (!best || (s.offline && !best.offline) || (s.inflight && !s.data)) best = s; }
  return best;
}

/* ---------------------------------------------------------------- helpers */
function kicker(a, b) { return '<div class="kick">' + esc(a) + (b ? '<span class="kick2">' + esc(b) + '</span>' : '') + '</div>'; }
function waiting(what) {
  return '<div class="empty">Waiting for ' + esc(what) + '\u2026<div class="mono dim">CHECK WI-FI \u00b7 PRESS R TO RETRY</div></div>';
}
function colors() {
  return S.theme === 'paper' ? { ink: '#141310', dim: '#8B8578', faint: '#CDC6B5', acc: '#C93C14', bg: '#F1ECE0' }
                             : { ink: '#EDE8DC', dim: '#8E897D', faint: '#2C2B27', acc: '#FF6A2B', bg: '#0D0D0B' };
}
function canvas(w, h) {
  var c = document.createElement('canvas'), r = window.devicePixelRatio || 1;
  c.width = w * r; c.height = h * r; c.style.width = w + 'px'; c.style.height = h + 'px';
  var g = c.getContext('2d'); g.scale(r, r);
  return [c, g];
}
function spark(w, h, vals, opt) {
  var cg = canvas(w, h), g = cg[1], C = colors(), lo = Infinity, hi = -Infinity, i;
  for (i = 0; i < vals.length; i++) { if (vals[i] < lo) lo = vals[i]; if (vals[i] > hi) hi = vals[i]; }
  if (hi === lo) { hi += 1; lo -= 1; }
  var pt = function (k) { return [k * (w - 4) / (vals.length - 1) + 2, h - 6 - (vals[k] - lo) / (hi - lo) * (h - 16)]; };
  if (opt && opt.fill) {
    g.beginPath(); g.moveTo(2, h);
    for (i = 0; i < vals.length; i++) { var p = pt(i); g.lineTo(p[0], p[1]); }
    g.lineTo(w - 2, h); g.closePath(); g.fillStyle = C.faint; g.fill();
  }
  g.beginPath();
  for (i = 0; i < vals.length; i++) { var q = pt(i); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }
  g.lineWidth = (opt && opt.lw) || 3; g.lineJoin = 'round'; g.strokeStyle = (opt && opt.color) || C.ink; g.stroke();
  var e = pt(vals.length - 1);
  g.beginPath(); g.arc(e[0] - 2, e[1], 5, 0, 7); g.fillStyle = C.acc; g.fill();
  return cg[0];
}
/* WMO weather code -> [label, kind] */
function wmo(c) {
  var t = { 0:['Clear','sun'],1:['Mostly clear','sun'],2:['Partly cloudy','part'],3:['Overcast','cloud'],45:['Fog','fog'],48:['Freezing fog','fog'],
    51:['Light drizzle','rain'],53:['Drizzle','rain'],55:['Heavy drizzle','rain'],56:['Freezing drizzle','rain'],57:['Freezing drizzle','rain'],
    61:['Light rain','rain'],63:['Rain','rain'],65:['Heavy rain','rain'],66:['Freezing rain','rain'],67:['Freezing rain','rain'],
    71:['Light snow','snow'],73:['Snow','snow'],75:['Heavy snow','snow'],77:['Snow grains','snow'],80:['Showers','rain'],81:['Showers','rain'],
    82:['Downpours','rain'],85:['Snow showers','snow'],86:['Snow showers','snow'],95:['Thunderstorms','storm'],96:['Storms, hail','storm'],99:['Storms, hail','storm'] };
  return t[c] || ['\u2014', 'cloud'];
}
function icon(kind, size, night) {
  var cg = canvas(size, size), g = cg[1], C = colors(), s = size / 100;
  g.lineWidth = Math.max(2, 5 * s); g.strokeStyle = C.ink; g.fillStyle = C.ink; g.lineCap = 'round';
  function sun(x, y, r) {
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = C.acc; g.fill();
    if (night) { g.beginPath(); g.arc(x + r * .45, y - r * .3, r * .85, 0, 7); g.fillStyle = C.bg; g.fill(); return; }
    g.strokeStyle = C.acc;
    for (var a = 0; a < 8; a++) { var an = a * Math.PI / 4; g.beginPath(); g.moveTo(x + Math.cos(an) * r * 1.35, y + Math.sin(an) * r * 1.35); g.lineTo(x + Math.cos(an) * r * 1.75, y + Math.sin(an) * r * 1.75); g.stroke(); }
    g.strokeStyle = C.ink;
  }
  function cloud(x, y, w) {
    g.fillStyle = C.ink; g.beginPath();
    g.arc(x + w * .3, y, w * .2, 0, 7); g.arc(x + w * .55, y - w * .12, w * .26, 0, 7); g.arc(x + w * .78, y + w * .02, w * .17, 0, 7);
    g.fill(); g.fillRect(x + w * .1, y, w * .85, w * .19);
    g.beginPath(); g.arc(x + w * .12, y + w * .1, w * .09, 0, 7); g.fill();
  }
  if (kind === 'sun') sun(50 * s, 50 * s, 22 * s);
  else if (kind === 'part') { sun(36 * s, 36 * s, 17 * s); cloud(22 * s, 62 * s, 74 * s); }
  else if (kind === 'fog') { for (var i = 0; i < 4; i++) { g.beginPath(); g.moveTo((14 + (i % 2) * 8) * s, (30 + i * 14) * s); g.lineTo((86 - (i % 2) * 8) * s, (30 + i * 14) * s); g.stroke(); } }
  else {
    cloud(10 * s, 40 * s, 80 * s);
    if (kind === 'rain' || kind === 'storm') { g.strokeStyle = C.acc; for (var k = 0; k < 3; k++) { g.beginPath(); g.moveTo((32 + k * 16) * s, 70 * s); g.lineTo((26 + k * 16) * s, 88 * s); g.stroke(); } }
    if (kind === 'snow') { g.fillStyle = C.acc; for (var m = 0; m < 3; m++) { g.beginPath(); g.arc((30 + m * 18) * s, 80 * s, 4.5 * s, 0, 7); g.fill(); } }
    if (kind === 'storm') { g.fillStyle = C.acc; g.beginPath(); g.moveTo(52 * s, 62 * s); g.lineTo(40 * s, 82 * s); g.lineTo(50 * s, 82 * s); g.lineTo(44 * s, 98 * s); g.lineTo(62 * s, 74 * s); g.lineTo(52 * s, 74 * s); g.closePath(); g.fill(); }
  }
  return cg[0];
}
function fit(listSel, minItems) {     // drop trailing items until the face fits
  var f = $('face'), items = f.querySelectorAll(listSel);
  for (var i = items.length - 1; i >= minItems && f.scrollHeight > f.clientHeight + 1; i--) items[i].parentNode.removeChild(items[i]);
}

/* ---------------------------------------------------------------- faces */
function zoneNow(tz) {
  var off = VB.tzOffset(tz), d = new Date(Date.now() + off * 60000);
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), wd: d.getUTCDay(), off: off };
}
var R = {};
R.clock = function (f) {
  var d = new Date(), h = d.getHours(), t = fmtTime(d, false), ap = S.h24 ? '' : (h < 12 ? 'AM' : 'PM');
  var start = new Date(d.getFullYear(), 0, 1), doy = Math.floor((d - start) / 864e5) + 1;
  var frac = (h * 60 + d.getMinutes()) / 1440, sr = null, ss = null;
  var w = src.wx && src.wx.data;
  if (w && w.daily && w.daily.sunrise) { sr = w.daily.sunrise[0].substr(11, 5).split(':'); ss = w.daily.sunset[0].substr(11, 5).split(':'); }
  var localOff = -d.getTimezoneOffset(), wc = '';
  for (var i = 0; i < CITIES.length; i++) {
    var z = zoneNow(CITIES[i][1]), diff = (z.off - localOff) / 60, ds = (diff >= 0 ? '+' : '\u2212') + Math.abs(diff) + 'H';
    var dayTag = z.wd !== d.getDay() ? (((z.wd - d.getDay() + 7) % 7) === 1 ? 'TMRW' : 'YDAY') : 'TODAY';
    var tt = hm(z.h, z.m), apx = S.h24 ? '' : tt.slice(-1) === 'a' ? 'AM' : 'PM';
    if (!S.h24) tt = tt.slice(0, -1);
    var night = z.h < 6 || z.h >= 19;
    wc += '<div class="wc rule' + (i % 3 === 1 ? ' mid' : '') + (i % 3 === 0 ? ' first' : '') + '"><div class="in"><div class="city dim">' + esc(CITIES[i][0]) + '</div>' +
      '<div class="wt">' + tt + (apx ? '<small>' + apx + '</small>' : '') + '</div></div>' +
      '<div class="meta dim">' + ds + '<br>' + (night ? '<span class="acc">\u25cf</span> ' : '') + dayTag + '</div></div>';
  }
  var sunTxt = sr ? ' \u00b7 SUN ' + hm(+sr[0], +sr[1]) + '\u2013' + hm(+ss[0], +ss[1]) : '';
  var bar = '<div class="daybar"><div style="width:' + (frac * 100).toFixed(1) + '%"></div>' +
    (sr ? '<i style="left:' + ((+sr[0] * 60 + +sr[1]) / 14.4).toFixed(1) + '%"></i><i style="left:' + ((+ss[0] * 60 + +ss[1]) / 14.4).toFixed(1) + '%"></i>' : '') + '</div>';
  f.innerHTML = kicker('Local time', S.city) +
    '<div class="bigtime"><div class="t num">' + t + '</div><div class="side">' +
    (ap ? '<div class="ap">' + ap + '</div>' : '') + '<div class="sec dim">:' + pad(d.getSeconds()) + '</div></div></div>' +
    '<div class="dateline">' + DAY[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + '</div>' +
    '<div class="dayline dim">Day ' + doy + ' \u00b7 ' + Math.round(frac * 100) + '% of today gone' + sunTxt + '</div>' + bar +
    '<div class="world rule">' + wc + '</div>';
};
R.weather = function (f) {
  var w = src.wx && src.wx.data, u = S.units === 'f';
  if (!w) { f.innerHTML = kicker('Weather', S.city) + waiting('the weather'); return; }
  var c = w.current, dl = w.daily, k = wmo(c.weather_code), now = new Date();
  var hrs = [], hi = w.hourly, start = 0, nowIso = c.time.substr(0, 13);
  for (var i = 0; i < hi.time.length; i++) if (hi.time[i].substr(0, 13) === nowIso) { start = i; break; }
  for (i = start; i < start + 25 && i < hi.time.length; i++) hrs.push(hi.temperature_2m[i]);
  var ss = dl.sunset[0].substr(11, 5).split(':'), sr = dl.sunrise[0].substr(11, 5).split(':');
  var sunL = c.is_day ? 'SUNSET' : 'SUNRISE', sunV = c.is_day ? hm(+ss[0], +ss[1]) : hm(+sr[0], +sr[1]);
  var stats = [['HIGH', Math.round(dl.temperature_2m_max[0]) + '\u00b0'], ['LOW', Math.round(dl.temperature_2m_min[0]) + '\u00b0'],
    ['RAIN', (dl.precipitation_probability_max[0] == null ? '\u2013' : dl.precipitation_probability_max[0]) + '<small>%</small>'],
    ['WIND', Math.round(c.wind_speed_10m) + '<small>' + (u ? 'mph' : 'km/h') + '</small>'], [sunL, sunV.replace(/([ap])$/, '<small>$1m</small>')]];
  var st = '';
  for (i = 0; i < stats.length; i++) st += '<div class="stat rule' + (i ? '' : ' first') + '"><div class="l dim">' + stats[i][0] + '</div><div class="v">' + stats[i][1] + '</div></div>';
  var days = '';
  for (i = 1; i < 6 && i < dl.time.length; i++) {
    var p = dl.time[i].split('-'), dd = new Date(+p[0], +p[1] - 1, +p[2]);
    days += '<div class="day" id="day' + i + '"><div class="dn dim">' + DAY[dd.getDay()].substr(0, 3).toUpperCase() + ' ' + dd.getDate() + '</div>' +
      '<div class="hl">' + Math.round(dl.temperature_2m_max[i]) + '\u00b0</div><div class="lo dim">' + Math.round(dl.temperature_2m_min[i]) + '\u00b0 \u00b7 ' + (dl.precipitation_probability_max[i] || 0) + '%</div></div>';
  }
  f.innerHTML = kicker('Weather', S.city) +
    '<div class="wxtop"><div class="temp num">' + Math.round(c.temperature_2m) + '<span class="deg">\u00b0</span></div>' +
    '<div class="cond"><div class="w">' + k[0] + '</div><div class="f dim">Feels like ' + Math.round(c.apparent_temperature) + '\u00b0 \u00b7 humidity ' + c.relative_humidity_2m + '%</div></div></div>' +
    '<div class="stats rule">' + st + '</div>' +
    '<div class="hourly" id="hourly"><div class="mono dim" style="position:absolute;left:0;top:6px;font-size:12px;letter-spacing:2px">NEXT 24 HOURS</div></div>' +
    '<div class="days rule">' + days + '</div>';
  var ic = icon(k[1], 96, !c.is_day); ic.className = 'icon'; f.querySelector('.wxtop').appendChild(ic);
  if (hrs.length > 2) {
    var sp = spark(664, 82, hrs, { fill: true, color: colors().ink, lw: 3 }); sp.style.position = 'absolute'; sp.style.left = '0'; sp.style.top = '26px';
    $('hourly').appendChild(sp);
    var lo = Math.min.apply(null, hrs), hx = Math.max.apply(null, hrs);
    var lab = document.createElement('div'); lab.className = 'mono dim'; lab.style.cssText = 'position:absolute;right:0;top:6px;font-size:12px;letter-spacing:2px';
    lab.innerHTML = Math.round(lo) + '\u00b0 \u2013 ' + Math.round(hx) + '\u00b0'; $('hourly').appendChild(lab);
  }
  for (i = 1; i < 6 && i < dl.time.length; i++) { var di = $('day' + i); if (di) di.appendChild(icon(wmo(dl.weather_code[i])[1], 44)); }
};
function stockState(list) {   // session as reported by the quote service
  var q = null;
  for (var i = 0; i < list.length; i++) if (list[i]) { q = list[i]; break; }
  if (!q) return '';
  if (q.status === 'REG_MKT') return '<span class="acc">\u25cf</span> OPEN \u00b7 MAY BE DELAYED';
  if (!q.t) return 'CLOSED';
  var d = new Date(q.t);
  return 'CLOSED \u00b7 LAST ' + (d.getDay() !== new Date().getDay() ? DAY[d.getDay()].substr(0, 3).toUpperCase() + ' ' : '') + fmtTime(d, true);
}
function wmoney(v) {   // indexes and futures: 2 decimals (3 under $10), like the iPhone Stocks app
  var s = v.toFixed(v < 10 ? 3 : 2), p = s.split('.');
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return p;
}
function mkRow(i, sym, name, price, chg, series, last, kind) {
  var p = kind ? wmoney(price) : money(price), cur = kind === 'idx' ? '' : '$';
  return '<div class="mrow rule' + (last ? ' last' : '') + '" id="mrow' + i + '"><div class="msym">' + esc(sym) + '</div><div class="mnm dim">' + esc(clip(name, 22)) + '</div>' +
    '<div class="mpx num">' + cur + p[0] + (p[1] ? '<small>.' + p[1] + '</small>' : '') + '</div>' +
    '<div class="mchg ' + (chg >= 0 ? 'up' : 'dn') + '">' + (chg >= 0 ? '\u25b2 +' : '\u25bc \u2212') + Math.abs(chg).toFixed(2) + '%</div></div>';
}
R.markets = function (f) {
  var ml = mkList(), coins = src.mk && src.mk.data, stocks = [], watch = [], i, haveAny = false;
  var sq = src.stq && src.stq.data;
  function quote(sym) {
    var cs = cnbc(sym), sd = sq && sq[cs], sc = src['sc:' + cs];
    if (sd) { sd.closes = sc && sc.data ? sc.data.concat(sc.data[sc.data.length - 1] !== sd.price ? [sd.price] : []) : null; haveAny = true; }
    return sd || null;
  }
  for (i = 0; i < ml.stocks.length; i++) stocks.push(quote(ml.stocks[i]));
  for (i = 0; i < ml.watch.length; i++) watch.push(quote(ml.watch[i]));
  if (ml.coins.length && coins && coins.length) haveAny = true;
  if (!haveAny) { f.innerHTML = kicker('Markets', 'USD') + waiting('prices'); return; }
  var nsec = (ml.stocks.length ? 1 : 0) + (ml.watch.length ? 1 : 0) + (ml.coins.length ? 1 : 0);
  var n = ml.stocks.length + ml.watch.length + ml.coins.length, rowH = Math.min(TALL ? 200 : 96, Math.floor((FACE_H - 64 - nsec * 34) / Math.max(1, n)));
  var h = kicker('Markets', 'USD \u00b7 DAY CHANGE'), rows = [], k = 0;
  if (ml.stocks.length) {
    h += '<div class="msec"><span>STOCKS</span><span class="mst dim">' + stockState(stocks) + '</span><span class="m7 dim">1 MONTH</span></div>';
    for (i = 0; i < ml.stocks.length; i++) {
      var q = stocks[i];
      if (q) { h += mkRow(k, ml.stocks[i], mkName(ml.stocks[i], q.name), q.price, q.chg, q.closes, i === ml.stocks.length - 1); rows.push(q.closes); }
      else { h += '<div class="mrow rule" id="mrow' + k + '"><div class="msym">' + esc(ml.stocks[i]) + '</div><div class="mnm dim">NO QUOTE YET</div></div>'; rows.push(null); }
      k++;
    }
  }
  if (ml.watch.length) {   // indexes + futures: friendly name big, symbol small
    h += '<div class="msec"><span>INDEX \u00b7 FUTURES</span><span class="m7 dim">1 MONTH</span></div>';
    for (i = 0; i < ml.watch.length; i++) {
      var wq = watch[i], ws = ml.watch[i];
      if (wq) { h += mkRow(k, mkName(ws, wq.name), ws, wq.price, wq.chg, wq.closes, i === ml.watch.length - 1, ws.charAt(0) === '^' ? 'idx' : 'fut'); rows.push(wq.closes); }
      else { h += '<div class="mrow rule" id="mrow' + k + '"><div class="msym">' + esc(mkName(ws)) + '</div><div class="mnm dim">' + esc(ws) + ' \u00b7 NO QUOTE YET</div></div>'; rows.push(null); }
      k++;
    }
  }
  if (ml.coins.length) {
    h += '<div class="msec"><span>CRYPTO</span><span class="mst dim">24/7 \u00b7 COINGECKO</span><span class="m7 dim">7 DAYS</span></div>';
    var order = {}; for (i = 0; i < ml.coins.length; i++) order[ml.coins[i]] = i;
    var list = (coins || []).slice().sort(function (a, b) { return order[a.id] - order[b.id]; });
    for (i = 0; i < list.length; i++) {
      var c = list[i], sv = c.sparkline_in_7d && c.sparkline_in_7d.price, v = null;
      if (sv && sv.length > 2) { var step = Math.max(1, Math.floor(sv.length / 60)); v = []; for (var j = 0; j < sv.length; j += step) v.push(sv[j]); v.push(sv[sv.length - 1]); }
      h += mkRow(k, String(c.symbol).toUpperCase(), c.name, c.current_price, c.price_change_percentage_24h || 0, v, i === list.length - 1); rows.push(v); k++;
    }
  }
  f.innerHTML = h;
  for (i = 0; i < k; i++) {
    var el = $('mrow' + i); if (!el) continue;
    el.style.height = rowH + 'px';
    var big = rowH >= 80; el.className += big ? ' big' : '';
    if (rows[i] && rows[i].length > 2) { var sp = spark(190, rowH - 26, rows[i], { fill: true, lw: 2 }); sp.className = 'msp'; el.appendChild(sp); }
  }
};
R.headlines = function (f) {
  var b = src.itn && src.itn.data;
  if (!b) { f.innerHTML = kicker('Headlines', 'Wikipedia') + waiting('headlines'); return; }
  var lead = b.news[0], h = kicker('Headlines', 'WIKIPEDIA \u00b7 IN THE NEWS');
  if (lead) h += '<div class="lead"><div class="h">' + esc(clip(lead.t, 130)) + '</div>' + (lead.d ? '<div class="d dim">' + esc(clip(lead.d, 150)) + '</div>' : '') + '</div>';
  h += '<div class="bbc">';
  for (var i = 1; i < b.news.length; i++) h += '<div class="item rule"><div class="h">' + esc(clip(b.news[i].t, 120)) + '</div></div>';
  for (i = 0; i < b.top.length; i++) h += '<div class="item rule"><div class="h">' + esc(clip(b.top[i].t + (b.top[i].d ? ' \u2014 ' + b.top[i].d : ''), 92)) + '</div><div class="m dim">MOST READ \u00b7 ' + Math.round(b.top[i].v / 1000) + 'K VIEWS</div></div>';
  f.innerHTML = h + '</div>';
  fit('.bbc .item', 2);
};
R.hackernews = function (f) {
  var j = src.hn && src.hn.data;
  if (!j || !j.hits) { f.innerHTML = kicker('Hacker News', 'Front page') + waiting('Hacker News'); return; }
  var hits = j.hits.slice().sort(function (a, b) { return (b.points || 0) - (a.points || 0); });
  var h = kicker('Hacker News', 'FRONT PAGE \u00b7 BY POINTS') + '<div class="hn">';
  for (var i = 0; i < hits.length; i++) {
    var x = hits[i], dom = '';
    if (x.url) { var mm = x.url.match(/^https?:\/\/(www\.)?([^\/]+)/); if (mm) dom = mm[2]; }
    h += '<div class="item rule"><div class="n acc">' + (i + 1) + '</div><div class="h">' + esc(clip(x.title, 96)) + '</div>' +
      '<div class="m dim">' + (x.points || 0) + ' PTS \u00b7 ' + (x.num_comments || 0) + ' COMMENTS' + (dom ? ' \u00b7 ' + esc(dom) : '') + '</div></div>';
  }
  f.innerHTML = h + '</div>';
  fit('.hn .item', 3);
};
R.onthisday = function (f) {
  var d = new Date(), j = src.otd && src.otd.data;
  var title = MON[d.getMonth()].toUpperCase() + ' ' + d.getDate();
  if (!j || !j.selected) { f.innerHTML = kicker('On this day', title) + waiting('Wikipedia'); return; }
  var ev = [], pick = [], seen = {};
  for (var i = 0; i < j.selected.length; i++) { var e0 = j.selected[i]; if (e0.text && e0.text.length < 200 && !seen[e0.year]) { seen[e0.year] = 1; ev.push(e0); } }
  ev.sort(function (a, b) { return b.year - a.year; });
  var want = Math.min(TALL ? 10 : 6, ev.length);                     // spread picks across the centuries
  for (i = 0; i < want; i++) pick.push(ev[Math.round(i * (ev.length - 1) / Math.max(1, want - 1))]);
  var h = kicker('On this day', title + ' \u00b7 WIKIPEDIA');
  for (i = 0; i < pick.length; i++) {
    var y = pick[i].year, yago = d.getFullYear() - y;
    h += '<div class="ev rule' + (i ? '' : ' first') + '"><div class="y' + (i ? '' : ' acc') + '">' + (y < 0 ? -y + '<small>BC</small>' : y + '<small class="dim">' + yago + ' YEARS AGO</small>') + '</div><div class="x">' + esc(pick[i].text) + '</div></div>';
  }
  f.innerHTML = h;
  fit('.ev', 2);
};

/* ---------------------------------------------------------------- remote config */
function vStr(v, n, multi) {
  if (typeof v !== 'string' || !v.length || v.length > n) return null;
  if (multi ? /[\x00-\x09\x0b-\x1f\x7f]/.test(v) : /[\x00-\x1f\x7f]/.test(v)) return null;
  return v;
}
function vNum(v, lo, hi) { return (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi) ? v : null; }
function vFaces(v) {
  if (!(v instanceof Array) || !v.length || v.length > 8) return null;
  var out = [], seen = {};
  for (var i = 0; i < v.length; i++) { var f = typeof v[i] === 'string' ? ALIAS[v[i]] : null; if (!f) return null; if (!seen[f]) { seen[f] = 1; out.push(f); } }
  return out;
}
function vLoc(v) {
  if (!v || typeof v !== 'object') return null;
  var n = vStr(v.name, 40), la = vNum(v.lat, -90, 90), lo = vNum(v.lon, -180, 180);
  return (n && la !== null && lo !== null) ? { name: n, lat: la, lon: lo } : null;
}
function vCustom(v) {
  if (!v || typeof v !== 'object') return null;
  var c = { enabled: v.enabled === true, title: vStr(v.title, 60) || '', body: v.body === undefined ? '' : vStr(v.body, 400, true), cd: null };
  if (c.body === null) return null;
  var d = v.countdown;
  if (d && typeof d === 'object') {
    var lab = vStr(d.label, 40), m = typeof d.date === 'string' && d.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (lab && m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) c.cd = { label: lab, y: +m[1], m: +m[2], d: +m[3] };
  }
  return c;
}
function vSyms(a) {
  if (!(a instanceof Array) || a.length > 8) return null;
  var o = [], seen = {};
  for (var i = 0; i < a.length; i++) { var t = a[i]; if (typeof t !== 'string' || !SYM_RE.test(t)) return null; if (!seen[t]) { seen[t] = 1; o.push(t); } }
  return o;
}
function vMarkets(v) {
  if (!v || typeof v !== 'object' || v instanceof Array) return null;
  var m = { stocks: null, coins: null, watch: null, names: null }, i, seen;
  if (v.stocks !== undefined && (m.stocks = vSyms(v.stocks)) === null) return null;
  if (v.watch !== undefined && (m.watch = vSyms(v.watch)) === null) return null;
  if (v.coins !== undefined) {
    if (!(v.coins instanceof Array) || v.coins.length > 8) return null;
    m.coins = []; seen = {};
    for (i = 0; i < v.coins.length; i++) { var c = v.coins[i]; if (typeof c !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(c)) return null; if (!seen[c]) { seen[c] = 1; m.coins.push(c); } }
  }
  if (v.names && typeof v.names === 'object' && !(v.names instanceof Array)) {   // optional display names; bad entries are skipped
    m.names = {}; var nk = 0;
    for (var key in v.names) if (Object.prototype.hasOwnProperty.call(v.names, key) && nk < 16) {
      var nm = v.names[key]; if (SYM_RE.test(key) && typeof nm === 'string' && MKNAME_RE.test(nm)) { m.names[key] = nm; nk++; }
    }
  }
  if ((m.stocks ? m.stocks.length : 3) + (m.watch ? m.watch.length : 0) + (m.coins ? m.coins.length : 0) > 8) return null;
  return m;
}
function cfgParse(body) {
  if (typeof body !== 'string' || body.length > 16384) return null;
  var j; try { j = JSON.parse(body); } catch (e) { return null; }
  if (!j || typeof j !== 'object' || j instanceof Array) return null;
  var ver = vNum(j.version, 1, 999999); if (ver === null || ver % 1) return null;
  var dd = (j.defaults && typeof j.defaults === 'object') ? j.defaults : {}, bb = (j.web && typeof j.web === 'object') ? j.web : {};   // the 'web' section, then shared defaults
  function pick(k, fn) { var a = bb.hasOwnProperty(k) ? fn(bb[k]) : null; if (a !== null) return a; return dd.hasOwnProperty(k) ? fn(dd[k]) : null; }
  var c = { version: ver,
    faces: pick('faces', vFaces),
    rotate: pick('rotate_seconds', function (v) { return (v === 0 || vNum(v, 10, 3600) !== null) && v % 1 === 0 ? v : null; }),
    theme: pick('theme', function (v) { return v === 'dark' || v === 'paper' ? v : null; }),
    loc: pick('location', vLoc),
    units: pick('units', function (v) { return v === 'f' || v === 'c' ? v : null; }),
    clock: pick('clock', function (v) { return v === '12h' || v === '24h' ? v : null; }),
    custom: pick('custom', vCustom) };
  var mk = pick('markets', vMarkets); c.stocks = mk ? mk.stocks : null; c.coins = mk ? mk.coins : null; c.watch = mk ? mk.watch : null; c.names = mk ? mk.names : null;
  return c;
}
function cfgFaces() {
  var f = (CFG && CFG.faces) ? CFG.faces.slice() : DEFAULT_FACES.slice(), on = CFG && CFG.custom && CFG.custom.enabled, out = [];
  for (var i = 0; i < f.length; i++) if (f[i] !== 'custom' || on) out.push(f[i]);
  if (on && f.join(',').indexOf('custom') < 0) out.push('custom');
  return out.length ? out : DEFAULT_FACES.slice();
}
function cfgUse(c, fresh) {
  var name = FACES[cur]; CFG = c;
  if (c.version !== S.cfgApplied) {            // a new push: its values win over on-phone tweaks
    var a = { version: c.version };
    if (c.rotate !== null) a.rotate = c.rotate; if (c.theme) a.theme = c.theme; if (c.units) a.units = c.units;
    if (c.clock) a.h24 = c.clock === '24h'; if (c.loc) { a.city = c.loc.name; a.lat = c.loc.lat; a.lon = c.loc.lon; }
    VB.applyConfig(JSON.stringify(a));
    S = JSON.parse(VB.settings()); applyTheme(); if (fresh) load('wx', false);
  }
  FACES = cfgFaces();
  var k = -1; for (var i = 0; i < FACES.length; i++) if (FACES[i] === name) k = i;
  cur = k >= 0 ? k : 0;
}
function fetchCfg() {
  if (!CFG_URL) return;
  if (cfgInflight || Date.now() - cfgLast < 15000) return;
  cfgInflight = true; cfgLast = Date.now();
  var id = 'r' + (++reqN); pending[id] = 'cfg';
  VB.request(id, CFG_URL + '?_=' + Math.floor(Date.now() / 60000), '');   // per-minute cache-buster past the CDN
}
function cfgDone(raw) {
  cfgInflight = false;
  try {
    var r = raw ? JSON.parse(raw) : null;
    if (r && r.ok && !r.cached) {
      var c = cfgParse(r.body);
      if (c) { if (!CFG || c.version !== CFG.version) { VB.saveCfg(r.body); cfgUse(c, true); draw(); } }
    }
  } catch (e) {}
  footer();
}

function daysTo(cd) {
  var now = new Date(), a = new Date(now.getFullYear(), now.getMonth(), now.getDate()), b = new Date(cd.y, cd.m - 1, cd.d);
  return Math.round((b - a) / 864e5);
}
R.custom = function (f) {
  var c = CFG && CFG.custom;
  if (!c) { f.innerHTML = kicker('Note') + waiting('a note'); return; }
  var h = kicker('Note', c.cd ? 'COUNTDOWN' : '') + '<div class="cust">';
  if (c.title) h += '<div class="ct">' + esc(c.title) + '</div>';
  if (c.body) h += '<div class="cb">' + esc(c.body).replace(/\n/g, '<br>') + '</div>';
  h += '</div>';
  if (c.cd) {
    var n = daysTo(c.cd), word = n === 0 ? 'TODAY' : (n > 0 ? (n === 1 ? 'DAY TO GO' : 'DAYS TO GO') : (n === -1 ? 'DAY AGO' : 'DAYS AGO'));
    var dt = new Date(c.cd.y, c.cd.m - 1, c.cd.d);
    h += '<div class="cd rule"><div class="cn num' + (n === 0 ? ' acc' : '') + '"' + (Math.abs(n) >= 1000 ? ' style="font-size:120px"' : '') + '>' + Math.abs(n) + '</div>' +
      '<div class="cl"><div class="cw acc">' + word + '</div><div class="cx">' + esc(c.cd.label) + '</div><div class="cdt dim">' +
      DAY[dt.getDay()].toUpperCase() + ' ' + MON[dt.getMonth()].toUpperCase() + ' ' + dt.getDate() + ', ' + dt.getFullYear() + '</div></div></div>';
  }
  f.innerHTML = h;
  var cb = f.querySelector('.cb'), maxH = c.cd ? 300 : 470;  // shrink long notes to fit
  var ct = f.querySelector('.cust'), size = 30;
  while (cb && ct.offsetHeight > maxH && size > 18) { size -= 2; cb.style.fontSize = size + 'px'; cb.style.lineHeight = Math.round(size * 1.38) + 'px'; }
};

/* ---------------------------------------------------------------- chrome */
function header() {
  var d = new Date();
  $('hdate').innerHTML = DAY[d.getDay()].substr(0, 3).toUpperCase() + ' ' + d.getDate() + ' ' + MON[d.getMonth()].substr(0, 3).toUpperCase();
  $('htime').innerHTML = fmtTime(d, true);
}
function footer() {
  var name = FACES[cur], s = faceSrc(name);
  $('fnum').innerHTML = pad(cur + 1);
  $('fname').innerHTML = LABEL[FACES[cur]] + (paused ? ' <span class="dim">\u00b7 HOLD</span>' : '');
  var pg = ''; for (var i = 0; i < FACES.length; i++) pg += '<span' + (i === cur ? ' class="on"' : '') + '></span>';
  $('pager').innerHTML = pg;
  $('cfgv').innerHTML = 'web ' + esc(APPV) + ' \u00b7 ' + (CFG ? 'cfg v' + CFG.version : (CFG_URL ? 'cfg \u2013' : 'defaults'));
  var u = $('upd');
  if (OTA) { u.style.display = 'block'; u.innerHTML = 'UPDATE ' + esc(OTA) + ' READY \u00b7 PRESS <b>U</b> TO INSTALL'; } else u.style.display = 'none';
  var b = $('badge');
  if (s && s.offline) { b.style.display = 'block'; b.innerHTML = s.ts ? 'OFFLINE \u00b7 ' + ago(s.ts).toUpperCase() : 'OFFLINE'; }
  else if (s && s.inflight && !s.data) { b.style.display = 'block'; b.innerHTML = 'LOADING'; }
  else b.style.display = 'none';
}
function draw() {
  var f = $('face');
  try {
    R[FACES[cur]](f);
    if (TALL && /^(clock|weather|custom)$/.test(FACES[cur]) && f.childNodes.length > 1) {   // centre short faces on a tall phone
      var wr = document.createElement('div'); while (f.childNodes.length > 1) wr.appendChild(f.childNodes[1]); f.appendChild(wr);
      wr.style.paddingTop = Math.max(0, Math.floor((FACE_H - f.firstChild.offsetHeight - wr.offsetHeight) / 2.2)) + 'px';
    }
  } catch (e) { f.innerHTML = kicker(LABEL[FACES[cur]]) + '<div class="empty">Couldn\u2019t draw this page.<div class="mono dim">' + esc(String(e)).substr(0, 80) + '</div></div>'; }
  header(); footer();
}
function go(n) {
  cur = (n + FACES.length) % FACES.length; lastFlip = Date.now();
  var f = $('face'); f.className = 'fade';
  setTimeout(function () { draw(); f.className = ''; }, 180);
  loadFace(FACES[cur], false);
}
function progress() {
  var r = S.rotate * 1000;
  $('progbar').style.width = (!r || paused) ? '0' : Math.min(100, (Date.now() - lastFlip) / r * 100).toFixed(2) + '%';
}
function applyTheme() { document.body.className = S.theme === 'paper' ? 'paper' : 'dark'; }
var started = false;
function scale() {   // 720-wide stage: square on desktops/tablets, taller on a portrait phone
  var ins = VB.insets ? VB.insets() : [0, 0];
  var w = window.innerWidth || 720, h = (window.innerHeight || 720) - ins[0] - ins[1];
  var tall = h / w > 1.1, H = tall ? Math.min(1640, Math.round(720 * h / w)) : 720, k = tall ? w / 720 : Math.min(w, h) / 720;
  var st = $('stage');
  st.style.height = H + 'px'; $('face').style.height = (H - 136) + 'px'; $('ft').style.top = (H - 66) + 'px'; $('upd').style.top = (H - 108) + 'px';
  st.style.webkitTransform = st.style.transform = 'scale(' + k + ')';
  st.style.left = Math.round((w - 720 * k) / 2) + 'px'; st.style.top = Math.round(ins[0] + (h - H * k) / 2) + 'px';
  if (tall !== TALL || FACE_H !== H - 136) { TALL = tall; FACE_H = H - 136; if (started) { loadAll(false); draw(); } }
}
function help(on) {
  var h = $('help');
  if (on === undefined) on = h.style.display !== 'block';
  h.style.display = on ? 'block' : 'none';
  h.innerHTML = '<b>N / SPACE</b>next page<br><b>P / DEL</b>previous<br><b>1 \u2013 9</b>jump to page<br><b>R</b>refresh now<br><b>A</b>hold / auto-advance<br><b>T</b>ink / paper theme<br><b>S</b>settings &amp; config link<br><b>F</b>full screen<br><b>SWIPE / TAP</b>sides flip pages<br><b>TAP HEADER</b>settings';
}

window.Vellum = {
  key: function (k) {
    if ($('help').style.display === 'block' && k !== 'h') { help(false); return; }
    if (k === 'next' || k === 'n' || k === 'enter' || k === 'j') go(cur + 1);
    else if (k === 'prev' || k === 'p' || k === 'k') go(cur - 1);
    else if (k >= '1' && k <= '9') { if (+k <= FACES.length) go(+k - 1); }
    else if (k === 'r') { fetchCfg(); if (!loadFace(FACES[cur], true)) loadAll(true); footer(); }
    else if (k === 'a') { paused = !paused; lastFlip = Date.now(); footer(); progress(); }
    else if (k === 't') { S.theme = S.theme === 'paper' ? 'dark' : 'paper'; VB.setPref('theme', S.theme); applyTheme(); draw(); }
    else if (k === 'h' || k === '?') help();
    else if (k === 's') VB.openSettings();
    else if (k === 'f') VB.fullscreen();
  },
  done: function (id) {
    var name = pending[id]; delete pending[id];
    if (name === 'cfg') { cfgDone(VB.take(id)); return; }
    var raw = VB.take(id), s = src[name];
    if (!s) return;
    s.inflight = false;
    adopt(name, raw ? JSON.parse(raw) : null);
    s.retry = s.offline ? Date.now() + 90000 : 0;
    if (srcsFor(FACES[cur]).join(',').indexOf(name) >= 0 || (name === 'wx' && FACES[cur] === 'clock')) draw(); else footer();
  },
  settingsChanged: function () {
    S = JSON.parse(VB.settings()); applyTheme(); load('wx', false); draw();
  },
  refreshAll: function () { loadAll(true); footer(); },
  ota: function (name) { OTA = /^[0-9A-Za-z.\-]{1,16}$/.test(name || '') ? name : ''; footer(); },
  visible: function (v) { visible = !!v; if (visible) { fetchCfg(); loadAll(false); draw(); } },
  go: go, state: function () { return { cur: cur, src: src }; }
};

/* touch: tap/swipe left-right */
var tx = null;
document.addEventListener('touchstart', function (e) { tx = (e.target.closest && e.target.closest('#sett,#hd')) ? null : e.touches[0].clientX; }, false);
document.addEventListener('touchend', function (e) {
  if (tx === null) return; var x = e.changedTouches[0].clientX, dx = x - tx, w = window.innerWidth;
  if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1)); else if (x > w * 0.6) go(cur + 1); else if (x < w * 0.4) go(cur - 1); else help();
  tx = null; e.preventDefault();
}, false);

/* boot */
window.addEventListener('load', function () { draw(); setTimeout(draw, 800); }, false);
S = JSON.parse(VB.settings());
var APPV = VB.appVersion ? VB.appVersion() : '?', OTA = VB.otaReady ? VB.otaReady() : '';
(function () { var c = cfgParse(VB.loadCfg()); if (c) cfgUse(c, false); })();
applyTheme(); scale(); window.addEventListener('resize', scale, false);
var hs = (location.hash || '').match(/face=(\w+)/); if (hs) { for (var q = 0; q < FACES.length; q++) if (FACES[q] === hs[1] || String(q + 1) === hs[1]) cur = q; }
if (/hold=1/.test(location.hash)) paused = true;
fetchCfg(); loadAll(false); draw(); started = true;
var lastSec = -1, lastMin = -1, lastDay = new Date().getDate();
setInterval(function () {
  var d = new Date();
  if (!visible) return;
  if (d.getSeconds() !== lastSec) {
    lastSec = d.getSeconds();
    if (FACES[cur] === 'clock') draw();
    else if (d.getMinutes() !== lastMin) { lastMin = d.getMinutes(); header(); footer(); }
    if (d.getSeconds() % 30 === 0) loadAll(false);
    if (Date.now() - cfgLast > 600000) fetchCfg();
    if (d.getDate() !== lastDay) { lastDay = d.getDate(); load('otd', true); }
  }
  if (S.rotate && !paused && Date.now() - lastFlip >= S.rotate * 1000) go(cur + 1);
  progress();
}, 250);
})();
