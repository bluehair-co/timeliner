// ---------- insights ----------
function stat(label, value, unit, note) {
  return '<div class="stat"><div class="label">' + label + '</div><div class="value">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div>' + (note ? '<div class="note">' + note + '</div>' : '') + '</div>';
}
function hours(i) { return Math.max(0, D.end[i] - D.start[i]) / 36e5; }
function renderInsights() {
  var n = sel.length;
  $('insightsPage').querySelectorAll('.card').forEach(function (c, k) { if (k) c.hidden = !n; });
  if (!n) {
    $('sumStats').innerHTML = '<p class="empty" style="grid-column:1/-1">No trips match your filters.</p>';
    $('sumNote').textContent = '';
    return;
  }
  needPlaces(); findHome();
  renderSummary(); renderSplit(); renderRhythm(); renderTime(); renderRoutes(); renderPlaces(); renderRecords(); renderCountries(); renderCo2();
}
function renderSummary() {
  var n = sel.length, kmT = 0, h = 0, days = {}, places = {}, cc = {}, j, i;
  for (j = 0; j < n; j++) {
    i = sel[j]; kmT += D.km[i]; h += hours(i); days[D.day[i]] = 1;
    if (D.pb[i] >= 0) places[D.pb[i]] = 1;
    if (D.ccList[D.cs[i]]) cc[D.ccList[D.cs[i]]] = 1;
    if (D.ccList[D.ce[i]]) cc[D.ccList[D.ce[i]]] = 1;
  }
  for (j = 0; j < selV.length; j++) places[D.pv[selV[j]]] = 1;
  var nd = Object.keys(days).length, d0 = D.day[sel[0]], d1 = D.day[sel[n - 1]], span = d1 - d0 + 1, d = distParts(kmT), avg = distParts(kmT / n);
  $('sumNote').textContent = d0 === d1 ? longDate(d0) : niceDate(d0) + ' – ' + niceDate(d1);
  $('sumStats').innerHTML =
    stat('Trips', fmt(n), '', fmt(n / nd, 1) + ' on days you travelled') +
    stat('Distance', d.v, d.u, avg.v + ' ' + avg.u + ' per trip on average') +
    stat('Time travelling', hoursLabel(h).replace(/ min$/, '<small>min</small>').replace(/ h( |$)/, '<small>h</small>$1'), '', hoursLabel(h / nd) + ' a day you travelled') +
    stat('Days travelled', fmt(nd), '', span > 1 ? 'Out of ' + fmt(span) + ' days (' + Math.round(nd / span * 100) + '%)' : '') +
    stat('Countries', fmt(Object.keys(cc).length), '', '') +
    stat('Places', fmt(Object.keys(places).length), '', selV.length ? fmt(selV.length) + ' stays' : 'Where trips ended');
}

var SPLIT = {
  km: { val: function (i) { return D.km[i]; }, fmt: dist },
  h: { val: hours, fmt: hoursLabel },
  n: { val: function () { return 1; }, fmt: function (v) { return tripsText(v); } }
};
function renderSplit() {
  var M_ = SPLIT[PREFS.splitM] || SPLIT.km, by = {}, total = 0;
  setPressed('#splitSeg button', function (b) { return b.dataset.m === PREFS.splitM; });
  for (var j = 0; j < sel.length; j++) { var i = sel[j], m = modeOf(i), v = M_.val(i); by[m] = (by[m] || 0) + v; total += v; }
  var ms = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }), max = by[ms[0]] || 1;
  $('splitBars').innerHTML = ms.map(function (m) {
    var share = total ? by[m] / total * 100 : 0;
    return '<div class="bar-row">' + badge(m, true) + '<div><div class="name"><span>' + (LABEL[m] || m) + '</span><span>' + (share < 1 && share > 0 ? '<1' : Math.round(share)) + '%</span></div>' +
      '<div class="track"><i style="width:' + (by[m] / max * 100).toFixed(1) + '%;background:' + modeColor(m) + '"></i></div></div><div class="val">' + M_.fmt(by[m]) + '</div></div>';
  }).join('');
}
$('splitSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-m]'); if (b) { PREFS.splitM = b.dataset.m; savePrefs(); renderSplit(); } });

