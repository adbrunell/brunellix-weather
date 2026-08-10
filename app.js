/* BrunelliX Weather — app.js  v2  */
(function () {
  'use strict';

  var GITHUB_RAW = 'https://raw.githubusercontent.com/adbrunell/brunellix-weather/main/data';
  var IEM_ASOS   = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';
  var IEM_GEOJSON = 'https://mesonet.agron.iastate.edu/geojson/network';
  var CACHE_DB = 'iem_cache_v2';
  var CACHE_STORE = 'obs';

  /* state */
  var _airports = null, _iata2icao = null, _pending = false;
  var _grid = null, _rows = [];

  /* DOM */
  function $(id) { return document.getElementById(id); }

  /* year range */
  function yearRange() {
    var y2 = new Date().getFullYear() - 1;
    return { y1: y2 - 4, y2: y2 };
  }

  /* parse time H:MM → minutes */
  function parseTime(s) {
    s = String(s).trim();
    var m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }
  function fmtTime(minutes) {
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return h + ':' + (m < 10 ? '0' : '') + m;
  }

  /* hemispheres */
  function seasonMonths(lat) {
    if (lat < 0) return {
      sum: [12, 1, 2], aut: [3, 4, 5], win: [6, 7, 8], spr: [9, 10, 11]
    };
    return {
      sum: [6, 7, 8], aut: [9, 10, 11], win: [12, 1, 2], spr: [3, 4, 5]
    };
  }

  /* distance haversine (km) */
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function kmToNM(km) { return km * 0.539957; }

  /* IndexedDB */
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(CACHE_DB, 1);
      req.onupgradeneeded = function (e) {
        if (!e.target.result.objectStoreNames.contains(CACHE_STORE)) {
          e.target.result.createObjectStore(CACHE_STORE, { keyPath: 'k' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function cachedGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(CACHE_STORE, 'readonly');
        var r = tx.objectStore(CACHE_STORE).get(key);
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
        var tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.objectStore(CACHE_STORE).put({ k: key, csv: csv, ts: Date.now() });
        tx.oncomplete = function () { resolve(); };
      });
    }).catch(function () {});
  }

  /* airports loading */
  function loadAirports() {
    if (_airports) return Promise.resolve();
    var key = 'ap_v2';
    return cachedGet(key).then(function (cached) {
      if (cached) {
        try { var d = JSON.parse(cached); _airports = d.airports; _iata2icao = d.iata; } catch (e) {}
      }
      if (_airports) return;
      return Promise.all([
        fetch(GITHUB_RAW + '/airports.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
        fetch(GITHUB_RAW + '/iata2icao.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
      ]).then(function (r) {
        _airports = r[0]; _iata2icao = r[1];
        cachedSet(key, JSON.stringify({ airports: _airports, iata: _iata2icao }));
      });
    }).catch(function () {});
  }

  function resolveAirport(code) {
    code = code.trim().toUpperCase();
    if (!code) return Promise.resolve(null);
    return loadAirports().then(function () {
      if (_airports && _airports[code]) return { icao: code, data: _airports[code] };
      if (_iata2icao && _iata2icao[code]) {
        var icao = _iata2icao[code];
        if (_airports && _airports[icao]) return { icao: icao, data: _airports[icao] };
        code = icao;
      }
      return resolveIEM(code);
    });
  }

  function resolveIEM(icao) {
    var map = { SB:'BR__ASOS',SA:'AR__ASOS',SC:'CL__ASOS',SP:'PE__ASOS',SE:'EC__ASOS',SV:'VE__ASOS',K:'US_ASOS',PA:'US_ASOS',PH:'US_ASOS',EG:'GB__ASOS',LF:'FR__ASOS',LE:'ES__ASOS',ED:'DE__ASOS',LI:'IT__ASOS',LP:'PT__ASOS',EH:'NL__ASOS',LO:'AT__ASOS',LS:'CH__ASOS',RJ:'JP__ASOS',RK:'KR__ASOS',VT:'TH__ASOS',WM:'MY__ASOS',WI:'ID__ASOS',WS:'SG__ASOS',VH:'HK__ASOS',Y:'AU__ASOS',C:'CA__ASOS',M:'MX__ASOS' };
    var net = map[icao.substring(0,2)] || map[icao.substring(0,1)] || 'BR__ASOS';
    return fetch(IEM_GEOJSON + '/' + net + '.geojson')
      .then(function (r) { return r.ok ? r.json() : { features: [] }; })
      .then(function (geo) {
        var feat = geo.features.find(function (f) { return f.properties.sid === icao; });
        if (!feat) return null;
        return { icao: icao, data: {
          name: feat.properties.sname || icao, iata: '', lat: feat.geometry.coordinates[1],
          lon: feat.geometry.coordinates[0], elev_m: feat.properties.elevation || 0,
          network: net, archive_begin: feat.properties.archive_begin || '', type: '', municipality: '', iso_country: ''
        }};
      }).catch(function () { return null; });
  }

  /* data fetch */
  function fetchData(icao, network) {
    var yr = yearRange();
    var key = icao + '_' + yr.y1 + '_' + yr.y2;
    return cachedGet(key).then(function (cached) {
      if (cached) { statMsg('(cached)'); return cached; }
      var net = network || 'BR__ASOS';
      return fetch(IEM_ASOS + '?station=' + encodeURIComponent(icao) +
        '&network=' + encodeURIComponent(net) +
        '&data=tmpf,alti,mslp,drct,sknt,gust' +
        '&year1=' + yr.y1 + '&month1=1&day1=1' +
        '&year2=' + yr.y2 + '&month2=12&day2=31' +
        '&report_type=3&tz=Etc/UTC&format=onlycomma')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (csv) { cachedSet(key, csv); return csv; });
    });
  }

  /* parse CSV → array of { month, minuteOfDay, tmpc, qnh } */
  function parseCSV(csv) {
    var lines = csv.trim().split('\n');
    if (lines.length < 2) return [];
    var hdr = lines[0].split(',').map(function (h) { return h.trim(); });
    return lines.slice(1).map(function (line) {
      var v = line.split(',');
      var t = (v[hdr.indexOf('valid')] || '').trim();
      if (!t) return null;
      var m = t.match(/\d{4}-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
      if (!m) return null;
      var month = parseInt(m[1], 10), minute = parseInt(m[4], 10) * 60 + parseInt(m[5], 10);
      var tf = parseFloat(v[hdr.indexOf('tmpf')]);
      var al = parseFloat(v[hdr.indexOf('alti')]);
      if (isNaN(tf) || isNaN(al)) return null;
      return { month: month, min: minute, tmpc: (tf - 32) * 5 / 9, qnh: al * 33.8639 };
    }).filter(function (r) { return r !== null; });
  }

  /* filter by time range and months */
  function filterObs(rows, minStart, minEnd, months) {
    var mSet = {};
    months.forEach(function (m) { mSet[m] = true; });
    return rows.filter(function (r) {
      if (!mSet[r.month]) return false;
      if (minStart <= minEnd) return r.min >= minStart && r.min <= minEnd;
      return r.min >= minStart || r.min <= minEnd;
    });
  }

  /* statistics */
  function stats(rows, reliability) {
    if (!rows.length) return { temp: null, press: null, n: 0 };
    var n = rows.length;
    var tSum = 0, pSum = 0;
    rows.forEach(function (r) { tSum += r.tmpc; pSum += r.qnh; });
    return { temp: tSum / n, press: pSum / n, n: n };
  }

  /* display */
  function statMsg(msg) {
    var el = $('status-msg');
    el.textContent = msg;
    el.className = 'status-msg visible' + (msg.indexOf('fail') >= 0 || msg.indexOf('Error') >= 0 || msg.indexOf('not found') >= 0 ? ' error' : '');
    if (msg.indexOf('fail') < 0 && msg.indexOf('Error') < 0 && msg.indexOf('not found') < 0 && msg.indexOf('Downloading') < 0) {
      setTimeout(function () { el.className = 'status-msg'; }, 3000);
    }
  }

  function search() {
    if (_pending) return;
    var code = $('inp-code').value.trim().toUpperCase();
    var rel = parseInt($('inp-rel').value, 10) || 85;
    var tStart = parseTime($('inp-start').value);
    var tEnd = parseTime($('inp-end').value);

    if (!code) { statMsg('Enter an ICAO or IATA code'); return; }
    if (tStart === null || tEnd === null) { statMsg('Invalid time format. Use H:MM (e.g. 0:00, 14:30)'); return; }
    rel = Math.max(50, Math.min(99, rel));
    $('inp-rel').value = rel;

    _pending = true;
    $('btn-search').disabled = true;
    statMsg('Resolving ' + code + '...');

    resolveAirport(code).then(function (ap) {
      if (!ap) { statMsg('Airport "' + code + '" not found'); _pending = false; $('btn-search').disabled = false; return; }
      var st = ap.data;
      statMsg('Downloading ' + ap.icao + ' (' + yearRange().y1 + '-' + yearRange().y2 + ')...');

      return fetchData(ap.icao, st.network).then(function (csv) {
        if (!csv) { statMsg('No data for ' + ap.icao); _pending = false; $('btn-search').disabled = false; return; }

        var allRows = parseCSV(csv);
        if (!allRows.length) { statMsg('No valid observations for ' + ap.icao); _pending = false; $('btn-search').disabled = false; return; }

        var seas = seasonMonths(st.lat || 0);
        var ann = filterObs(allRows, tStart, tEnd, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        var sumObs = filterObs(allRows, tStart, tEnd, seas.sum);
        var autObs = filterObs(allRows, tStart, tEnd, seas.aut);
        var winObs = filterObs(allRows, tStart, tEnd, seas.win);
        var sprObs = filterObs(allRows, tStart, tEnd, seas.spr);

        var annS = stats(ann, rel);
        var sumS = stats(sumObs, rel);
        var autS = stats(autObs, rel);
        var winS = stats(winObs, rel);
        var sprS = stats(sprObs, rel);

        /* distance */
        var distNM = 0;
        if (ap.icao !== code) {
          var srcAp = _airports ? _airports[code] : null;
          if (srcAp) distNM = kmToNM(haversineKm(srcAp.lat, srcAp.lon, st.lat, st.lon));
        }

        var fmt = function (v) { return v === null || isNaN(v) ? '\u2014' : v.toFixed(1); };

        var row = {
          input: code,
          reliability: rel + '%',
          initial: fmtTime(tStart),
          final: fmtTime(tEnd),
          ann_temp: fmt(annS.temp), ann_press: fmt(annS.press),
          sum_temp: fmt(sumS.temp), sum_press: fmt(sumS.press),
          aut_temp: fmt(autS.temp), aut_press: fmt(autS.press),
          win_temp: fmt(winS.temp), win_press: fmt(winS.press),
          spr_temp: fmt(sprS.temp), spr_press: fmt(sprS.press),
          station_id: ap.icao,
          dist_nm: distNM.toFixed(0) + ' NM',
          _n: annS.n
        };

        _rows.push(row);
        _grid.setData(_rows);
        statMsg('OK \u2014 ' + ap.icao + ' (' + annS.n + ' obs, ' + yearRange().y1 + '-' + yearRange().y2 + ')');
        $('inp-code').value = '';
        $('inp-code').focus();
        _pending = false;
        $('btn-search').disabled = false;
      });
    }).catch(function (err) {
      statMsg('Error: ' + (err.message || 'fetch failed'));
      _pending = false;
      $('btn-search').disabled = false;
    });
  }

  /* init grid once */
  function initGrid() {
    _grid = window.GRID.mount($('results-grid'), {
      data: [],
      columns: [
        { key: 'input',        label: 'INPUT',       width: 62 },
        { key: 'reliability',  label: 'RELIAB.',     width: 58 },
        { key: 'initial',      label: 'INITIAL',     width: 58 },
        { key: 'final',        label: 'FINAL',       width: 58 },
        { key: 'ann_temp',     label: 'ANN T',       width: 62 },
        { key: 'ann_press',    label: 'ANN P',       width: 65 },
        { key: 'sum_temp',     label: 'SUM T',       width: 62 },
        { key: 'sum_press',    label: 'SUM P',       width: 65 },
        { key: 'aut_temp',     label: 'AUT T',       width: 62 },
        { key: 'aut_press',    label: 'AUT P',       width: 65 },
        { key: 'win_temp',     label: 'WIN T',       width: 62 },
        { key: 'win_press',    label: 'WIN P',       width: 65 },
        { key: 'spr_temp',     label: 'SPR T',       width: 62 },
        { key: 'spr_press',    label: 'SPR P',       width: 65 },
        { key: 'station_id',   label: 'ID',          width: 58 },
        { key: 'dist_nm',      label: 'DIST NM',     width: 62 }
      ],
      height: 500,
      readonly: true,
      statusBar: false
    });
  }

  /* events */
  $('btn-search').addEventListener('click', search);
  $('inp-code').addEventListener('input', function () { this.value = this.value.toUpperCase(); });
  $('inp-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  $('inp-rel').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  $('inp-start').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  $('inp-end').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });

  initGrid();
  loadAirports();

})();
