/* BrunelliX Weather — app.js  (simples e robusto) */
(function () {
  'use strict';

  var GITHUB_RAW = 'https://raw.githubusercontent.com/adbrunell/brunellix-weather/master/data';
  var IEM_ASOS = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';
  var IEM_GEOJSON = 'https://mesonet.agron.iastate.edu/geojson/network';
  var NROWS = 25;

  var airports = null, iata2icao = null;
  var busy = {};

  var $ = function (id) { return document.getElementById(id); };

  function yearRange() {
    var y2 = new Date().getFullYear() - 1;
    return { y1: y2 - 4, y2: y2 };
  }

  /* ── status ── */
  function stat(msg, isErr) {
    var el = $('status');
    el.textContent = msg;
    el.className = 'status' + (isErr ? ' err' : '');
  }

  /* ── IndexedDB cache ── */
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('iem_cache_v4', 1);
      req.onupgradeneeded = function (e) {
        if (!e.target.result.objectStoreNames.contains('obs')) {
          e.target.result.createObjectStore('obs', { keyPath: 'k' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function cachedGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('obs', 'readonly');
        var r = tx.objectStore('obs').get(key);
        r.onsuccess = function () {
          var v = r.result;
          resolve(v && (Date.now() - v.ts < 7 * 864e5) ? v.csv : null);
        };
        r.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }
  function cachedSet(key, csv) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('obs', 'readwrite');
        tx.objectStore('obs').put({ k: key, csv: csv, ts: Date.now() });
        tx.oncomplete = function () { resolve(); };
      });
    }).catch(function () {});
  }

  /* ── airports lookup ── */
  function loadAirports() {
    if (airports) return Promise.resolve();
    return cachedGet('ap_v4').then(function (c) {
      if (c) { try { var d = JSON.parse(c); airports = d.a; iata2icao = d.i; } catch (e) {} }
      if (airports) return;
      return Promise.all([
        fetch(GITHUB_RAW + '/airports.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
        fetch(GITHUB_RAW + '/iata2icao.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
      ]).then(function (r) {
        airports = r[0]; iata2icao = r[1];
        cachedSet('ap_v4', JSON.stringify({ a: airports, i: iata2icao }));
      });
    }).catch(function () {});
  }

  function resolveAirport(code) {
    code = String(code).trim().toUpperCase();
    if (!code) return Promise.resolve(null);
    return loadAirports().then(function () {
      if (airports && airports[code]) return { icao: code, data: airports[code] };
      if (iata2icao && iata2icao[code]) {
        var icao = iata2icao[code];
        if (airports && airports[icao]) return { icao: icao, data: airports[icao] };
        code = icao;
      }
      return resolveIEM(code);
    });
  }

  function resolveIEM(icao) {
    var m = { SB: 'BR__ASOS', SA: 'AR__ASOS', SC: 'CL__ASOS', SP: 'PE__ASOS', SE: 'EC__ASOS', SV: 'VE__ASOS', K: 'US_ASOS', PA: 'US_ASOS', PH: 'US_ASOS', EG: 'GB__ASOS', LF: 'FR__ASOS', LE: 'ES__ASOS', ED: 'DE__ASOS', LI: 'IT__ASOS', LP: 'PT__ASOS', EH: 'NL__ASOS', LO: 'AT__ASOS', LS: 'CH__ASOS', RJ: 'JP__ASOS', RK: 'KR__ASOS', VT: 'TH__ASOS', WM: 'MY__ASOS', WI: 'ID__ASOS', WS: 'SG__ASOS', VH: 'HK__ASOS', Y: 'AU__ASOS', C: 'CA__ASOS', M: 'MX__ASOS' };
    var net = m[icao.substring(0, 2)] || m[icao.substring(0, 1)] || 'BR__ASOS';
    return fetch(IEM_GEOJSON + '/' + net + '.geojson')
      .then(function (r) { return r.ok ? r.json() : { features: [] }; })
      .then(function (geo) {
        var f = geo.features.find(function (x) { return x.properties.sid === icao; });
        if (!f) return null;
        return { icao: icao, data: { name: f.properties.sname || icao, iata: '', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], elev_m: f.properties.elevation || 0, network: net } };
      }).catch(function () { return null; });
  }

  /* ── data fetch ── */
  function fetchData(icao, network) {
    var yr = yearRange();
    var key = icao + '_' + yr.y1;
    return cachedGet(key).then(function (c) {
      if (c) return c;
      var net = network || 'BR__ASOS';
      return fetch(IEM_ASOS + '?station=' + encodeURIComponent(icao) +
        '&network=' + encodeURIComponent(net) +
        '&data=tmpf,alti&year1=' + yr.y1 + '&month1=1&day1=1' +
        '&year2=' + yr.y2 + '&month2=12&day2=31' +
        '&report_type=3&tz=Etc/UTC&format=onlycomma')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (csv) { cachedSet(key, csv); return csv; });
    });
  }

  /* ── parse ── */
  function parseCSV(csv) {
    var lines = csv.trim().split('\n');
    if (lines.length < 2) return [];
    var hdr = lines[0].split(',').map(function (h) { return h.trim(); });
    var ti = hdr.indexOf('tmpf'), ai = hdr.indexOf('alti');
    return lines.slice(1).map(function (line) {
      var v = line.split(',');
      var m = (v[1] || '').trim().match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
      if (!m) return null;
      var tf = parseFloat(v[ti]), al = parseFloat(v[ai]);
      if (isNaN(tf) || isNaN(al)) return null;
      return { month: parseInt(m[2], 10), min: parseInt(m[4], 10) * 60 + parseInt(m[5], 10), tmpc: (tf - 32) * 5 / 9, qnh: al * 33.8639 };
    }).filter(function (r) { return r !== null; });
  }

  function seasonMonths(lat) {
    if (lat < 0) return { sum: [12, 1, 2], aut: [3, 4, 5], win: [6, 7, 8], spr: [9, 10, 11] };
    return { sum: [6, 7, 8], aut: [9, 10, 11], win: [12, 1, 2], spr: [3, 4, 5] };
  }

  function filterObs(rows, tStart, tEnd, months) {
    var m = {}; months.forEach(function (x) { m[x] = true; });
    return rows.filter(function (r) {
      if (!m[r.month]) return false;
      if (tStart <= tEnd) return r.min >= tStart && r.min <= tEnd;
      return r.min >= tStart || r.min <= tEnd;
    });
  }

  function avg(arr) { return arr.length ? arr.reduce(function (s, v) { return s + v; }, 0) / arr.length : NaN; }
  function fmt(v) { return isNaN(v) ? '\u2014' : v.toFixed(1); }

  function parseTime(s) {
    s = String(s).trim();
    var m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    var h = parseInt(m[1], 10), mn = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
    return h * 60 + mn;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── build table rows ── */
  var tbody = $('tbody');
  var rows = [];

  for (var i = 0; i < NROWS; i++) {
    var tr = document.createElement('tr');
    tr.dataset.row = i;

    function mkInp(cls, def, r) {
      var td = document.createElement('td');
      td.className = 'inp ' + cls;
      var inp = document.createElement('input');
      inp.value = def;
      inp.setAttribute('maxlength', cls === 'c1' ? 3 : 10);
      inp.addEventListener('input', function () { schedule(r); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); processRow(r); } });
      td.appendChild(inp);
      return { td: td, inp: inp };
    }
    function mkRes(cls, r) {
      var td = document.createElement('td');
      td.className = 'res ' + cls;
      td.dataset.res = r;
      return td;
    }

    var c0 = mkInp('c0', '', i);          // airport code
    var c1 = mkInp('c1', '85', i);        // reliability
    var c2 = mkInp('c2', '0:00', i);      // initial
    var c3 = mkInp('c3', '23:59', i);     // final

    tr.appendChild(c0.td); tr.appendChild(c1.td); tr.appendChild(c2.td); tr.appendChild(c3.td);

    var res = [];
    for (var c = 0; c < 12; c++) {
      var rtd = mkRes('c' + (c + 4), i);
      res.push(rtd);
      tr.appendChild(rtd);
    }

    tbody.appendChild(tr);
    rows.push({ c0: c0.inp, c1: c1.inp, c2: c2.inp, c3: c3.inp, res: res });
  }

  /* ── row processing ── */
  var timers = {};
  function schedule(r) {
    clearTimeout(timers[r]);
    timers[r] = setTimeout(function () { processRow(r); }, 600);
  }

  function processRow(r) {
    if (busy[r]) return;
    var row = rows[r];
    var code = row.c0.value.trim().toUpperCase();
    if (!code) return;
    var rel = parseInt(row.c1.value, 10) || 85;
    if (rel < 50 || rel > 99) { stat('Row ' + (r + 1) + ': reliability must be 50-99', true); return; }
    var tStart = parseTime(row.c2.value);
    var tEnd = parseTime(row.c3.value);
    if (tStart === null || tEnd === null) { stat('Row ' + (r + 1) + ': invalid time (use H:MM)', true); return; }

    busy[r] = true;
    row.c0.style.background = '#fff8e1';
    stat('Row ' + (r + 1) + ': resolving ' + code + '...');

    resolveAirport(code).then(function (ap) {
      if (!ap) {
        setRes(r, 'N/F', 10); setRes(r, '—', 11);
        finish(r, code + ' not found', true); return;
      }
      var st = ap.data;
      stat('Row ' + (r + 1) + ': downloading ' + ap.icao + ' (' + yearRange().y1 + '-' + yearRange().y2 + ')...');
      return fetchData(ap.icao, st.network || 'BR__ASOS').then(function (csv) {
        if (!csv) { setRes(r, ap.icao, 10); setRes(r, 'N/D', 11); finish(r, ap.icao + ' no data', true); return; }
        var obs = parseCSV(csv);
        if (!obs.length) { setRes(r, ap.icao, 10); setRes(r, 'N/O', 11); finish(r, ap.icao + ' no obs', true); return; }

        var lat = st.lat || 0;
        var seas = seasonMonths(lat);
        var all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        var ann = filterObs(obs, tStart, tEnd, all);
        var sum = filterObs(obs, tStart, tEnd, seas.sum);
        var aut = filterObs(obs, tStart, tEnd, seas.aut);
        var win = filterObs(obs, tStart, tEnd, seas.win);
        var spr = filterObs(obs, tStart, tEnd, seas.spr);

        var groups = [ann, sum, aut, win, spr];
        for (var g = 0; g < 5; g++) {
          setRes(r, fmt(avg(groups[g].map(function (o) { return o.tmpc; }))), g * 2);
          setRes(r, fmt(avg(groups[g].map(function (o) { return o.qnh; }))), g * 2 + 1);
        }

        setRes(r, ap.icao, 10);
        var distNM = 0;
        var enteredIcao = (iata2icao && iata2icao[code]) ? iata2icao[code] : code;
        if (ap.icao !== enteredIcao) {
          var srcAp = (airports && airports[enteredIcao]) ? airports[enteredIcao] : null;
          if (srcAp) distNM = haversineKm(srcAp.lat, srcAp.lon, lat, st.lon || 0) * 0.539957;
        }
        setRes(r, distNM.toFixed(0) + ' NM', 11);

        finish(r, ap.icao + ' done (' + ann.length + ' obs, ' + yearRange().y1 + '-' + yearRange().y2 + ')', false);
      });
    }).catch(function (err) {
      finish(r, 'Error: ' + (err.message || 'fetch failed'), true);
    });
  }

  function setRes(r, val, col) {
    rows[r].res[col].textContent = val;
    rows[r].res[col].className = 'res c' + (col + 4) + (val === 'N/F' || val === 'N/D' || val === 'N/O' || String(val).indexOf('Error') >= 0 ? ' res-err' : '');
  }

  function finish(r, msg, isErr) {
    busy[r] = false;
    rows[r].c0.style.background = '';
    stat(msg, isErr);
  }

  loadAirports();
})();