function heatColor(level) { return level ? 'color-mix(in srgb, var(--accent) ' + [0, 22, 42, 62, 82, 100][level] + '%, var(--grid))' : 'var(--grid)'; }
function renderRhythm() {
  var c = [], j, k, max = 0;
  for (k = 0; k < 7; k++) c.push(new Array(24).fill(0));
  for (j = 0; j < sel.length; j++) { var i = sel[j]; c[D.dow[i]][D.hour[i]]++; }
  var vals = [];
  c.forEach(function (row) { row.forEach(function (v) { if (v) vals.push(v); if (v > max) max = v; }); });
  vals.sort(function (a, b) { return a - b; });
  // Five steps by quantile, so a few very busy hours don't wash out the rest.
  var cuts = [0.2, 0.4, 0.6, 0.8].map(function (q) { return vals[Math.floor((vals.length - 1) * q)] || 0; });
  function level(v) { if (!v) return 0; var l = 1; cuts.forEach(function (x) { if (v > x) l++; }); return Math.min(5, l); }
  var h = '<div></div>';
  for (k = 0; k < 24; k++) h += '<div class="h">' + (k % 6 === 0 ? k : '') + '</div>';
  DOW_ORDER.forEach(function (d) {
    h += '<div class="d">' + DOW[d] + '</div>';
    for (k = 0; k < 24; k++) h += '<div class="c" data-d="' + d + '" data-h="' + k + '" data-n="' + c[d][k] + '" style="background:' + heatColor(level(c[d][k])) + '"></div>';
  });
  $('rhythm').innerHTML = '<div class="rhythm" role="img" aria-label="Trips by day of the week and hour">' + h + '</div>' +
    '<div class="rhythm-scale">Fewer' + [1, 2, 3, 4, 5].map(function (l) { return '<i style="background:' + heatColor(l) + '"></i>'; }).join('') + 'More trips</div>';
}
function rhythmTip(ev) {
  var c = ev.target.closest('.c[data-d]');
  if (!c) { hideTip(); return; }
  var d = +c.dataset.d, h = +c.dataset.h, n = +c.dataset.n;
  showTip(ev, '<b>' + DOW_LONG[d] + 's, ' + pad2(h) + ':00–' + pad2((h + 1) % 24) + ':00</b><div class="row"><span>Trips started</span><span class="num">' + fmt(n) + '</span></div>');
}
$('rhythm').addEventListener('mousemove', rhythmTip);
$('rhythm').addEventListener('mouseleave', hideTip);
$('rhythm').addEventListener('click', rhythmTip);

