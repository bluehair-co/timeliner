// Timeliner parser: turns Google Timeline exports into a flat list of trips
// {start, end, day, mode, km, est} with their GPS trails, plus the places stayed.
// Runs inside a Web Worker (or on the main thread as a fallback).
// Supported: on-device Timeline.json (Android), iPhone Timeline export,
// Takeout Semantic Location History monthly files, Takeout Records.json.

var MODE_ALIASES = {
  WALKING: ['WALKING', 'ON_FOOT', 'WALK', 'HIKING'],
  RUNNING: ['RUNNING'],
  CYCLING: ['CYCLING', 'ON_BICYCLE', 'BIKING'],
  CAR: ['IN_PASSENGER_VEHICLE', 'DRIVING', 'IN_CAR', 'CAR'],
  TAXI: ['IN_TAXI', 'TAXI'],
  // Generic "in a vehicle" without the kind; Google Maps shows these as "Moving".
  VEHICLE: ['IN_VEHICLE', 'MOTOR_VEHICLE', 'IN_ROAD_VEHICLE'],
  MOTORCYCLE: ['MOTORCYCLING', 'ON_MOTORCYCLE'],
  BUS: ['IN_BUS', 'BUS'],
  TRAIN: ['IN_TRAIN', 'IN_RAIL_VEHICLE', 'TRAIN'],
  TRAM: ['IN_TRAM', 'TRAM'],
  SUBWAY: ['IN_SUBWAY', 'SUBWAY'],
  FERRY: ['IN_FERRY', 'FERRY'],
  BOAT: ['SAILING', 'KAYAKING', 'ROWING', 'IN_BOAT', 'MOTOR_BOAT', 'BOATING'],
  FLYING: ['FLYING', 'IN_PLANE', 'IN_AIRPLANE'],
  SKIING: ['SKIING', 'SNOWBOARDING', 'SLEDDING'],
  OTHER: ['HORSEBACK_RIDING', 'SWIMMING', 'SKATING', 'SKATEBOARDING', 'INLINE_SKATING', 'WHEELCHAIR'],
  CABLE: ['IN_CABLECAR', 'IN_CABLE_CAR', 'IN_GONDOLA_LIFT', 'IN_FUNICULAR'],
  UNKNOWN: ['UNKNOWN_ACTIVITY_TYPE', 'UNKNOWN', 'TILTING', 'EXITING_VEHICLE', 'STILL', 'STATIONARY', '']
};
var ALIAS = {};
Object.keys(MODE_ALIASES).forEach(function (k) {
  MODE_ALIASES[k].forEach(function (a) { ALIAS[a] = k; });
});
function normMode(raw) {
  var s = String(raw == null ? '' : raw).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return ALIAS[s] || ALIAS['IN_' + s] || 'UNKNOWN';
}

