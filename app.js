/* ═══════════════════════════════════════════════════════════════
   BrunelliX Weather — app.js
   Airport climatology analysis engine
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ═══ CONFIG ═══ */
  var GITHUB_RAW = 'https://raw.githubusercontent.com/adbrunell/brunellix-weather/main/data';
  var IEM_ASOS = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';
  var IEM_GEOJSON = 'https://mesonet.agron.iastate.edu/geojson/network';
  var CACHE_DB = 'iem_cache';
  var CACHE_STORE = 'observations';
  var CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  var CACHE_AIRPORTS_TTL = 3 * 24 * 60 * 60 * 1000;
  var DEBOUNCE_MS = 300;

  /* ═══ DOM refs ═══ */
  function $(id) { return document.getElementById(id); }

  /* ═══ State ═══ */
  var _airports = null;
  var _iata2icao = null;
  var _currentStation = null;
  var _rawRows = null;
  var _lastQueryIcao = '';
  var _debounce = 0;
  var _downloading = false;

  /* ═══ Year range (auto) ═══ */
  function getYearRange() {
    var now = new Date();
    var y2 = now.getFullYear() - 1;
    var y1 = y2 - 5;
    return { y1: y1, y2: y2 };
  }
  function formatYearRange() {
    var y = getYearRange();
    return y.y1 + '\u2013' + y.y2;
  }
  $('year-info').innerHTML = 'Analyzing <strong>' + formatYearRange() + '</strong> (last 5 complete years, auto)';

  /* ═══ IndexedDB ═══ */
  function openCache() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(CACHE_DB, 1);
      req.onupgradeneeded = function (e) {
        if (!e.target.result.objectStoreNames.contains(CACHE_STORE)) {
          e.target.result.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function getCached(key) {
    return openCache().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(CACHE_STORE, 'readonly');
        var req = tx.objectStore(CACHE_STORE).get(key);
        req.onsuccess = function () {
          var r = req.result;
          if (r && (Date.now() - r.ts) < CACHE_TTL) resolve(r.csv);
          else resolve(null);
        };
        req.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }
  function setCached(key, csv) {
    return openCache().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.objectStore(CACHE_STORE).put({ key: key, csv: csv, ts: Date.now() });
        tx.oncomplete = function () { resolve(); };
      });
    }).catch(function () {});
  }

  /* ═══ Airport Resolver (ourairports + IEM fallback) ═══ */
  function loadAirports() {
    if (_airports) {
      if (Date.now() - _airports._ts < CACHE_AIRPORTS_TTL) return Promise.resolve();
      _airports = null;
    }
    var key = 'airports_json_v1';
    return getCached(key).then(function (cached) {
      if (cached) {
        try { var d = JSON.parse(cached); _airports = d.airports; _iata2icao = d.iata; } catch (e) {}
      }
      if (_airports) return;
      return Promise.all([
        fetch(GITHUB_RAW + '/airports.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
        fetch(GITHUB_RAW + '/iata2icao.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
      ]).then(function (results) {
        _airports = results[0]; _iata2icao = results[1];
        _airports._ts = Date.now();
        setCached(key, JSON.stringify({ airports: _airports, iata: _iata2icao }));
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

      return resolveFromIEM(code);
    });
  }

  function resolveFromIEM(icao) {
    var network = guessNetwork(icao);
    return fetch(IEM_GEOJSON + '/' + network + '.geojson')
      .then(function (r) { return r.ok ? r.json() : { features: [] }; })
      .then(function (geo) {
        var feat = geo.features.find(function (f) { return f.properties.sid === icao; });
        if (feat) {
          return {
            icao: icao,
            data: {
              name: feat.properties.sname || icao,
              iata: '', lat: feat.geometry.coordinates[1],
              lon: feat.geometry.coordinates[0],
              elev_m: feat.properties.elevation || 0,
              network: network, archive_begin: feat.properties.archive_begin || '',
              type: '', municipality: '', iso_country: ''
            }
          };
        }
        return null;
      }).catch(function () { return null; });
  }

  function guessNetwork(icao) {
    var p2 = icao.substring(0, 2), p1 = icao.substring(0, 1);
    var map = {
      SB: 'BR__ASOS', SA: 'AR__ASOS', SC: 'CL__ASOS', SP: 'PE__ASOS', SE: 'EC__ASOS', SV: 'VE__ASOS',
      K: 'US_ASOS', PA: 'US_ASOS', PH: 'US_ASOS', EG: 'GB__ASOS', LF: 'FR__ASOS',
      LE: 'ES__ASOS', ED: 'DE__ASOS', LI: 'IT__ASOS', LP: 'PT__ASOS',
      EH: 'NL__ASOS', LO: 'AT__ASOS', LS: 'CH__ASOS', RJ: 'JP__ASOS', RK: 'KR__ASOS',
      VT: 'TH__ASOS', WM: 'MY__ASOS', WI: 'ID__ASOS', WS: 'SG__ASOS',
      VH: 'HK__ASOS', Y: 'AU__ASOS', C: 'CA__ASOS', M: 'MX__ASOS'
    };
    return map[p2] || map[p1] || 'BR__ASOS';
  }

  /* ═══ Data Fetcher ═══ */
  function fetchStationData(station) {
    var y = getYearRange();
    var icao = station.icao;
    var cacheKey = icao + '_' + y.y1 + '_' + y.y2;

    return getCached(cacheKey).then(function (cached) {
      if (cached) { showStationSource('cache'); return cached; }

      return fetchFromGitHub(icao, y.y1, y.y2).then(function (csv) {
        if (csv) { showStationSource('github'); return csv; }
        return fetchFromIEM(station, y.y1, y.y2).then(function (csv) {
          showStationSource('iem'); return csv;
        });
      }).then(function (csv) {
        if (csv) setCached(cacheKey, csv);
        return csv;
      });
    });
  }

  function fetchFromGitHub(icao, y1, y2) {
    var promises = [];
    for (var y = y1; y <= y2; y++) {
      promises.push(
        fetch(GITHUB_RAW + '/' + icao + '/' + y + '.csv')
          .then(function (r) { return r.ok ? r.text() : ''; })
          .catch(function () { return ''; })
      );
    }
    return Promise.all(promises).then(function (chunks) {
      var valid = chunks.filter(function (c) { return c && c.trim(); });
      if (!valid.length) return null;
      var header = valid[0].split('\n')[0];
      var bodies = valid.map(function (c) {
        var lines = c.split('\n');
        return lines.slice(lines[0] === header ? 1 : 0).join('\n');
      });
      return header + '\n' + bodies.join('\n');
    });
  }

  function fetchFromIEM(station, y1, y2) {
    var sd = station && station.data;
    if (!sd) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var cols = 'tmpf,dwpf,alti,mslp,drct,sknt,gust';
      var network = sd.network || 'BR__ASOS';
      var url = IEM_ASOS + '?station=' + encodeURIComponent(station.icao) +
        '&network=' + encodeURIComponent(network) +
        '&data=' + cols +
        '&year1=' + y1 + '&month1=1&day1=1' +
        '&year2=' + y2 + '&month2=12&day2=31' +
        '&report_type=3&tz=Etc/UTC&format=onlycomma';
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error('IEM returned ' + r.status);
        return r.text();
      }).then(resolve).catch(function () { resolve(null); });
    });
  }

  /* ═══ CSV Parser ═══ */
  function parseCSV(csv) {
    var lines = csv.trim().split('\n');
    if (lines.length < 2) return [];
    var headers = lines[0].split(',').map(function (h) { return h.trim(); });
    return lines.slice(1).map(function (line) {
      var vals = line.split(',');
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = (vals[i] || '').trim(); });
      return obj;
    }).filter(function (r) { return r.valid && r.station; });
  }

  /* ═══ Time Filter ═══ */
  function filterByTime(rows, startHHMM, endHHMM) {
    var s = startHHMM.split(':'), e = endHHMM.split(':');
    var sH = parseInt(s[0], 10), sM = parseInt(s[1], 10);
    var eH = parseInt(e[0], 10), eM = parseInt(e[1], 10);
    var sMin = sH * 60 + sM, eMin = eH * 60 + eM;

    return rows.filter(function (r) {
      var m = r.valid.match(/(\d{2}):(\d{2})/);
      if (!m) return false;
      var min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      if (sMin <= eMin) return min >= sMin && min <= eMin;
      return min >= sMin || min <= eMin;
    });
  }

  /* ═══ Statistics Engine ═══ */
  function computeStats(rows, reliability) {
    var pct = reliability / 100;
    var z = zScore(pct);

    function extract(field, converter) {
      return rows.map(function (r) {
        var v = r[field];
        if (!v || v === 'M') return NaN;
        return converter ? converter(parseFloat(v)) : parseFloat(v);
      }).filter(function (v) { return !isNaN(v); });
    }

    var tmpf = extract('tmpf');
    var tmpc = tmpf.map(function (v) { return (v - 32) * 5 / 9; });
    var altiIn = extract('alti');
    var qnh = altiIn.map(function (v) { return v * 33.8639; });
    var sknt = extract('sknt');
    var gustRaw = extract('gust');
    var drct = extract('drct');

    function basicStats(arr) {
      if (!arr.length) return { mu: NaN, sigma: NaN, n: 0, se: NaN, ci: [NaN, NaN], min: NaN, max: NaN };
      var n = arr.length, mu = arr.reduce(function (s, v) { return s + v; }, 0) / n;
      var sigma = Math.sqrt(arr.reduce(function (s, v) { return s + (v - mu) * (v - mu); }, 0) / n);
      var se = sigma / Math.sqrt(n), ciLo = mu - z * se, ciHi = mu + z * se;
      var min = arr[0], max = arr[0];
      for (var i = 1; i < n; i++) { if (arr[i] < min) min = arr[i]; if (arr[i] > max) max = arr[i]; }
      return { mu: mu, sigma: sigma, n: n, se: se, ci: [ciLo, ciHi], min: min, max: max };
    }

    function circularStats(degArr) {
      if (!degArr.length) return { dir: NaN, R: NaN, n: 0, sector: '-' };
      var n = degArr.length;
      var rad = degArr.map(function (d) { return d * Math.PI / 180; });
      var sinSum = rad.reduce(function (s, v) { return s + Math.sin(v); }, 0);
      var cosSum = rad.reduce(function (s, v) { return s + Math.cos(v); }, 0);
      var R = Math.sqrt(sinSum * sinSum + cosSum * cosSum) / n;
      var dir = Math.atan2(sinSum, cosSum) * 180 / Math.PI;
      if (dir < 0) dir += 360;
      var secs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      return { dir: dir, R: R, n: n, sector: secs[Math.round(dir / 22.5) % 16] };
    }

    var tStats = basicStats(tmpc);
    var qStats = basicStats(qnh);
    var wStats = basicStats(sknt);
    var dStats = circularStats(drct);
    var gustN = sknt.filter(function (v, i) { return !isNaN(v) && !isNaN(gustRaw[i]) && gustRaw[i] > 0; }).length;
    var gustP = sknt.length ? (gustN / sknt.length * 100) : 0;

    return {
      temp: tStats, pressure: qStats, windSpeed: wStats,
      windDir: dStats, gustP: gustP,
      totalObs: rows.length, validObs: sknt.length,
      z: z, reliability: reliability
    };
  }

  function zScore(pct) {
    var tbl = { 0.50: 0, 0.55: 0.125, 0.60: 0.253, 0.65: 0.385, 0.70: 0.524, 0.75: 0.674, 0.80: 0.842, 0.85: 1.036, 0.90: 1.282, 0.95: 1.645, 0.99: 2.326, 0.995: 2.576 };
    if (tbl[pct] !== undefined) return tbl[pct];
    var keys = Object.keys(tbl).map(Number).sort();
    var hi = keys.find(function (k) { return k >= pct; }) || 0.995;
    var lo = keys[keys.indexOf(hi) - 1] || 0.50;
    var t = (pct - lo) / (hi - lo);
    return tbl[lo] + t * (tbl[hi] - tbl[lo]);
  }

  /* ═══ UI Controller ═══ */
  function showStatus(type, msg) {
    var bar = $('status-bar');
    bar.className = 'status visible status-' + type;
    $('status-text').textContent = msg;
    $('status-spinner').style.display = (type === 'loading') ? '' : 'none';
  }
  function hideStatus() { $('status-bar').className = 'status'; }

  function showStationSource(src) {
    var el = $('st-source');
    el.textContent = src === 'github' ? 'GitHub Archive' : src === 'iem' ? 'IEM Live' : 'Local Cache';
    el.className = 'station-source ' + (src === 'github' ? 'source-github' : src === 'iem' ? 'source-iem' : 'source-cache');
  }

  function renderStationInfo(st) {
    var d = st.data;
    var icao = st.icao || '';
    var name = d.name || '';
    var lat = d.lat || 0, lon = d.lon || 0;
    var elev = d.elev_m || d.elev_iem_m || 0;
    var net = d.network || '';
    var code = icao + (d.iata ? ' / ' + d.iata : '');
    $('st-name').textContent = code + ' \u2014 ' + name;
    var parts = ['Lat ' + lat.toFixed(2), 'Lon ' + lon.toFixed(2), 'Elev ' + elev + 'm'];
    if (net) parts.push('Network ' + net);
    if (d.type) parts.unshift(d.type.replace(/_/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); }));
    if (d.municipality) parts.unshift(d.municipality);
    $('st-meta').textContent = parts.join(' | ');
    $('station-info').classList.add('visible');
  }

  function renderStats(stats) {
    $('results-wrap').classList.add('visible');
    $('empty-state').classList.remove('visible');

    var fmt = function (v, d) { return isNaN(v) ? '\u2014' : v.toFixed(d); };
    var fmtCI = function (ci, d) { return isNaN(ci[0]) ? '\u2014' : fmt(ci[0], d) + ' \u2013 ' + fmt(ci[1], d); };

    var gridData = [
      { variable: 'Temperature', unit: '\u00B0C', mean: fmt(stats.temp.mu, 1), ci: fmtCI(stats.temp.ci, 1), min: fmt(stats.temp.min, 1), max: fmt(stats.temp.max, 1), n: stats.temp.n },
      { variable: 'Pressure QNH', unit: 'hPa', mean: fmt(stats.pressure.mu, 1), ci: fmtCI(stats.pressure.ci, 1), min: fmt(stats.pressure.min, 1), max: fmt(stats.pressure.max, 1), n: stats.pressure.n },
      { variable: 'Wind Direction', unit: '\u00B0', mean: fmt(stats.windDir.dir, 0) + ' (' + stats.windDir.sector + ')', ci: '\u2014', min: '\u2014', max: '\u2014', n: stats.windDir.n },
      { variable: 'Wind Speed', unit: 'kt', mean: fmt(stats.windSpeed.mu, 1), ci: fmtCI(stats.windSpeed.ci, 1), min: fmt(stats.windSpeed.min, 1), max: fmt(stats.windSpeed.max, 1), n: stats.windSpeed.n },
      { variable: 'Gust Prob.', unit: '%', mean: fmt(stats.gustP, 1), ci: '\u2014', min: '\u2014', max: '\u2014', n: stats.windSpeed.n }
    ];

    if (window._gridInstance) {
      window._gridInstance.setData(gridData);
    } else {
      window._gridInstance = window.GRID.mount($('results-grid'), {
        data: gridData,
        columns: [
          { key: 'variable', label: 'Variable', width: 140 },
          { key: 'unit', label: 'Unit', width: 60 },
          { key: 'mean', label: 'Mean \u03BC', width: 100 },
          { key: 'ci', label: 'CI ' + stats.reliability + '%', width: 150 },
          { key: 'min', label: 'Min', width: 70 },
          { key: 'max', label: 'Max', width: 70 },
          { key: 'n', label: 'N', width: 70 }
        ],
        height: 235,
        readonly: true,
        statusBar: false
      });
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ═══ Recalculation ═══ */
  function readParams() {
    var t1h = pad2(parseInt($('t1h').value, 10) || 0);
    var t1m = pad2(parseInt($('t1m').value, 10) || 0);
    var t2h = pad2(parseInt($('t2h').value, 10) || 0);
    var t2m = pad2(parseInt($('t2m').value, 10) || 0);
    var reliability = parseInt($('reliability').value, 10) || 85;
    return {
      startTime: t1h + ':' + t1m,
      endTime: t2h + ':' + t2m,
      reliability: Math.max(50, Math.min(99, reliability))
    };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function debouncedRecalc() {
    clearTimeout(_debounce);
    _debounce = setTimeout(recalc, DEBOUNCE_MS);
  }

  function recalc() {
    if (!_rawRows || !_currentStation) return;
    var p = readParams();
    $('reliability').value = p.reliability;
    $('reli-slider').value = p.reliability;
    var filtered = filterByTime(_rawRows, p.startTime, p.endTime);
    var stats = computeStats(filtered, p.reliability);

    if (stats.validObs === 0) {
      showStatus('warning', 'No observations found for ' + p.startTime + '\u2013' + p.endTime + ' UTC. Try a wider time range.');
    } else {
      hideStatus();
    }

    renderStats(stats);
  }

  function setLoading(loading) {
    _downloading = loading;
  }

  /* ═══ Main query entry point ═══ */
  function queryStation() {
    var code = $('icao').value.trim();
    if (!code) { $('empty-state').classList.add('visible'); return; }

    resolveAirport(code).then(function (resolved) {
      if (!resolved) {
        showStatus('error', 'Airport \u201C' + code + '\u201D not found. Try an ICAO code like SBGL or IATA code like GIG.');
        return;
      }

      var icao = resolved.icao;

      if (icao === _lastQueryIcao && _rawRows) {
        _currentStation = resolved;
        renderStationInfo(resolved);
        recalc();
        return;
      }

      setLoading(true);
      showStatus('loading', 'Downloading ' + icao + ' data (' + formatYearRange() + ')...');
      $('station-info').classList.remove('visible');
      $('results-wrap').classList.remove('visible');
      if (window._gridInstance) window._gridInstance.setData([]);

      return fetchStationData(resolved).then(function (csv) {
        setLoading(false);
        if (!csv) {
          showStatus('error', 'No data available for ' + icao + '. The IEM archive may not have records for this station.');
          return;
        }
        _rawRows = parseCSV(csv);
        _currentStation = resolved;
        _lastQueryIcao = icao;
        renderStationInfo(resolved);
        recalc();
      });
    }).catch(function (err) {
      setLoading(false);
      showStatus('error', 'Failed: ' + (err.message || 'Unknown error'));
    });
  }

  /* ═══ Sync slider and number input ═══ */
  function syncReliability() {
    var r = parseInt($('reliability').value, 10) || 85;
    r = Math.max(50, Math.min(99, r));
    $('reliability').value = r;
    $('reli-slider').value = r;
  }

  /* ═══ Event Wiring ═══ */
  $('icao').addEventListener('input', function () {
    this.value = this.value.toUpperCase();
  });
  $('icao').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('btn-search').click(); } });

  $('btn-search').addEventListener('click', function () {
    hideStatus();
    queryStation();
  });

  $('t1h').addEventListener('input', function () { var v = parseInt(this.value, 10); if (!isNaN(v)) this.value = Math.max(0, Math.min(23, v)); debouncedRecalc(); });
  $('t1m').addEventListener('input', function () { var v = parseInt(this.value, 10); if (!isNaN(v)) this.value = Math.max(0, Math.min(59, v)); debouncedRecalc(); });
  $('t2h').addEventListener('input', function () { var v = parseInt(this.value, 10); if (!isNaN(v)) this.value = Math.max(0, Math.min(23, v)); debouncedRecalc(); });
  $('t2m').addEventListener('input', function () { var v = parseInt(this.value, 10); if (!isNaN(v)) this.value = Math.max(0, Math.min(59, v)); debouncedRecalc(); });

  /* Time input: auto-tab from HH to MM */
  function wireTimeInput(hh, mm) {
    hh.addEventListener('input', function () { if (this.value.length >= 2) mm.focus(); });
  }
  wireTimeInput($('t1h'), $('t1m'));
  wireTimeInput($('t2h'), $('t2m'));

  /* Reliability: slider + number sync */
  $('reli-slider').addEventListener('input', function () {
    $('reliability').value = this.value;
    debouncedRecalc();
  });
  $('reliability').addEventListener('input', function () {
    syncReliability();
    debouncedRecalc();
  });
  $('reliability').addEventListener('change', function () { syncReliability(); });

  /* ═══ Init ═══ */
  loadAirports();
  syncReliability();

})();