// ---------- over time ----------
var TIME = {
  km: { title: 'Distance over time', val: function (i) { return distVal(D.km[i]); }, tick: function (v) { return fmt(v) + ' ' + distUnit(); }, show: function (v) { return fmt(v, v < 10 && v > 0 ? 1 : 0) + ' ' + distUnit(); } },
  h: { title: 'Time travelling over time', val: hours, tick: function (v) { return fmt(v, v < 10 && v % 1 ? 1 : 0) + ' h'; }, show: hoursLabel },
  n: { title: 'Trips over time', val: function () { return 1; }, tick: function (v) { return fmt(v); }, show: function (v) { return fmt(v); } },
  co2: { title: 'CO₂ over time', val: tripKg, tick: function (v) { return v >= 1000 ? fmt(v / 1000, v % 1000 ? 1 : 0) + ' t' : fmt(v) + ' kg'; }, show: co2s }
};
function svgEl(tag, attrs) {
  var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (var k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function niceMax(v) {
  if (v <= 0) return 1;
  var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
var timeData = null;
// Slot width in px for the units that scroll; years always fit the card.
var TIME_UNITS = { year: 0, month: 14, week: 14, day: 26 };
function weekStart(k) { return k * 7 - 3; }
function renderTime() {
  var mt = TIME[PREFS.timeM] || TIME.km;
  setPressed('#timeSeg button', function (b) { return b.dataset.m === PREFS.timeM; });
  $('timeTitle').textContent = mt.title;
  // Days are offered for ranges up to two months; a longer range shows weeks instead.
  var short = sel.length > 0 && D.day[sel[sel.length - 1]] - D.day[sel[0]] <= 62;
  var unit = PREFS.timeU in TIME_UNITS ? PREFS.timeU : 'year';
  if (unit === 'day' && !short) unit = 'week';
  $('timeUnitSeg').querySelector('[data-u="day"]').hidden = !short;
  setPressed('#timeUnitSeg button', function (b) { return b.dataset.u === unit; });
  // Weeks start on Monday; day 0 (1 Jan 1970) was a Thursday.
  function key(i) { return unit === 'day' ? D.day[i] : unit === 'week' ? Math.floor((D.day[i] + 3) / 7) : unit === 'month' ? D.year[i] * 12 + D.month[i] : D.year[i]; }
  var buckets = {}, present = {};
  for (var j = 0; j < sel.length; j++) {
    var i = sel[j], g = groupOf(modeOf(i)).key, k = key(i), b = buckets[k] || (buckets[k] = {});
    b[g] = (b[g] || 0) + mt.val(i); present[g] = 1;
  }
  var G = GROUPS.filter(function (g) { return present[g.key]; });
  var keys = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
  if (keys.length) { var all = []; for (var q = keys[0]; q <= keys[keys.length - 1]; q++) all.push(q); keys = all; }
  timeData = { keys: keys, buckets: buckets, G: G, unit: unit, mt: mt };
  $('timeLegend').innerHTML = G.length > 1 ? G.map(function (g) { return '<span><i style="background:' + g.color + '"></i>' + g.label + '</span>'; }).join('') : '';
  drawTime();
}
function bucketName(k, unit) {
  if (unit === 'day') return longDate(k);
  if (unit === 'week') { var a = dayToDate(weekStart(k)), z = dayToDate(weekStart(k) + 6); return 'Week of ' + a.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()] + (a.getUTCFullYear() !== z.getUTCFullYear() ? ' ' + a.getUTCFullYear() : '') + ' – ' + z.getUTCDate() + ' ' + MONTHS[z.getUTCMonth()] + ' ' + z.getUTCFullYear(); }
  if (unit === 'month') return MONTHS_LONG[k % 12] + ' ' + Math.floor(k / 12);
  return String(k);
}
function drawTime() {
  var T = timeData, host = $('timeChart');
  if (!T) return;
  var keys = T.keys, G = T.G, mt = T.mt, unit = T.unit, old = host.querySelector('.time-scroll');
  // Keep the scroll position when only the measure or the size changes; otherwise show the latest.
  var keep = old && host.dataset.view === unit + ':' + keys[0] + ':' + keys.length ? old.scrollLeft : -1;
  host.textContent = '';
  var scroll = TIME_UNITS[unit] > 0;
  host.classList.toggle('scroll', scroll);
  host.dataset.view = unit + ':' + keys[0] + ':' + keys.length;
  var W = Math.max(260, host.clientWidth), H = 220, R = 4, Tp = 8, B = 24, max = 0;
  keys.forEach(function (k) { var b = T.buckets[k]; if (b) { var s = 0; G.forEach(function (g) { s += b[g.key] || 0; }); max = Math.max(max, s); } });
  var top = niceMax(max), nt = /^2(0*)$/.test(String(top)) ? 4 : 5, widest = 0, t;
  for (t = 0; t <= nt; t++) widest = Math.max(widest, mt.tick(top * t / nt).length);
  var Lm = Math.max(30, Math.ceil(widest * 6.6) + 10), ph = H - Tp - B;
  // Scrolling units get a fixed slot width (wider if they would not fill the card) and a separate y axis.
  var pw = scroll ? Math.max(W - Lm - R, keys.length * TIME_UNITS[unit]) : W - Lm - R, slot = pw / keys.length;
  var X0 = scroll ? 0 : Lm, SW = scroll ? pw + R : W;
  var bw = Math.max(1.5, Math.min(22, slot * 0.72));
  var label = mt.title + ' per ' + unit + ', stacked by transport group';
  var svg = svgEl('svg', { width: SW, height: H, viewBox: '0 0 ' + SW + ' ' + H, role: 'img', 'aria-label': label });
  var axis = scroll ? svgEl('svg', { width: Lm, height: H, viewBox: '0 0 ' + Lm + ' ' + H, 'aria-hidden': 'true' }) : svg;
  for (t = 0; t <= nt; t++) {
    var v = top * t / nt, y = Tp + ph - ph * t / nt;
    svg.appendChild(svgEl('line', { x1: X0, x2: SW - R, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
    var tx = svgEl('text', { x: Lm - 6, y: y + 4, 'text-anchor': 'end' }); tx.textContent = mt.tick(v); axis.appendChild(tx);
  }
  // x labels: years each fit; months show the year in January; weeks are labelled at the first week of each month.
  var every = Math.max(1, Math.ceil(44 / slot));
  keys.forEach(function (k, idx) {
    var cx = X0 + slot * idx + slot / 2, b = T.buckets[k] || {}, text = null, ws, wd;
    if (unit === 'year') { if (idx % every === 0) text = k; }
    else if (unit === 'day') { if (idx % every === 0) { ws = dayToDate(k); text = ws.getUTCDate() + (ws.getUTCDate() <= every || idx === 0 ? ' ' + MONTHS[ws.getUTCMonth()] : ''); } }
    else if (unit === 'month') { if (k % 12 % (slot >= 30 ? 1 : slot * 3 >= 30 ? 3 : 6) === 0) text = k % 12 === 0 ? Math.floor(k / 12) : MONTHS[k % 12]; }
    else {
      ws = dayToDate(weekStart(k)); wd = dayToDate(weekStart(k) - 7);
      if (idx === 0 || ws.getUTCMonth() !== wd.getUTCMonth()) text = ws.getUTCMonth() === 0 || idx === 0 ? ws.getUTCFullYear() : MONTHS[ws.getUTCMonth()];
    }
    if (text !== null) {
      var lb = svgEl('text', { x: unit === 'week' ? X0 + slot * idx : cx, y: H - 6, 'text-anchor': unit === 'week' ? 'start' : 'middle' });
      lb.textContent = text;
      svg.appendChild(lb);
    }
    var y0 = Tp + ph, segs = G.filter(function (g) { return b[g.key] > 0; });
    segs.forEach(function (g, si) {
      var hgt = b[g.key] / top * ph, isTop = si === segs.length - 1, gap = si > 0 ? 2 : 0, hh = Math.max(0, hgt - gap);
      if (hh <= 0) { y0 -= hgt; return; }
      var x = cx - bw / 2, yy = y0 - hgt, r = isTop ? Math.min(4, hh, bw / 2) : 0;
      var dPath = 'M' + x + ',' + (yy + hh) + 'V' + (yy + r) + (r ? 'Q' + x + ',' + yy + ' ' + (x + r) + ',' + yy : '') +
        'H' + (x + bw - r) + (r ? 'Q' + (x + bw) + ',' + yy + ' ' + (x + bw) + ',' + (yy + r) : '') + 'V' + (yy + hh) + 'Z';
      svg.appendChild(svgEl('path', { d: dPath, fill: g.color }));
      y0 -= hgt;
    });
    var hit = svgEl('rect', { x: X0 + slot * idx, y: Tp, width: slot, height: ph, fill: 'transparent', 'data-k': k });
    svg.insertBefore(hit, svg.firstChild);
  });
  if (!scroll) { host.appendChild(svg); return; }
  var sc = document.createElement('div');
  sc.className = 'time-scroll';
  sc.appendChild(svg);
  sc.addEventListener('scroll', hideTip, { passive: true });
  host.appendChild(axis);
  host.appendChild(sc);
  sc.scrollLeft = keep >= 0 ? keep : sc.scrollWidth;
}
function timeTip(ev) {
  var r = ev.target.closest('rect[data-k]');
  $('timeChart').querySelectorAll('rect[data-k]').forEach(function (x) { x.setAttribute('fill', x === r ? 'var(--grid)' : 'transparent'); });
  if (!r) { hideTip(); return; }
  var T = timeData, k = +r.dataset.k, b = T.buckets[k] || {}, total = 0;
  var rows = T.G.map(function (g) { total += b[g.key] || 0; return '<div class="row"><span><i style="background:' + g.color + '"></i>' + g.label + '</span><span class="num">' + T.mt.show(b[g.key] || 0) + '</span></div>'; }).join('');
  showTip(ev, '<b>' + bucketName(k, T.unit) + '</b>' + (T.G.length > 1 ? rows : '') + '<div class="row" style="margin-top:4px"><span>Total</span><span class="num">' + T.mt.show(total) + '</span></div>');
}
$('timeChart').addEventListener('mousemove', timeTip);
$('timeChart').addEventListener('mouseleave', function () { hideTip(); $('timeChart').querySelectorAll('rect[data-k]').forEach(function (x) { x.setAttribute('fill', 'transparent'); }); });
$('timeChart').addEventListener('click', timeTip);
$('timeSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-m]'); if (b) { PREFS.timeM = b.dataset.m; savePrefs(); renderTime(); } });
$('timeUnitSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-u]'); if (b) { PREFS.timeU = b.dataset.u; savePrefs(); renderTime(); } });
$('insightsPage').addEventListener('scroll', hideTip, { passive: true });
var rsT = 0;
window.addEventListener('resize', function () { clearTimeout(rsT); rsT = setTimeout(function () { if (tab === 'insights') drawTime(); }, 120); });

// ---------- routes, places, records, countries ----------
function renderRoutes() {
  var by = {}, list = [];
  for (var j = 0; j < sel.length; j++) {
    var i = sel[j], a = D.pa[i], b = D.pb[i];
    if (a < 0 || b < 0 || a === b) continue;
    // Either direction counts as the same route.
    var la = placeLabel(a), lb = placeLabel(b);
    if (la === lb) continue;
    // Places with the same name (several spots in one town) count as one.
    if (la > lb) { var t = a; a = b; b = t; }
    var key = la < lb ? la + '|' + lb : lb + '|' + la, r = by[key];
    if (!r) { r = by[key] = { a: a, b: b, n: 0, km: 0, modes: {}, last: i }; list.push(r); }
    var m = modeOf(i);
    r.n++; r.km += D.km[i]; r.modes[m] = (r.modes[m] || 0) + 1;
    r.last = i;
  }
  list.sort(function (x, y) { return y.n - x.n || y.km - x.km; });
  if (!list.length) { $('topRoutes').innerHTML = '<p class="empty">No trips between two different places.</p>'; return; }
  $('topRoutes').innerHTML = list.slice(0, 8).map(function (r) {
    var ms = Object.keys(r.modes).sort(function (x, y) { return r.modes[y] - r.modes[x]; });
    return '<button type="button" class="hit-row" data-i="' + r.last + '">' + badge(ms[0], true) +
      '<span class="t"><b>' + esc(placeLabel(r.a)) + ' ↔ ' + esc(placeLabel(r.b)) + '</b><small>' + ms.slice(0, 3).map(function (m) { return LABEL[m] || m; }).join(', ') + ' · ' + dist(r.km / r.n) + ' each way</small></span>' +
      '<span class="r num">' + fmt(r.n) + '<small>trips</small></span></button>';
  }).join('');
}
function renderPlaces() {
  var by = {}, list = [], useStays = selV.length > 0, j, p;
  if (useStays) {
    for (j = 0; j < selV.length; j++) {
      var v = selV[j]; p = D.pv[v];
      var lbl = placeLabel(p), o = by[lbl] || (by[lbl] = { p: p, n: 0, h: 0 });
      o.n++; o.h += (D.ve[v] - D.vs[v]) / 36e5;
    }
  } else {
    for (j = 0; j < sel.length; j++) {
      p = D.pb[sel[j]];
      if (p < 0) continue;
      var lb2 = placeLabel(p);
      (by[lb2] || (by[lb2] = { p: p, n: 0, h: 0 })).n++;
    }
  }
  for (var k in by) list.push(by[k]);
  list.sort(function (a, b) { return useStays ? b.h - a.h : b.n - a.n; });
  $('placesTitle').textContent = useStays ? 'Where you spent time' : 'Where you went';
  $('placesNote').textContent = useStays ? 'Places you stayed, by total time there. Tap one to see it on the map.' : 'Places your trips ended, by number of trips. Tap one to see it on the map.';
  if (!list.length) { $('topPlaces').innerHTML = '<p class="empty">No places in this selection.</p>'; return; }
  $('topPlaces').innerHTML = list.slice(0, 8).map(function (o) {
    var q = D.places[o.p], cc = countryAt(q.lat, q.lng), home = o.p === D.home;
    return '<button type="button" class="hit-row" data-place="' + o.p + '"><span class="mode-badge sm" style="background:' + (home ? 'var(--accent)' : 'var(--m-other)') + '">' + icon(home ? 'home' : 'pin') + '</span>' +
      '<span class="t"><b>' + esc(placeLabel(o.p)) + '</b><small>' + (flag(cc) ? flag(cc) + ' ' : '') + esc(ccName(cc)) + (useStays ? ' · ' + fmt(o.n) + ' stay' + (o.n > 1 ? 's' : '') : '') + '</small></span>' +
      '<span class="r num">' + (useStays ? hoursLabel(o.h).replace(/ \d+ min$/, '') : fmt(o.n) + '<small>trips</small>') + '</span></button>';
  }).join('');
}
function renderRecords() {
  var best = {}, j, i, byDay = {};
  function rec(key, i_, v) { if (v > 0 && (!best[key] || v > best[key].v)) best[key] = { i: i_, v: v }; }
  for (j = 0; j < sel.length; j++) {
    i = sel[j];
    var m = modeOf(i), g = groupOf(m).key, h = hours(i);
    rec('far', i, D.km[i]);
    rec('long', i, h);
    if (g === 'air') rec('air', i, D.km[i]);
    if (g === 'road') rec('road', i, D.km[i]);
    if (g === 'transit') rec('transit', i, D.km[i]);
    if (g === 'foot') rec('foot', i, D.km[i]);
    if (g === 'bike') rec('bike', i, D.km[i]);
    if (g !== 'air' && h >= 1 / 12) rec('fast', i, D.km[i] / h);
    var dd = byDay[D.day[i]] || (byDay[D.day[i]] = { km: 0, n: 0 });
    dd.km += D.km[i]; dd.n++;
  }
  var bd = null, bn = null;
  for (var d in byDay) {
    if (!bd || byDay[d].km > byDay[bd].km) bd = d;
    if (!bn || byDay[d].n > byDay[bn].n) bn = d;
  }
  var items = [
    ['far', 'ruler', 'Longest trip', function (r) { return dist(r.v); }],
    ['long', 'clock', 'Longest time on the move', function (r) { return hoursLabel(r.v); }],
    ['air', 'FLYING', 'Longest flight', function (r) { return dist(r.v); }],
    ['road', 'CAR', 'Longest drive', function (r) { return dist(r.v); }],
    ['transit', 'TRAIN', 'Longest public transport trip', function (r) { return dist(r.v); }],
    ['foot', 'WALKING', 'Longest walk', function (r) { return dist(r.v); }],
    ['bike', 'CYCLING', 'Longest ride', function (r) { return dist(r.v); }],
    ['fast', 'bolt', 'Fastest on the ground', function (r) { return speed(r.v); }]
  ];
  var h = items.filter(function (x) { return best[x[0]]; }).map(function (x) {
    var r = best[x[0]];
    return '<button type="button" class="record" data-i="' + r.i + '"><span class="k">' + icon(x[1]) + x[2] + '</span><span class="v">' + x[3](r) + '</span><span class="s">' + esc(tripRoute(r.i)) + ' · ' + niceDate(D.day[r.i]) + '</span></button>';
  }).join('');
  if (bd) h += '<button type="button" class="record" data-day="' + bd + '"><span class="k">' + icon('calendar') + 'Furthest in a day</span><span class="v">' + dist(byDay[bd].km) + '</span><span class="s">' + longDate(+bd) + '</span></button>';
  if (bn) h += '<button type="button" class="record" data-day="' + bn + '"><span class="k">' + icon('calendar') + 'Most trips in a day</span><span class="v">' + fmt(byDay[bn].n) + '</span><span class="s">' + longDate(+bn) + '</span></button>';
  $('records').innerHTML = h;
}
// Days between records: when you were last seen in a country and next seen in the same
// one, the days in between count there too (a month between two flights is a month there).
// Built once from all the data, so a filter's edges don't cut a stay short.
var ccGaps = null;
function evDay(ms, off) {
  if (off !== NO_OFF) return Math.floor((ms + off * 60000) / 864e5);
  var d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}
function countryGaps() {
  if (ccGaps && ccGaps.D === D) return ccGaps.list;
  var ev = [], i, k;
  for (i = 0; i < D.day.length; i++) ev.push([D.start[i], D.day[i], D.cs[i]], [D.end[i], evDay(D.end[i], D.off[i]), D.ce[i]]);
  for (i = 0; i < D.vs.length; i++) ev.push([D.vs[i], D.vday[i], D.vcc[i]], [D.ve[i], evDay(D.ve[i], D.voff[i]), D.vcc[i]]);
  ev.sort(function (a, b) { return a[0] - b[0]; });
  var list = [];   // [country index, first day, last day] of each gap
  for (k = 1; k < ev.length; k++) {
    var a = ev[k - 1], b = ev[k];
    if (a[2] === b[2] && D.ccList[a[2]] && b[1] > a[1] + 1) list.push([a[2], a[1] + 1, b[1] - 1]);
  }
  ccGaps = { D: D, list: list };
  return list;
}
function renderCountries() {
  var by = {};
  function add(k, d) {
    var cc = D.ccList[k];
    if (!cc) return;
    var c = by[cc] || (by[cc] = { cc: cc, days: {}, first: d, last: d });
    c.days[d] = 1; if (d < c.first) c.first = d; if (d > c.last) c.last = d;
  }
  for (var j = 0; j < sel.length; j++) { var i = sel[j]; add(D.cs[i], D.day[i]); add(D.ce[i], D.day[i]); }
  for (var v = 0; v < selV.length; v++) add(D.vcc[selV[v]], D.vday[selV[v]]);
  // Gap days count when they pass the same day filters as trips and stays.
  // A year with no records at all isn't in the year filter, so 'all years' lets it through.
  var allCC = F.countries.size === M.countries.length, allY = F.years.size === M.years.length;
  countryGaps().forEach(function (g) {
    if (!allCC && !F.countries.has(g[0])) return;
    for (var d = g[1]; d <= g[2]; d++) {
      if (!dayOk(d)) continue;
      var x = dayToDate(d);
      if ((allY || F.years.has(x.getUTCFullYear())) && F.months.has(x.getUTCMonth()) && F.dows.has(x.getUTCDay())) add(g[0], d);
    }
  });
  var list = Object.keys(by).map(function (k) { var c = by[k]; c.n = Object.keys(c.days).length; return c; }).sort(function (a, b) { return b.n - a.n; });
  $('ccNote').textContent = list.length ? fmt(list.length) + ' countr' + (list.length === 1 ? 'y' : 'ies') + ', by days you were there. Days between your records count too when you were in the same country before and after. Flights count only where they took off and landed.' : '';
  var max = list.length ? list[0].n : 1;
  $('ccList').innerHTML = list.length ? list.slice(0, 30).map(function (c) {
    return '<div class="hit-row" style="cursor:default"><span class="flag" aria-hidden="true" style="font-size:22px;width:28px;text-align:center">' + (flag(c.cc) || '·') + '</span>' +
      '<span class="t"><b>' + esc(ccName(c.cc)) + '</b><small>' + (c.first === c.last ? niceDate(c.first) : niceDate(c.first) + ' – ' + niceDate(c.last)) + '</small><span class="meter" style="display:block;margin-top:6px"><i style="width:' + (c.n / max * 100).toFixed(1) + '%"></i></span></span>' +
      '<span class="r num">' + fmt(c.n) + '<small>day' + (c.n > 1 ? 's' : '') + '</small></span></div>';
  }).join('') + (list.length > 30 ? '<p class="fine" style="margin-top:8px">And ' + fmt(list.length - 30) + ' more.</p>' : '') : '<p class="empty">No countries in this selection.</p>';
}
function renderCo2() {
  var by = {}, total = 0, days = {};
  for (var j = 0; j < sel.length; j++) { var i = sel[j], g = groupOf(modeOf(i)), kg = tripKg(i); by[g.key] = (by[g.key] || 0) + kg; total += kg; days[D.day[i]] = 1; }
  var G = GROUPS.filter(function (g) { return by[g.key] > 0; }), max = G.reduce(function (m, g) { return Math.max(m, by[g.key]); }, 0) || 1, c = co2(total);
  var nd = Object.keys(days).length;
  $('co2Card').innerHTML = '<div class="stats" style="margin-bottom:14px">' + stat('Total', c.v, c.u, '') + stat('Per day travelled', co2(total / Math.max(1, nd)).v, co2(total / Math.max(1, nd)).u, '') + '</div>' +
    '<div class="bars">' + (G.length ? G.map(function (g) {
      return '<div class="bar-row"><span class="mode-badge sm" style="background:' + g.color + '">' + icon(g.modes[0]) + '</span><div><div class="name"><span>' + g.label + '</span><span>' + Math.round(by[g.key] / total * 100) + '%</span></div>' +
        '<div class="track"><i style="width:' + (by[g.key] / max * 100).toFixed(1) + '%;background:' + g.color + '"></i></div></div><div class="val">' + co2s(by[g.key]) + '</div></div>';
    }).join('') : '<p class="empty">No emissions from these trips.</p>') + '</div>';
}
document.querySelector('#insightsPage .cards').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-i],[data-day],[data-place]');
  if (!b) return;
  if (b.dataset.i) { setTab('timeline'); tlSelect(+b.dataset.i, true); }
  else if (b.dataset.day) { setTab('map'); showDay(+b.dataset.day); }
  else {
    var q = D.places[+b.dataset.place];
    if (PREFS.proj !== 'merc') setProj('merc');
    setTab('map');
    if (map) map.setView([q.lat, q.lng], 15);
  }
});