// "52.37°, 4.89°" | "geo:52.37,4.89" | {latLng: "..."} | {latitudeE7, longitudeE7}
var LL_RE = /(-?\d+(?:\.\d+)?)[^\d-]+?(-?\d+(?:\.\d+)?)/;
function parseLL(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.latitudeE7 != null) return e7(v.latitudeE7, v.longitudeE7);
    if (v.latE7 != null) return e7(v.latE7, v.lngE7);
    v = v.latLng || v.LatLng || v.point || v.location;
    if (v == null || typeof v === 'object') return null;
  }
  var m = LL_RE.exec(String(v));
  if (!m) return null;
  var a = parseFloat(m[1]), b = parseFloat(m[2]);
  if (!(a >= -90 && a <= 90 && b >= -180 && b <= 180) || (a === 0 && b === 0)) return null;
  return [a, b];
}
function e7(a, b) {
  if (a == null || b == null) return null;
  if (a > 900000000) a -= 4294967296;
  if (b > 1800000000) b -= 4294967296;
  return [a / 1e7, b / 1e7];
}
function km(a, b) {
  if (!a || !b) return 0;
  var R = 6371.0088, r = Math.PI / 180;
  var dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Returns {ms, off} where off is the UTC offset in minutes written in the
// timestamp (so dates follow local time where you were), or null.
var OFF_RE = /([+-])(\d{2}):?(\d{2})$/;
function parseTime(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return { ms: s, off: null };
  s = String(s);
  if (/^\d+$/.test(s)) return { ms: Number(s), off: null };
  var ms = Date.parse(s);
  if (!isFinite(ms)) return null;
  var m = /T.*/.test(s) ? OFF_RE.exec(s) : null;
  var off = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
  return { ms: ms, off: off };
}
function dayOf(t) {
  if (!t) return null;
  if (t.off != null) return Math.floor((t.ms + t.off * 60000) / 864e5);
  var d = new Date(t.ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}

// Trip collector. est: 0 = distance from Timeline, 1 = from the GPS path,
// 2 = straight line between start and end (an underestimate on the ground).
// Each trip's GPS trail is kept as lat/lng pairs in one flat list (pathPts),
// with pathOff[i]..pathOff[i+1] marking trip i's slice, and pathT holding each
// point's time in seconds after the trip started.
// Places stayed (visits) are kept alongside: start, end, position, kind (1 home, 2 work).
function Collector() {
  this.start = []; this.end = []; this.day = []; this.mode = []; this.km = []; this.est = []; this.off = []; this.orig = []; this.from = []; this.to = [];
  this.pathPts = []; this.pathT = []; this.pathOff = [0];
  this.vs = []; this.ve = []; this.vday = []; this.voff = []; this.vll = []; this.vtype = []; this.vname = [];
}
// Trips Timeline couldn't classify get a mode guessed from their average speed,
// marked with the GUESSED bit in est.
var GUESSED = 4;
function guessMode(dist, hours) {
  if (!(hours > 0)) return null;
  var v = dist / hours;
  if (v < 7) return 'WALKING';
  if (v < 25) return 'CYCLING';
  if (v < 300) return 'CAR';
  return 'FLYING';
}
// Fastest believable average speed per mode (km/h). Timeline sometimes stores an
// absurd distance on a typed trip (e.g. 5,843 km for a car hop across Amsterdam).
var MAX_KMH = { WALKING: 15, RUNNING: 25, CYCLING: 50, CAR: 200, TAXI: 200, VEHICLE: 200, MOTORCYCLE: 200, BUS: 150, TRAIN: 350,
  TRAM: 100, SUBWAY: 120, FERRY: 80, BOAT: 80, CABLE: 60, SKIING: 120, OTHER: 60, FLYING: 1100 };
var FIXED = 8, NO_OFF = 32767;
Collector.prototype.add = function (mode, st, et, dist, est, a, b, pts, ptsT) {
  if (!st || !(dist > 0) || dist > 25000) return;
  var given = dist;
  var cap = MAX_KMH[mode], hours = et ? (et.ms - st.ms) / 36e5 : 0;
  if (cap && hours > 0 && dist / hours > cap) {
    // Too fast for this mode: trust the GPS trail if there is one, else the straight line, never more than Timeline said.
    var ln = km(a, b), trail = pts && pts.length ? pathKm([a].concat(pts, [b]).filter(Boolean)) : 0;
    var alt = trail > ln && trail / hours <= cap ? trail : ln, altEst = alt === trail && trail > ln ? 1 : 2;
    // A flight whose distance matches its ends just has a broken duration: keep it.
    if (mode === 'FLYING' && dist <= 1.2 * ln + 50) alt = dist;
    if (dist - alt > 1 && alt < dist * 0.8) { dist = alt; est = altEst | FIXED; }
    // Still far too fast over 250+ km: that was a flight Timeline typed as ground transport.
    // (Not trains: a 300+ km/h train is a fast train with a squeezed duration.)
    if (mode !== 'FLYING' && mode !== 'TRAIN' && ln >= 250 && dist / hours >= 500) { mode = 'FLYING'; est |= GUESSED; }
    if (!(dist > 0)) return;
  }
  if (mode === 'UNKNOWN' && et) {
    // Untyped trips often carry a broken distance (e.g. 148 km for a 16 km hop).
    // When it's far longer than the straight line between the ends, use the straight line.
    var line = km(a, b);
    if (line > 0 && dist > 3 * line + 5) { dist = line; est = 2; }
    var g = guessMode(dist, (et.ms - st.ms) / 36e5);
    // Too fast for the ground but under 250 km apart is a GPS jump, not a flight: leave it out.
    if (g === 'FLYING' && !(line >= 250)) g = null;
    if (g) { mode = g; est |= GUESSED; }
  }
  var d = dayOf(st);
  if (d == null || !isFinite(d)) return;
  this.start.push(st.ms); this.end.push(et ? et.ms : st.ms); this.day.push(d);
  this.mode.push(mode); this.km.push(dist); this.est.push(est);
  // UTC offset in minutes (NO_OFF when the file doesn't say) and Timeline's own distance when we replaced it.
  this.off.push(st.off != null ? st.off : NO_OFF); this.orig.push(dist !== given ? given : 0);
  this.from.push(a ? a[0] : NaN, a ? a[1] : NaN); this.to.push(b ? b[0] : NaN, b ? b[1] : NaN);
  // No GPS in the air, so flights keep only their two ends.
  if (mode !== 'FLYING') {
    var dur = et ? Math.max(0, (et.ms - st.ms) / 1000) : 0, trail = [], times = [], i;
    if (a) { trail.push(a); times.push(0); }
    for (i = 0; pts && i < pts.length; i++) {
      if (!pts[i]) continue;
      trail.push(pts[i]);
      var tt = ptsT && ptsT[i] != null ? (ptsT[i] - st.ms) / 1000 : NaN;
      times.push(tt >= 0 && tt <= dur ? tt : NaN);
    }
    if (b) { trail.push(b); times.push(dur); }
    fillTimes(trail, times, dur);
    var last = null;
    for (i = 0; i < trail.length; i++) {
      // Skip points within ~20 m of the previous one; they add size but nothing visible.
      if (last && Math.abs(trail[i][0] - last[0]) < 0.0002 && Math.abs(trail[i][1] - last[1]) < 0.0003) {
        // The trip still ends when it ends, even if its last point repeats the one before.
        if (i === trail.length - 1) this.pathT[this.pathT.length - 1] = times[i];
        continue;
      }
      this.pathPts.push(trail[i][0], trail[i][1]); this.pathT.push(times[i]); last = trail[i];
    }
  }
  this.pathOff.push(this.pathPts.length / 2);
};
// Points without a timestamp get one by distance between the nearest timed points around them,
// and times are kept in order.
function fillTimes(pts, t, dur) {
  var n = pts.length, i, j;
  if (!n) return;
  if (!(t[0] >= 0)) t[0] = 0;
  if (!(t[n - 1] >= 0)) t[n - 1] = dur;
  for (i = 1; i < n; i++) if (t[i] < t[i - 1]) t[i] = NaN;
  if (!(t[n - 1] >= t[0])) t[n - 1] = Math.max(t[0], dur);
  for (i = 1; i < n; i++) {
    if (t[i] >= 0) continue;
    for (j = i + 1; j < n && !(t[j] >= 0); j++);
    var total = 0, k, seg = [];
    for (k = i; k <= j; k++) { total += km(pts[k - 1], pts[k]); seg.push(total); }
    for (k = i; k < j; k++) t[k] = t[i - 1] + (t[j] - t[i - 1]) * (total ? seg[k - i] / total : (k - i + 1) / (j - i + 1));
    i = j;
  }
}
var HOME = 1, WORK = 2;
Collector.prototype.visit = function (st, et, ll, type, name) {
  if (!st || !et || !ll || !(et.ms > st.ms)) return;
  var d = dayOf(st);
  if (d == null || !isFinite(d)) return;
  var k = String(type || '').toUpperCase();
  this.vs.push(st.ms); this.ve.push(et.ms); this.vday.push(d); this.voff.push(st.off != null ? st.off : NO_OFF);
  this.vll.push(ll[0], ll[1]); this.vtype.push(/HOME/.test(k) ? HOME : /WORK/.test(k) ? WORK : 0); this.vname.push(name || '');
};
function pathKm(pts) {
  var t = 0;
  for (var i = 1; i < pts.length; i++) t += km(pts[i - 1], pts[i]);
  return t;
}
function addActivity(c, type, st, et, meters, a, b, pts, ptsT) {
  var mode = normMode(type), d = Number(meters) / 1000, est = 0;
  if (!(d > 0) && pts && pts.length > 1) { d = pathKm(pts); est = 1; }
  if (!(d > 0)) { d = km(a, b); est = 2; }
  c.add(mode, st, et, d, est, a, b, pts, ptsT);
}
// [[ms, ll], …] → {pts, ts}
function split(list) {
  if (!list) return { pts: null, ts: null };
  return { pts: list.map(function (x) { return x[1]; }), ts: list.map(function (x) { return x[0]; }) };
}

// Known bad points in the owner's Timeline, fixed by hand. Each is a single stray
// location fix: points within 50 km of `bad` inside [from, to] are ignored, and a
// trip that starts or ends there takes `fix` (and the straight-line distance) instead.
var BAD_POINTS = [
  // 12 Apr 2026 Toronto → Amsterdam: one fix in Playa del Carmen, Mexico, mid-flight.
  { from: '2026-04-12T20:00:00Z', to: '2026-04-13T05:00:00Z', bad: [20.6733, -87.024], fix: [43.6777, -79.6248] }
];
function badPoint(ms, ll) {
  for (var i = 0; ll && i < BAD_POINTS.length; i++) {
    var b = BAD_POINTS[i];
    if (ms >= Date.parse(b.from) && ms <= Date.parse(b.to) && km(ll, b.bad) < 50) return b;
  }
  return null;
}
function parseAndroid(o, c) {
  var segs = o.semanticSegments || [], i, s, paths = [];
  // Path points are stored in separate segments; index them by time so trips without a distance can use them.
  for (i = 0; i < segs.length; i++) {
    s = segs[i];
    if (s.timelinePath) for (var j = 0; j < s.timelinePath.length; j++) {
      var p = s.timelinePath[j], t = parseTime(p.time) || parseTime(s.startTime), ll = parseLL(p.point);
      if (t && ll && !badPoint(t.ms, ll)) paths.push([t.ms, ll]);
    }
  }
  paths.sort(function (x, y) { return x[0] - y[0]; });
  for (i = 0; i < segs.length; i++) {
    s = segs[i];
    var st = parseTime(s.startTime), et = parseTime(s.endTime);
    if (s.visit) {
      var tc = s.visit.topCandidate || {};
      c.visit(st, et, parseLL(tc.placeLocation), tc.semanticType, '');
    }
    if (!s.activity) continue;
    var a = s.activity, p = split(st && et ? between(paths, st.ms, et.ms) : null);
    var aLL = parseLL(a.start), bLL = parseLL(a.end), meters = a.distanceMeters, bad;
    if (st && (bad = badPoint(st.ms, aLL))) { aLL = bad.fix; meters = km(aLL, bLL) * 1000; }
    if (et && (bad = badPoint(et.ms, bLL))) { bLL = bad.fix; meters = km(aLL, bLL) * 1000; }
    addActivity(c, a.topCandidate && a.topCandidate.type, st, et, meters, aLL, bLL, p.pts, p.ts);
  }
}
function between(L, a, b) {
  var lo = 0, hi = L.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (L[mid][0] < a) lo = mid + 1; else hi = mid; }
  var out = [];
  for (var i = lo; i < L.length && L[i][0] <= b; i++) out.push(L[i]);
  return out;
}

function parseIos(arr, c) {
  var paths = [], i, it;
  for (i = 0; i < arr.length; i++) {
    it = arr[i];
    var st0 = it && it.timelinePath && parseTime(it.startTime);
    if (st0) for (var j = 0; j < it.timelinePath.length; j++) {
      var p = it.timelinePath[j], ll = parseLL(p.point);
      if (ll) paths.push([st0.ms + (Number(p.durationMinutesOffsetFromStartTime) || 0) * 60000, ll]);
    }
  }
  paths.sort(function (x, y) { return x[0] - y[0]; });
  for (i = 0; i < arr.length; i++) {
    it = arr[i];
    if (!it) continue;
    var st = parseTime(it.startTime), et = parseTime(it.endTime);
    if (it.visit) {
      var tc = it.visit.topCandidate || {};
      c.visit(st, et, parseLL(tc.placeLocation), tc.semanticType, '');
    }
    if (!it.activity) continue;
    var a = it.activity, p = split(st && et ? between(paths, st.ms, et.ms) : null);
    addActivity(c, a.topCandidate && a.topCandidate.type, st, et, a.distanceMeters, parseLL(a.start), parseLL(a.end), p.pts, p.ts);
  }
}

function parseSemantic(o, c) {
  var objs = o.timelineObjects || [];
  for (var i = 0; i < objs.length; i++) {
    var v = objs[i].placeVisit;
    if (v) {
      var vd = v.duration || {}, loc = v.location || {};
      c.visit(parseTime(vd.startTimestamp || vd.startTimestampMs), parseTime(vd.endTimestamp || vd.endTimestampMs),
        parseLL(loc) || parseLL(v.centerLatE7 != null ? { latE7: v.centerLatE7, lngE7: v.centerLngE7 } : null), loc.semanticType, loc.name);
    }
    var a = objs[i].activitySegment;
    if (!a) continue;
    var d = a.duration || {}, pts = [], j, w;
    w = (a.waypointPath && a.waypointPath.waypoints) || [];
    for (j = 0; j < w.length; j++) pts.push(parseLL(w[j]));
    // Prefer the recorded raw path when it is more detailed than the waypoints.
    var raw = ((a.simplifiedRawPath && a.simplifiedRawPath.points) || []).map(parseLL).filter(Boolean);
    pts = pts.filter(Boolean);
    if (raw.length > pts.length) pts = raw;
    var meters = a.distance != null ? a.distance : (a.waypointPath && a.waypointPath.distanceMeters);
    var type = a.activityType || (a.activities && a.activities[0] && a.activities[0].activityType);
    addActivity(c, type, parseTime(d.startTimestamp || d.startTimestampMs), parseTime(d.endTimestamp || d.endTimestampMs),
      meters, parseLL(a.startLocation), parseLL(a.endLocation), pts);
  }
}

// Records.json has raw points only, so trips are rebuilt: consecutive points
// with the same transport mode form a trip, and a long fast jump between
// two points (no data while in the air) counts as a flight.
function RecordTrips(c) { this.c = c; this.prev = null; this.cur = null; }
RecordTrips.prototype.point = function (ll, t, mode) {
  if (!ll || !t) return;
  var p = this.prev;
  this.prev = { ll: ll, t: t };
  if (!p || t.ms <= p.t.ms) return;
  var d = km(p.ll, ll), h = (t.ms - p.t.ms) / 36e5;
  if (d > 150 && h < 20 && d / h > 180) { this.flush(); this.c.add('FLYING', p.t, t, d, 2, p.ll, ll, null); return; }
  if (h > 0.5) { this.flush(); return; }
  var cur = this.cur;
  if (mode === 'UNKNOWN') { if (!cur || d < 0.1) return; mode = cur.mode; }
  if (!cur || cur.mode !== mode) { this.flush(); this.cur = cur = { mode: mode, st: p.t, a: p.ll, d: 0, pts: [], ts: [] }; }
  cur.d += d; cur.et = t; cur.b = ll; cur.pts.push(ll); cur.ts.push(t.ms);
};
RecordTrips.prototype.flush = function () {
  var cur = this.cur;
  if (cur && cur.mode !== 'UNKNOWN' && cur.d > 0.05) this.c.add(cur.mode, cur.st, cur.et, cur.d, 1, cur.a, cur.b, cur.pts.slice(0, -1), cur.ts.slice(0, -1));
  this.cur = null;
};
function recordMode(L) {
  var a = L.activity && L.activity[0] && L.activity[0].activity, best = null;
  if (!a) return 'UNKNOWN';
  for (var k = 0; k < a.length; k++) if (!best || a[k].confidence > best.confidence) best = a[k];
  return best ? normMode(best.type) : 'UNKNOWN';
}
function addRecord(L, rt) {
  rt.point(e7(L.latitudeE7, L.longitudeE7), parseTime(L.timestamp != null ? L.timestamp : L.timestampMs), recordMode(L));
}
function parseRecords(o, c) {
  var locs = o.locations || [], rt = new RecordTrips(c);
  for (var i = 0; i < locs.length; i++) addRecord(locs[i], rt);
  rt.flush();
}

// Source codes, highest priority first when the same day appears in several exports.
// Strava activities don't compete per day; they replace the Timeline trips they cover (see withStrava).
// Simulated trips (an on-device-format file with "simulated": true at the top) don't compete per day
// either; they replace whatever overlaps them in time (see merge).
var SRC = { device: 0, ios: 1, semantic: 2, records: 3, sim: 8, strava: 9 };
var KIND_LABEL = ['Timeline.json (on-device)', 'iPhone Timeline export', 'Takeout Semantic Location History', 'Takeout Records.json'];
KIND_LABEL[SRC.strava] = 'Strava';
KIND_LABEL[SRC.sim] = 'Simulated trips';
var MODES = Object.keys(MODE_ALIASES);
var MODE_IDX = {};
MODES.forEach(function (m, i) { MODE_IDX[m] = i; });

// A guessed flight next to a flight Timeline already recorded (same airport, within
// a few hours) is the same journey seen twice: keep only the recorded one.
function dropDuplicateFlights(c) {
  var real = [], drop = {}, i, j, any = false;
  for (i = 0; i < c.mode.length; i++) if (c.mode[i] === 'FLYING' && !(c.est[i] & GUESSED)) real.push(i);
  for (i = 0; i < c.mode.length; i++) {
    if (c.mode[i] !== 'FLYING' || !(c.est[i] & GUESSED)) continue;
    for (j = 0; j < real.length; j++) {
      var r = real[j];
      if (Math.abs(c.start[r] - c.start[i]) > 6 * 36e5) continue;
      var a = [c.from[2 * i], c.from[2 * i + 1]], b = [c.from[2 * r], c.from[2 * r + 1]];
      if (km(a, b) < 100) { drop[i] = true; any = true; break; }
    }
  }
  if (!any) return c;
  var o = new Collector();
  ['vs', 've', 'vday', 'voff', 'vll', 'vtype', 'vname'].forEach(function (k) { o[k] = c[k]; });
  for (i = 0; i < c.mode.length; i++) {
    if (drop[i]) continue;
    o.start.push(c.start[i]); o.end.push(c.end[i]); o.day.push(c.day[i]); o.mode.push(c.mode[i]); o.km.push(c.km[i]); o.est.push(c.est[i]); o.off.push(c.off[i]); o.orig.push(c.orig[i]);
    o.from.push(c.from[2 * i], c.from[2 * i + 1]); o.to.push(c.to[2 * i], c.to[2 * i + 1]);
    for (j = c.pathOff[i]; j < c.pathOff[i + 1]; j++) { o.pathPts.push(c.pathPts[2 * j], c.pathPts[2 * j + 1]); o.pathT.push(c.pathT[j]); }
    o.pathOff.push(o.pathPts.length / 2);
  }
  return o;
}
function finish(c, src) {
  c = dropDuplicateFlights(c);
  return {
    src: src, kind: KIND_LABEL[src],
    start: Float64Array.from(c.start), end: Float64Array.from(c.end), day: Int32Array.from(c.day),
    mode: Uint8Array.from(c.mode.map(function (m) { return MODE_IDX[m]; })),
    km: Float32Array.from(c.km), est: Uint8Array.from(c.est), off: Int16Array.from(c.off), orig: Float32Array.from(c.orig),
    from: Float32Array.from(c.from), to: Float32Array.from(c.to),
    pathPts: Float32Array.from(c.pathPts), pathT: Float32Array.from(c.pathT), pathOff: Uint32Array.from(c.pathOff),
    vs: Float64Array.from(c.vs), ve: Float64Array.from(c.ve), vday: Int32Array.from(c.vday), voff: Int16Array.from(c.voff),
    vll: Float32Array.from(c.vll), vtype: Uint8Array.from(c.vtype), vname: c.vname
  };
}
var NOT_TIMELINE = "This file doesn't look like Google Timeline data. Pick Timeline.json from your phone, or Records.json / Semantic Location History files from Google Takeout.";
function parseTimeline(o) {
  var c = new Collector(), src;
  if (Array.isArray(o)) { src = SRC.ios; parseIos(o, c); }
  else if (o && o.semanticSegments) { src = o.simulated === true ? SRC.sim : SRC.device; parseAndroid(o, c); }
  else if (o && o.locations) { src = SRC.records; parseRecords(o, c); }
  else if (o && o.timelineObjects) { src = SRC.semantic; parseSemantic(o, c); }
  else throw new Error(NOT_TIMELINE);
  return finish(c, src);
}

// What kind of file is this, judging by its first few KB (so huge unrelated
// Takeout files such as "Timeline Edits.json" are skipped without reading them).
function sniff(head) {
  if (/^\s*\[/.test(head)) return 'ios';
  if (/"semanticSegments"\s*:/.test(head)) return 'device';
  if (/"timelineObjects"\s*:/.test(head)) return 'semantic';
  if (/^\s*\{\s*"locations"\s*:/.test(head)) return 'records';
  return null;
}

// Records.json can be several hundred MB, too big to load as one string.
// Read it in 8 MB slices and parse one location entry at a time.
function parseRecordsStream(file, onProgress) {
  var c = new Collector(), rt = new RecordTrips(c);
  var CH = 8 << 20, off = 0, dec = new TextDecoder();
  var buf = '', pos = 0, depth = 0, inStr = false, esc = false, start = -1;
  function step() {
    if (off >= file.size) { rt.flush(); return Promise.resolve(finish(c, SRC.records)); }
    return file.slice(off, off + CH).arrayBuffer().then(function (ab) {
      off += ab.byteLength;
      buf += dec.decode(new Uint8Array(ab), { stream: off < file.size });
      for (var i = pos, n = buf.length; i < n; i++) {
        var ch = buf.charCodeAt(i);
        if (inStr) { if (esc) esc = false; else if (ch === 92) esc = true; else if (ch === 34) inStr = false; continue; }
        if (ch === 34) inStr = true;
        else if (ch === 123 || ch === 91) { depth++; if (depth === 3 && ch === 123) start = i; }
        else if (ch === 125 || ch === 93) {
          depth--;
          if (depth === 2 && ch === 125 && start >= 0) {
            try { addRecord(JSON.parse(buf.slice(start, i + 1)), rt); } catch (e) { /* skip a damaged entry */ }
            start = -1;
          }
        }
      }
      if (start >= 0) { buf = buf.slice(start); start = 0; pos = buf.length; } else { buf = ''; pos = 0; }
      onProgress(off / file.size);
      return step();
    });
  }
  return step();
}

// ---------- Strava ----------
// Strava's account export is a ZIP with activities.csv (one row per activity, with its
// type and file name) and an activities/ folder holding each recording as .gpx, .tcx or
// .fit, often gzipped. Single activity files work too. Every activity with GPS becomes a
// trip marked with the STRAVA bit in est; its track is thinned for the map, but the
// distance is measured on the full track.
var STRAVA = 16;
var NO_STRAVA = 'No Strava activities with GPS were found in this file.';
function isStravaName(name) { return /\.(zip|gpx|tcx|fit)(\.gz)?$/i.test(name); }

// Activity type → mode. Covers Strava's English names, the numbers its GPX files use,
// and a few translated names. null means skip (virtual rides happen on a map that isn't the world).
function stravaMode(t) {
  var s = String(t == null ? '' : t).trim().toLowerCase();
  if (!s) return 'UNKNOWN';
  var num = { 1: 'CYCLING', 4: 'WALKING', 9: 'RUNNING', 10: 'WALKING', 17: null, 18: 'CYCLING' };
  if (/^\d+$/.test(s)) return s in num ? num[s] : 'UNKNOWN';
  if (/virtu/.test(s)) return null;
  if (/ride|bik|cycl|velomobile|fiets|bici|v[ée]lo|rad/.test(s)) return 'CYCLING';
  if (/run|hardloop|carrera|course|lauf/.test(s)) return 'RUNNING';
  if (/walk|hik|wandel|camin|marche|senderismo|randonn/.test(s)) return 'WALKING';
  if (/ski|snowboard/.test(s)) return 'SKIING';
  if (/kayak|canoe|row|paddl|sail|kitesurf|windsurf/.test(s)) return 'BOAT';
  return normMode(s);
}

function gunzip(buf) {
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
function maybeGunzip(name, buf) { return /\.gz$/i.test(name) ? gunzip(buf) : Promise.resolve(buf); }

// GPX and TCX are small enough XML to read with patterns (Web Workers have no DOMParser).
function attr(s, name) { var m = new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']+)').exec(s); return m ? parseFloat(m[1]) : NaN; }
function tag(s, name) { var m = new RegExp('<(?:\\w+:)?' + name + '\\b[^>]*>([^<]*)<').exec(s); return m ? m[1].trim() : ''; }
function readGpx(txt) {
  var re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g, m, pts = [], ts = [];
  while ((m = re.exec(txt))) {
    var lat = attr(m[1], 'lat'), lng = attr(m[1], 'lon'), t = parseTime(tag(m[2], 'time'));
    if (t && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat || lng)) { pts.push([lat, lng]); ts.push(t.ms); }
  }
  return { type: tag(txt, 'type'), pts: pts, ts: ts };
}
function readTcx(txt) {
  var re = /<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/g, m, pts = [], ts = [], sp = /<Activity\b[^>]*Sport\s*=\s*"([^"]*)"/.exec(txt);
  while ((m = re.exec(txt))) {
    var lat = parseFloat(tag(m[1], 'LatitudeDegrees')), lng = parseFloat(tag(m[1], 'LongitudeDegrees')), t = parseTime(tag(m[1], 'Time'));
    if (t && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat || lng)) { pts.push([lat, lng]); ts.push(t.ms); }
  }
  return { type: sp ? sp[1] : '', pts: pts, ts: ts };
}
// FIT is Garmin's binary format. Only the record messages (time and position) and the
// sport are read; everything else is skipped by the sizes its definitions give.
var FIT_EPOCH = 631065600000, FIT_SPORT = { 1: 'RUNNING', 2: 'CYCLING', 11: 'WALKING', 17: 'WALKING', 21: 'CYCLING', 12: 'SKIING', 13: 'SKIING', 14: 'SKIING', 15: 'BOAT', 37: 'BOAT', 41: 'BOAT' };
function readFit(buf) {
  var v = new DataView(buf), hs = v.getUint8(0), end = Math.min(buf.byteLength, hs + v.getUint32(4, true)), p = hs;
  var defs = {}, lastTs = 0, pts = [], ts = [], sport = null, virtual = false;
  while (p < end) {
    var h = v.getUint8(p++), local, d, ct = null;
    if (h & 0x80) { local = (h >> 5) & 3; var o = h & 0x1f; ct = (lastTs & ~0x1f) + o; if (o < (lastTs & 0x1f)) ct += 0x20; }
    else if (h & 0x40) {
      var le = v.getUint8(p + 1) === 0, gnum = v.getUint16(p + 2, le), nf = v.getUint8(p + 4), fields = [], size = 0;
      p += 5;
      for (var f = 0; f < nf; f++, p += 3) { fields.push([v.getUint8(p), v.getUint8(p + 1), size]); size += v.getUint8(p + 1); }
      if (h & 0x20) { var nd = v.getUint8(p++); for (f = 0; f < nd; f++, p += 3) size += v.getUint8(p + 1); }
      defs[h & 0x0f] = { le: le, g: gnum, fields: fields, size: size };
      continue;
    } else local = h & 0x0f;
    d = defs[local];
    if (!d || p + d.size > buf.byteLength) break;
    var rec = {};
    for (var k = 0; k < d.fields.length; k++) {
      var fd = d.fields[k], at = p + fd[2];
      if (fd[1] === 4) rec[fd[0]] = fd[0] === 0 || fd[0] === 1 ? v.getInt32(at, d.le) : v.getUint32(at, d.le);
      else if (fd[1] === 1) rec[fd[0]] = v.getUint8(at);
    }
    p += d.size;
    if (rec[253] != null) lastTs = rec[253];
    if (d.g === 20) {
      var t = rec[253] != null ? rec[253] : ct, la = rec[0], lo = rec[1];
      if (t != null && la != null && lo != null && la !== 0x7fffffff && lo !== 0x7fffffff && (la || lo)) {
        pts.push([la * 180 / 2147483648, lo * 180 / 2147483648]); ts.push(FIT_EPOCH + t * 1000);
      }
    } else if (d.g === 18 || d.g === 12) {
      var sp = rec[d.g === 18 ? 5 : 0], sub = rec[d.g === 18 ? 6 : 1];
      if (sp != null && sp !== 255 && sport == null) sport = sp;
      if (sub === 58 || sub === 6) virtual = true;
    }
  }
  return { type: '', mode: virtual ? null : sport == null ? 'UNKNOWN' : FIT_SPORT[sport] || 'UNKNOWN', pts: pts, ts: ts };
}
function readActivity(name, buf) {
  var n = name.replace(/\.gz$/i, '');
  if (/\.fit$/i.test(n)) return readFit(buf);
  var txt = new TextDecoder().decode(buf);
  return /\.tcx$/i.test(n) ? readTcx(txt.trim()) : readGpx(txt);
}

// Douglas–Peucker on a local flat projection; tol is in metres.
function simplify(pts, tol) {
  var n = pts.length;
  if (n < 3) return pts.map(function (_, i) { return i; });
  var keep = new Uint8Array(n), stack = [[0, n - 1]], r = Math.PI / 180, kx = Math.cos(pts[0][0] * r) * 111320, ky = 110540, t2 = tol * tol;
  keep[0] = keep[n - 1] = 1;
  while (stack.length) {
    var s = stack.pop(), a = s[0], b = s[1], ax = pts[a][1] * kx, ay = pts[a][0] * ky, dx = pts[b][1] * kx - ax, dy = pts[b][0] * ky - ay, L = dx * dx + dy * dy, best = 0, bi = -1;
    for (var i = a + 1; i < b; i++) {
      var px = pts[i][1] * kx - ax, py = pts[i][0] * ky - ay, u = L ? Math.max(0, Math.min(1, (px * dx + py * dy) / L)) : 0;
      var ex = px - u * dx, ey = py - u * dy, e2 = ex * ex + ey * ey;
      if (e2 > best) { best = e2; bi = i; }
    }
    if (bi >= 0 && best > t2) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  var out = [];
  for (i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}
function addStrava(c, mode, a) {
  if (mode === null || a.pts.length < 2) return false;
  // Keep time order and drop repeated timestamps (paused recordings can repeat them).
  var pts = [], ts = [], i;
  for (i = 0; i < a.pts.length; i++) if (!ts.length || a.ts[i] > ts[ts.length - 1]) { pts.push(a.pts[i]); ts.push(a.ts[i]); }
  if (pts.length < 2) return false;
  // Distance on a lightly smoothed track, so GPS jitter while standing still doesn't add up.
  var dist = pathKm(simplify(pts, 2).map(function (i) { return pts[i]; })), keep = simplify(pts, 6);
  var inner = keep.slice(1, -1), n = pts.length - 1, before = c.start.length;
  c.add(mode || 'UNKNOWN', { ms: ts[0], off: null }, { ms: ts[n], off: null }, dist, 1, pts[0], pts[n],
    inner.map(function (i) { return pts[i]; }), inner.map(function (i) { return ts[i]; }));
  return c.start.length > before;
}
function finishStrava(c) {
  if (!c.start.length) throw new Error(NO_STRAVA);
  var r = finish(c, SRC.strava);
  for (var i = 0; i < r.est.length; i++) r.est[i] |= STRAVA;
  r.strava = true;
  return r;
}
function parseStravaFile(file) {
  return file.arrayBuffer().then(function (buf) { return maybeGunzip(file.name, buf); }).then(function (buf) {
    var c = new Collector(), a = readActivity(file.name, buf);
    addStrava(c, a.mode !== undefined ? a.mode : stravaMode(a.type), a);
    return finishStrava(c);
  });
}

// A small ZIP reader: reads the central directory at the end of the file, then only the
// entries it needs, so a multi-GB export with photos is never loaded whole.
function u64(v, at) { return v.getUint32(at, true) + v.getUint32(at + 4, true) * 4294967296; }
function zipEntries(file) {
  var tail = Math.min(file.size, 65557 + 20);
  return file.slice(file.size - tail).arrayBuffer().then(function (ab) {
    var v = new DataView(ab), e = -1, i;
    for (i = ab.byteLength - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This ZIP file looks damaged.');
    var count = v.getUint16(e + 10, true), cdSize = v.getUint32(e + 12, true), cdOff = v.getUint32(e + 16, true);
    if ((cdOff === 0xffffffff || count === 0xffff) && e >= 20 && v.getUint32(e - 20, true) === 0x07064b50) {
      var z = u64(v, e - 12);
      return file.slice(z, z + 56).arrayBuffer().then(function (b) {
        var w = new DataView(b);
        return readCd(file, u64(w, 48), u64(w, 40));
      });
    }
    return readCd(file, cdOff, cdSize);
  });
}
function readCd(file, off, size) {
  return file.slice(off, off + size).arrayBuffer().then(function (ab) {
    var v = new DataView(ab), p = 0, out = [], dec = new TextDecoder();
    while (p + 46 <= ab.byteLength && v.getUint32(p, true) === 0x02014b50) {
      var method = v.getUint16(p + 10, true), comp = v.getUint32(p + 20, true), raw = v.getUint32(p + 24, true);
      var nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lho = v.getUint32(p + 42, true);
      var name = dec.decode(new Uint8Array(ab, p + 46, nl)), x = p + 46 + nl, xe = x + xl;
      while (x + 4 <= xe) {
        var id = v.getUint16(x, true), len = v.getUint16(x + 2, true), q = x + 4;
        if (id === 1) {
          if (raw === 0xffffffff) { raw = u64(v, q); q += 8; }
          if (comp === 0xffffffff) { comp = u64(v, q); q += 8; }
          if (lho === 0xffffffff) lho = u64(v, q);
        }
        x += 4 + len;
      }
      out.push({ name: name, method: method, comp: comp, off: lho });
      p = xe + cl;
    }
    return out;
  });
}
function zipRead(file, en) {
  return file.slice(en.off, en.off + 30).arrayBuffer().then(function (ab) {
    var v = new DataView(ab), start = en.off + 30 + v.getUint16(26, true) + v.getUint16(28, true);
    var blob = file.slice(start, start + en.comp);
    if (en.method === 0) return blob.arrayBuffer();
    if (en.method !== 8) throw new Error('Unsupported compression in ' + en.name);
    return new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  });
}
// activities.csv → {"activities/123.fit.gz": "Ride", …}
function csvRows(txt) {
  var rows = [], row = [], cell = '', q = false;
  for (var i = 0; i < txt.length; i++) {
    var ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function stravaTypes(txt) {
  var rows = csvRows(txt.replace(/^\uFEFF/, '')), head = rows[0] || [], ti = -1, fi = -1, out = {}, i;
  for (i = 0; i < head.length; i++) {
    if (ti < 0 && /activity type/i.test(head[i])) ti = i;
    if (fi < 0 && /filename/i.test(head[i])) fi = i;
  }
  // Headers in another language: find the file column by its values; the type is the fourth column.
  if (fi < 0 && rows[1]) for (i = 0; i < rows[1].length; i++) if (/^activities\//.test(rows[1][i])) fi = i;
  if (ti < 0) ti = 3;
  if (fi < 0) return out;
  for (i = 1; i < rows.length; i++) if (rows[i][fi]) out[rows[i][fi].trim()] = rows[i][ti];
  return out;
}
function parseStravaZip(file, onProgress) {
  return zipEntries(file).then(function (all) {
    var acts = all.filter(function (e) { return /(^|\/)activities\/[^/]+\.(gpx|tcx|fit)(\.gz)?$/i.test(e.name); });
    if (!acts.length) throw new Error(NO_STRAVA);
    var csv = all.filter(function (e) { return /(^|\/)activities\.csv$/i.test(e.name); })[0];
    var c = new Collector(), types = {}, skipped = 0;
    return (csv ? zipRead(file, csv).then(function (b) { types = stravaTypes(new TextDecoder().decode(b)); }) : Promise.resolve()).then(function step(_, i) {
      i = i || 0;
      if (i >= acts.length) { var r = finishStrava(c); r.skippedActs = skipped; return r; }
      var en = acts[i], key = en.name.replace(/^.*?(activities\/)/, '$1');
      return zipRead(file, en).then(function (b) { return maybeGunzip(en.name, b); }).then(function (b) {
        var a = readActivity(en.name, b), t = types[key];
        var mode = t != null && t !== '' ? stravaMode(t) : a.mode !== undefined ? a.mode : stravaMode(a.type);
        if (!addStrava(c, mode, a)) skipped++;
      }).catch(function () { skipped++; }).then(function () {
        if (i % 20 === 0) onProgress((i + 1) / acts.length);
        return step(null, i + 1);
      });
    });
  });
}

function parseFile(file, onProgress) {
  if (/\.zip$/i.test(file.name)) return parseStravaZip(file, onProgress);
  if (isStravaName(file.name)) return parseStravaFile(file);
  return file.slice(0, 4096).text().then(function (head) {
    var kind = sniff(head);
    if (!kind) throw new Error(NOT_TIMELINE);
    if (kind === 'records') return parseRecordsStream(file, onProgress);
    return file.text().then(function (txt) { onProgress(1); return parseTimeline(JSON.parse(txt)); });
  });
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = function (e) {
    var files = e.data.files;
    (function next(i) {
      if (i >= files.length) { self.postMessage({ type: 'done' }); return; }
      var f = files[i], label = files.length > 1 ? ' (' + (i + 1) + ' of ' + files.length + ')' : '';
      self.postMessage({ type: 'progress', text: 'Reading ' + f.name + label + '…' });
      parseFile(f, function (p) {
        self.postMessage({ type: 'progress', text: 'Reading ' + f.name + label + ' · ' + Math.round(p * 100) + '%' });
      }).then(function (r) {
        r.name = f.name;
        self.postMessage({ type: 'file', result: r });
        next(i + 1);
      }).catch(function (err) {
        self.postMessage({ type: 'error', name: f.name, text: err && err.message || String(err), skipped: err && err.message === NOT_TIMELINE });
        next(i + 1);
      });
    })(0);
  };
}
if (typeof module !== 'undefined') module.exports = { parseTimeline: parseTimeline, MODES: MODES, normMode: normMode, km: km, SRC: SRC, NO_OFF: NO_OFF, parseFile: parseFile, STRAVA: STRAVA };
