// ───────────────────────────────────────────────────────────────────
//  GRID v2 — Motor de planilha estado da arte (zero dependências)
//  Uso: GRID.create(cfg) p/ controle total · GRID.mount(el,opts) drop-in
// ───────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  //  SEC 0  HELPERS INTERNOS
  // ═══════════════════════════════════════════════════════════════

  var doc = document;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function unesc(s) {
    return String(s)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function toast(msg, ms) {
    var el = doc.createElement('div');
    el.className = 'rt-toast';
    el.textContent = msg;
    doc.body.appendChild(el);
    setTimeout(function () { el.classList.add('rt-toast-show'); }, 10);
    setTimeout(function () {
      el.classList.remove('rt-toast-show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, ms || 1800);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function perf() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  function objKeys(o) { var k = []; for (var x in o) { if (Object.prototype.hasOwnProperty.call(o, x)) k.push(x); } return k; }

  // ═══════════════════════════════════════════════════════════════
  //  SEC 1  GRID.create — FACTORY
  // ═══════════════════════════════════════════════════════════════

  window.GRID = window.GRID || {};

  window.GRID.create = function (cfg) {

    cfg = cfg || {};
    var G = {};
    var MODE = 'normal';

    // ── Callback resolvers ───────────────────

    function cb(name, fallback) {
      return cfg[name] || fallback || function () {};
    }

    var ROWS_GET     = cb('getRows', function () { return []; });
    var COLS_GET     = cb('getCols', function () { return []; });
    var VISIBLE      = cb('colVisible', function () { return true; });
    var ROW_COUNT    = cb('rowCount', function () { return ROWS_GET().length; });
    var IS_LOCKED    = cb('isLocked', function () { return false; });
    var FIND_CELL    = cb('findCell', function () { return null; });
    var FIND_ROW_NUM = cb('findRowNum', function () { return null; });
    var RENDERED_RANGE = cb('renderedRange', function () { return { start: 0, end: ROW_COUNT() }; });
    var ON_RENDER    = cb('onRender', function () {});
    var ROW_VALUE    = cb('rowValue', function (r, col) {
      var v = r[col.k];
      return (v === undefined || v === null) ? '' : String(v);
    });
    var SCROLL_TO    = cb('scrollTo', function () {});
    var REFOCUS      = cb('refocus', function () {});
    var SELECT_ROW   = cb('selectRow', function () {});
    var ON_CTX       = cb('onCtxAction', function () {});
    var ON_FILT_ACT  = cb('onFilterAction', function () {});
    var ON_FILT_TOGGLE = cb('onFilterToggle', function () {});
    var ON_DATA_CHANGE = cb('onDataChange', function () {});

    // ── Shared state ─────────────────────────

    function getSt() { return cfg._s || (cfg._s = {}); }

    function ensureState() {
      var s = getSt();
      if (s.selR === undefined) { s.selR = -1; s.selC = -1; s.anchorR = -1; s.anchorC = -1; s.extraRows = null; }
      return s;
    }

    // ═══════════════════════════════════════════════════════════
    //  SEC 2  SELECTION MATH
    // ═══════════════════════════════════════════════════════════

    G.rectOf = function (r1, r2, c1, c2) {
      return { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
    };

    G.inRect = function (r, c, rect) {
      return rect && r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
    };

    G.isSel = function (r, c) {
      var s = ensureState();
      if (s.extraRows && s.extraRows[r]) return true;
      if (s.anchorR < 0 || s.selR < 0) return false;
      return G.inRect(r, c, G.rectOf(s.anchorR, s.selR, s.anchorC, s.selC));
    };

    G.rowSelected = function (i) {
      var s = ensureState();
      if (s.extraRows && s.extraRows[i]) return true;
      if (s.anchorR < 0 || s.selR < 0) return false;
      return i >= Math.min(s.anchorR, s.selR) && i <= Math.max(s.anchorR, s.selR);
    };

    G.allSelectedRows = function () {
      var s = ensureState();
      var seen = {}, out = [];
      if (s.anchorR >= 0 && s.selR >= 0) {
        var r1 = Math.min(s.anchorR, s.selR), r2 = Math.max(s.anchorR, s.selR);
        for (var i = r1; i <= r2; i++) { if (!seen[i]) { seen[i] = true; out.push(i); } }
      }
      if (s.extraRows) {
        objKeys(s.extraRows).forEach(function (k) {
          var j = parseInt(k, 10);
          if (!seen[j]) { seen[j] = true; out.push(j); }
        });
      }
      out.sort(function (a, b) { return a - b; });
      return out;
    };

    G.allSelectedCols = function () {
      var s = ensureState();
      if (s.anchorC < 0 || s.selC < 0) return [];
      var c1 = Math.min(s.anchorC, s.selC);
      var c2 = Math.max(s.anchorC, s.selC);
      var out = [];
      for (var j = c1; j <= c2; j++) { out.push(j); }
      return out;
    };

    G.isContiguousRows = function (rows) {
      for (var i = 1; i < rows.length; i++) { if (rows[i] !== rows[i - 1] + 1) return false; }
      return true;
    };

    G.selectionRect = function () {
      var s = ensureState();
      if (s.selR < 0 || s.anchorR < 0) return null;
      return G.rectOf(s.anchorR, s.selR, s.anchorC, s.selC);
    };

    G.resetSelection = function () {
      var s = ensureState();
      G.paintSelectionRect(s._lastRect, null);
      s.selR = -1; s.selC = -1; s.anchorR = -1; s.anchorC = -1;
      s.extraRows = null; s._lastRect = null;
    };

    G.setSelection = function (r, c, extend) {
      var s = ensureState();
      if (extend) {
        s.selR = r; s.selC = c;
        if (s.anchorR < 0) { s.anchorR = r; s.anchorC = c; }
      } else {
        var oldRect = s._lastRect;
        s.anchorR = r; s.anchorC = c; s.selR = r; s.selC = c;
        s.extraRows = null;
        G.paintExtraRows(s._lastExtra || [], []);
        s._lastExtra = [];
        G.paintSelectionRect(oldRect, G.rectOf(s.anchorR, s.selR, s.anchorC, s.selC));
      }
      SCROLL_TO(r, c);
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 3  NAVIGATION
    // ═══════════════════════════════════════════════════════════

    var isRowHidden = cfg.isRowHidden || function () { return false; };

    G.visibleInDir = function (i, dr) {
      var n = ROW_COUNT(), j = i + dr;
      while (j >= 0 && j < n) { if (!isRowHidden(j)) return j; j += dr; }
      return i;
    };

    G.cellHasContent = function (r, c, rowFn) {
      var rows = ROWS_GET();
      if (!rows[r]) return false;
      var val = (rowFn || ROW_VALUE)(rows[r], COLS_GET()[c]);
      return val !== undefined && val !== null && String(val).trim() !== '';
    };

    G.blockEnd = function (sr, sc, dr, dc, rowFn) {
      var n = ROW_COUNT(), cols = COLS_GET();
      if (dr !== 0) {
        if (sr < 0 || sr >= n) return sr;
        var has = G.cellHasContent(sr, sc, rowFn), r = sr;
        while (true) {
          var nr = r + dr; if (nr < 0 || nr >= n) break;
          if (!isRowHidden(nr) && G.cellHasContent(nr, sc, rowFn) !== has) break;
          r = nr;
        }
        return r;
      }
      if (dc !== 0) {
        if (sc < 0 || sc >= cols.length) return sc;
        var hasC = G.cellHasContent(sr, sc, rowFn), cc = sc;
        while (true) {
          var nc = cc + dc; if (nc < 0 || nc >= cols.length) break;
          if (VISIBLE(nc) && G.cellHasContent(sr, nc, rowFn) !== hasC) break;
          cc = nc;
        }
        return cc;
      }
      return dr !== 0 ? sr : sc;
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 4  INCREMENTAL PAINT
    // ═══════════════════════════════════════════════════════════

    G.paintSelectionRect = function (old, cur) {
      var s = ensureState();
      var activeCell = FIND_CELL(s.selR, s.selC);
      if (s._lastActive && (s._lastActive.r !== s.selR || s._lastActive.c !== s.selC)) {
        var oa = FIND_CELL(s._lastActive.r, s._lastActive.c);
        if (oa) oa.classList.remove('active');
      }
      if (activeCell && !activeCell.classList.contains('active')) {
        activeCell.classList.add('active');
      }
      s._lastActive = (s.selR >= 0) ? { r: s.selR, c: s.selC } : null;

      var rects = (old || cur) ? { r1: 0, r2: 0, c1: 0, c2: 0 } : null;
      if (rects) {
        rects.r1 = Math.min(old ? old.r1 : cur.r1, cur ? cur.r1 : old.r1);
        rects.r2 = Math.max(old ? old.r2 : cur.r2, cur ? cur.r2 : old.r2);
        rects.c1 = Math.min(old ? old.c1 : cur.c1, cur ? cur.c1 : old.c1);
        rects.c2 = Math.max(old ? old.c2 : cur.c2, cur ? cur.c2 : old.c2);
      }
      if (!rects) { s._lastRect = cur; return; }

      var win = RENDERED_RANGE();
      if (rects.r1 < win.start) rects.r1 = win.start;
      if (rects.r2 >= win.end) rects.r2 = win.end - 1;
      if (rects.r1 > rects.r2) { s._lastRect = cur; return; }

      for (var r = rects.r1; r <= rects.r2; r++) {
        for (var c = rects.c1; c <= rects.c2; c++) {
          if (!VISIBLE(c)) continue;
          var was = G.inRect(r, c, old);
          var is = G.inRect(r, c, cur);
          if (was === is) continue;
          var el = FIND_CELL(r, c);
          if (!el) continue;
          if (is) el.classList.add('sel'); else el.classList.remove('sel');
        }
        var wasR = old ? r >= old.r1 && r <= old.r2 : false;
        var isR = cur ? r >= cur.r1 && r <= cur.r2 : false;
        if (wasR === isR) continue;
        var rnel = FIND_ROW_NUM(r);
        if (rnel) {
          if (isR) rnel.classList.add('sel'); else rnel.classList.remove('sel');
        }
      }
      s._lastRect = cur;
    };

    G.paintExtraRows = function (oldRows, newRows) {
      var o = {}, n = {};
      (oldRows || []).forEach(function (i) { o[i] = true; });
      (newRows || []).forEach(function (i) { n[i] = true; });
      var all = [];
      objKeys(o).concat(objKeys(n)).forEach(function (k) { var v = parseInt(k, 10); if (all.indexOf(v) < 0) all.push(v); });
      var win = RENDERED_RANGE();
      all.forEach(function (r) {
        if (r < win.start || r >= win.end) return;
        var on = !!n[r];
        var rnel = FIND_ROW_NUM(r);
        if (rnel) { if (on) rnel.classList.add('sel'); else rnel.classList.remove('sel'); }
        for (var c = 0; c < COLS_GET().length; c++) {
          if (!VISIBLE(c)) continue;
          var el = FIND_CELL(r, c);
          if (!el) continue;
          if (on) el.classList.add('sel'); else el.classList.remove('sel');
        }
      });
    };

    G.ctrlToggleRow = function (fi) {
      var s = ensureState();
      if (fi < 0 || fi >= ROW_COUNT()) return;
      var rows = G.allSelectedRows();
      var idx = rows.indexOf(fi);
      if (idx >= 0) rows.splice(idx, 1);
      else rows.push(fi);
      s.extraRows = {};
      rows.forEach(function (i) { s.extraRows[i] = true; });
      s.anchorR = -1; s.anchorC = -1; s.selR = -1; s.selC = -1;
      G.paintSelectionRect(s._lastRect, null);
      G.paintExtraRows(s._lastExtra || [], Object.keys(s.extraRows).map(Number));
      s._lastExtra = Object.keys(s.extraRows).map(Number);
      SCROLL_TO(fi, 0);
    };

    G.syncSelection = function () {
      var s = ensureState();
      if (s.extraRows) { s.extraRows = null; s._lastExtra = []; G.paintExtraRows(s._lastExtra, []); }
      G.paintSelectionRect(s._lastRect, (s.selR >= 0 && s.anchorR >= 0) ? G.rectOf(s.anchorR, s.selR, s.anchorC, s.selC) : null);
    };

    G.selectColumn = function (c) {
      var s = ensureState();
      var oldRect = s._lastRect;
      s.anchorR = 0; s.anchorC = c;
      s.selR = ROW_COUNT() - 1; s.selC = c;
      s.extraRows = null; s._lastExtra = [];
      G.paintSelectionRect(oldRect, G.rectOf(s.anchorR, s.selR, s.anchorC, s.selC));
    };

    G.selectAll = function () {
      var s = ensureState();
      var oldRect = s._lastRect;
      s.anchorR = 0; s.anchorC = 0;
      s.selR = ROW_COUNT() - 1; s.selC = COLS_GET().length - 1;
      s.extraRows = null; s._lastExtra = [];
      G.paintSelectionRect(oldRect, G.rectOf(s.anchorR, s.selR, s.anchorC, s.selC));
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 5  KEYBOARD + STATE MACHINE
    // ═══════════════════════════════════════════════════════════

    function cancelDrags() {
      if (MODE === 'drag-resize') { G.endResize(); MODE = 'normal'; }
      if (MODE === 'drag-reorder') { G.endColDrag(); MODE = 'normal'; }
      if (MODE === 'drag-fill') { G.endAutoFill(); MODE = 'normal'; }
    }

    G.handleKeyDown = function (e, opts) {
      if (MODE === 'edit') return handleEditKeys(e, opts);
      if (MODE === 'find') return handleFindKeys(e, opts);
      return G.handleNormalKeys(e, opts);
    };

    G.handleNormalKeys = function (e) {
      var s = ensureState();
      var rows = ROW_COUNT(), cols = COLS_GET().length;
      var r = s.selR, c = s.selC;
      if (r < 0) r = 0; if (c < 0) c = 0;
      var shift = e.shiftKey, ctrl = e.ctrlKey || e.metaKey;
      var handled = true, extend = shift;

      switch (e.key) {
        case 'ArrowUp':    r = (r > 0) ? G.visibleInDir(r, -1) : r; break;
        case 'ArrowDown':  r = (r < rows - 1) ? G.visibleInDir(r, 1) : r; break;
        case 'ArrowLeft':  c = c > 0 ? c - 1 : c; if (!VISIBLE(c)) { var cc = c; while (cc >= 0 && !VISIBLE(cc)) cc--; c = cc < 0 ? c + 1 : cc; } break;
        case 'ArrowRight': c = c < cols - 1 ? c + 1 : c; if (!VISIBLE(c)) { var dd = c; while (dd < cols && !VISIBLE(dd)) dd++; c = dd >= cols ? c - 1 : dd; } break;
        case 'Tab':        if (shift) { c--; if (c < 0) { c = 0; } } else { c++; if (c >= cols) { /* wrap */ c = 0; } } extend = false; break;
        case 'Enter':      r = G.visibleInDir(r, 1); extend = false; if (shift) r = G.visibleInDir(r, -1); break;
        case 'Home':       if (ctrl) { r = 0; } c = 0; break;
        case 'End':        if (ctrl) { r = rows - 1; } c = cols - 1; break;
        case 'PageUp':     r = Math.max(0, r - 20); break;
        case 'PageDown':   r = Math.min(rows - 1, r + 20); break;

        case 'Escape':     cancelDrags(); G.resetSelection(); return;
        case 'F2':         if (!cfg.disableEdit) G.startEdit(); handled = true; break;
        case 'Delete': case 'Backspace': if (!cfg.disableEdit) G.clearSelection(); break;

        case 'c': case 'C': if (ctrl) G.copy(); break;
        case 'v': case 'V': if (ctrl) G.paste(); break;
        case 'x': case 'X': if (ctrl) G.cut(); break;
        case 'z': case 'Z': if (ctrl && !shift) G.undo(); if (ctrl && shift) G.redo(); break;
        case 'y': case 'Y': if (ctrl) G.redo(); break;
        case 'a': case 'A': if (ctrl) { e.preventDefault(); G.selectAll(); return; } break;
        case 'f': case 'F': if (ctrl) { e.preventDefault(); G.openFind(); return; } break;

        case 'ArrowUp_ctrl':   if (ctrl) r = G.blockEnd(r, c, -1, 0); break;
        case 'ArrowDown_ctrl': if (ctrl) r = G.blockEnd(r, c, 1, 0); break;
        case 'ArrowLeft_ctrl': if (ctrl) c = G.blockEnd(r, c, 0, -1); break;
        case 'ArrowRight_ctrl': if (ctrl) c = G.blockEnd(r, c, 0, 1); break;

        default: handled = false;
      }

      // Handle Ctrl+Arrow combos
      if (ctrl && !shift) {
        if (e.key === 'ArrowUp') { r = G.blockEnd(r, c, -1, 0); handled = true; }
        if (e.key === 'ArrowDown') { r = G.blockEnd(r, c, 1, 0); handled = true; }
        if (e.key === 'ArrowLeft') { c = G.blockEnd(r, c, 0, -1); handled = true; }
        if (e.key === 'ArrowRight') { c = G.blockEnd(r, c, 0, 1); handled = true; }
      }

      if (handled) {
        e.preventDefault();
        r = clamp(r, 0, rows - 1); c = clamp(c, 0, cols - 1);
        G.setSelection(r, c, extend);
        REFOCUS();
      }
    };

    function handleEditKeys(e) {
      if (e.key === 'Escape') { e.preventDefault(); G.cancelEdit(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); G.commitEdit(); G.handleNormalKeys({ key: 'ArrowDown', shiftKey: false, ctrlKey: false, preventDefault: function () {} }); return; }
      if (e.key === 'Tab') { e.preventDefault(); G.commitEdit(); G.handleNormalKeys({ key: 'Tab', shiftKey: e.shiftKey, ctrlKey: false, preventDefault: function () {} }); return; }
    }

    function handleFindKeys(e) {
      if (e.key === 'Escape') { G.closeFind(); }
      if (e.key === 'Enter') { e.preventDefault(); G.findNext(); }
    }

    // ═══════════════════════════════════════════════════════════
    //  SEC 6  CLIPBOARD
    // ═══════════════════════════════════════════════════════════

    G.copy = function () {
      var data = G.getSelectedData();
      if (!data.length) return;
      var tsv = data.map(function (row) { return row.join('\t'); }).join('\n');
      copyToClipboard(tsv);
      toast('Copied ' + data.length + '×' + data[0].length + ' cells');
    };

    G.cut = function () {
      G.copy();
      G.clearSelection();
    };

    G.paste = function () {
      if (cfg.disableEdit) return;
      readFromClipboard(function (text) {
        var lines = text.split(/\r?\n/);
        if (!lines.length || (lines.length === 1 && !lines[0].trim())) return;
        var parsed = lines.map(function (l) { return l.split('\t'); });
        var s = ensureState();
        var startR = Math.max(0, s.selR), startC = Math.max(0, s.selC);
        G.applyPastedData(startR, startC, parsed);
      });
    };

    G.getSelectedData = function () {
      var rows = ROWS_GET(), cols = COLS_GET();
      var selRows = G.allSelectedRows();
      if (!selRows.length) { var s = ensureState(); if (s.selR >= 0) selRows = [s.selR]; }
      var selCols = G.allSelectedCols();
      if (!selCols.length) { var s2 = ensureState(); if (s2.selC >= 0) selCols = [s2.selC]; }
      if (!selRows.length || !selCols.length) return [];

      return selRows.map(function (r) {
        return selCols.map(function (c) {
          var row = rows[r]; if (!row) return '';
          return ROW_VALUE(row, cols[c]);
        });
      });
    };

    G.clearSelection = function () {
      if (cfg.disableEdit) return;
      var selRows = G.allSelectedRows();
      var selCols = G.allSelectedCols();
      var s = ensureState();
      if (!selRows.length && s.selR >= 0) selRows = [s.selR];
      if (!selCols.length && s.selC >= 0) selCols = [s.selC];
      var changes = [];
      var cols = COLS_GET(), rows = ROWS_GET();
      selRows.forEach(function (r) {
        selCols.forEach(function (c) {
          var oldVal = rows[r] ? String(rows[r][cols[c].k] || '') : '';
          changes.push({ r: r, c: c, old: oldVal, new: '' });
        });
      });
      if (changes.length) {
        G.pushUndo({ type: 'cellChange', cells: changes.map(function (ch) { return { r: ch.r, c: ch.c, old: ch.old, new: ch.new }; }), invert: function () { this.cells.forEach(function (cell) { var t = cell.old; cell.old = cell.new; cell.new = t; }); } });
        ON_DATA_CHANGE(changes);
        ON_RENDER();
      }
    };

    G.applyPastedData = function (startR, startC, data) {
      var rows = ROWS_GET(), cols = COLS_GET();
      var maxR = ROW_COUNT();
      var changes = [];
      var oldVals = [];
      for (var i = 0; i < data.length && startR + i < maxR; i++) {
        for (var j = 0; j < data[i].length && startC + j < cols.length; j++) {
          if (!VISIBLE(startC + j)) continue;
          var newVal = (data[i][j] || '').trim();
          var oldVal = rows[startR + i] ? String(rows[startR + i][cols[startC + j].k] || '') : '';
          if (oldVal === newVal) continue;
          changes.push({ r: startR + i, c: startC + j, old: oldVal, new: newVal });
          oldVals.push({ r: startR + i, c: startC + j, old: oldVal, new: newVal });
        }
      }
      if (changes.length) {
        G.pushUndo({ type: 'paste', cells: oldVals.map(function (ov) { return { r: ov.r, c: ov.c, old: ov.old, new: ov.new }; }), invert: function () { var self = this; self.cells.forEach(function (cell) { var t = cell.old; cell.old = cell.new; cell.new = t; }); } });
        ON_DATA_CHANGE(changes);
        ON_RENDER();
        sndToast('Pasted ' + data.length + '×' + data[0].length);
      }
    };

    function copyToClipboard(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
      } else { fallbackCopy(text); }
    }

    function fallbackCopy(text) {
      var ta = doc.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      doc.body.appendChild(ta); ta.select();
      try { doc.execCommand('copy'); } catch (e) {}
      doc.body.removeChild(ta);
    }

    function readFromClipboard(cb) {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(cb).catch(function () {});
      } else {
        toast('Paste: use Ctrl+V or right-click');
      }
    }

    function sndToast(msg) { if (!cfg.disableToast) toast(msg); }

    // ═══════════════════════════════════════════════════════════
    //  SEC 7  INLINE CELL EDITING
    // ═══════════════════════════════════════════════════════════

    G.startEdit = function (initialValue) {
      if (MODE === 'edit' || cfg.disableEdit) return;
      var s = ensureState();
      var r = s.selR, c = s.selC;
      if (r < 0 || c < 0) return;
      MODE = 'edit';
      s._editR = r; s._editC = c;

      var cellEl = FIND_CELL(r, c);
      if (!cellEl) return;

      var rect = cellEl.getBoundingClientRect();
      var val = initialValue !== undefined ? String(initialValue) : String(cellEl.textContent || '');
      var inp = doc.createElement('input');
      inp.type = 'text';
      inp.className = 'rt-edit-input';
      inp.value = val;
      inp.style.position = 'fixed';
      inp.style.left = rect.left + 'px';
      inp.style.top = rect.top + 'px';
      inp.style.width = rect.width + 'px';
      inp.style.height = rect.height + 'px';
      inp.style.zIndex = '200';
      doc.body.appendChild(inp);
      inp.focus();
      inp.select();
      s._editInput = inp;
      s._editOrig = val;

      inp.addEventListener('blur', function () { if (MODE === 'edit') G.commitEdit(); });
      inp.addEventListener('keydown', function (ev) { if (MODE === 'edit') handleEditKeys(ev); });
      inp.addEventListener('input', function () {
        var w = Math.max(rect.width, inp.value.length * 9 + 16);
        inp.style.width = w + 'px';
      });
    };

    G.commitEdit = function () {
      var s = ensureState();
      if (!s._editInput) return;
      var val = s._editInput.value;
      var r = s._editR, c = s._editC;
      var oldVal = s._editOrig;
      doc.body.removeChild(s._editInput);
      s._editInput = null; s._editR = -1; s._editC = -1;
      MODE = 'normal';
      if (val !== oldVal) {
        var changes = [{ r: r, c: c, old: oldVal, new: val }];
        G.pushUndo({ type: 'cellChange', cells: [{ r: r, c: c, old: oldVal, new: val }], invert: function () { this.cells.forEach(function (cell) { var t = cell.old; cell.old = cell.new; cell.new = t; }); } });
        ON_DATA_CHANGE(changes);
        ON_RENDER();
      }
      REFOCUS();
    };

    G.cancelEdit = function () {
      var s = ensureState();
      if (!s._editInput) return;
      doc.body.removeChild(s._editInput);
      s._editInput = null; s._editR = -1; s._editC = -1;
      MODE = 'normal';
      REFOCUS();
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 8  UNDO / REDO COMMAND STACK
    // ═══════════════════════════════════════════════════════════

    var _undoStack = [], _redoStack = [], _undoMax = (cfg.undoMax || 100);

    G.pushUndo = function (cmd) {
      if (!cmd) return;
      _undoStack.push(cmd);
      _redoStack = [];
      if (_undoStack.length > _undoMax) _undoStack.shift();
    };

    G.undo = function () {
      if (!_undoStack.length) return;
      var cmd = _undoStack.pop();
      _redoStack.push(cmd);
      applyUndoRedo(cmd, 'undo');
      toast('Undo');
    };

    G.redo = function () {
      if (!_redoStack.length) return;
      var cmd = _redoStack.pop();
      _undoStack.push(cmd);
      applyUndoRedo(cmd, 'redo');
      toast('Redo');
    };

    function applyUndoRedo(cmd, dir) {
      if (cmd.type === 'cellChange' || cmd.type === 'paste' || cmd.type === 'rowInsert' || cmd.type === 'rowDelete') {
        var changes = cmd.cells.map(function (cell) {
          var t = cell.old; cell.old = cell.new; cell.new = t;
          return { r: cell.r, c: cell.c, old: t, new: cell.old };
        });
        ON_DATA_CHANGE(changes);
        ON_RENDER();
      }
    }

    // ═══════════════════════════════════════════════════════════
    //  SEC 9  COLUMN RESIZE
    // ═══════════════════════════════════════════════════════════

    G.startResize = function (colIdx, startX) {
      if (MODE !== 'normal') return;
      MODE = 'drag-resize';
      var s = ensureState();
      s._rsCol = colIdx; s._rsStartX = startX; s._rsOrigW = getColWidth(colIdx);

      var ov = doc.createElement('div');
      ov.className = 'rt-resize-line';
      ov.style.position = 'fixed';
      ov.style.left = startX + 'px';
      ov.style.top = '0';
      ov.style.width = '2px';
      ov.style.height = '100vh';
      ov.style.zIndex = '999';
      ov.style.background = '#4285f4';
      ov.style.pointerEvents = 'none';
      doc.body.appendChild(ov);
      s._rsLine = ov;
      doc.body.style.cursor = 'col-resize';
      doc.body.style.userSelect = 'none';
    };

    G.onResizeMove = function (clientX) {
      var s = ensureState();
      if (MODE !== 'drag-resize' || !s._rsLine) return;
      var dx = clientX - s._rsStartX;
      var newW = Math.max(30, s._rsOrigW + dx);
      s._rsLine.style.left = (s._rsStartX + (newW - s._rsOrigW)) + 'px';
      s._rsNewW = newW;
    };

    G.endResize = function () {
      var s = ensureState();
      if (MODE !== 'drag-resize') return;
      MODE = 'normal';
      if (s._rsLine) { doc.body.removeChild(s._rsLine); s._rsLine = null; }
      doc.body.style.cursor = ''; doc.body.style.userSelect = '';
      if (s._rsNewW != null && cfg.onColResize) {
        cfg.onColResize(s._rsCol, s._rsNewW);
      }
      s._rsCol = -1; s._rsStartX = 0; s._rsOrigW = 0; s._rsNewW = null;
    };

    G.autoFitColumn = function (colIdx) {
      if (!cfg.onColResize) return;
      var rows = ROWS_GET(), cols = COLS_GET();
      if (colIdx < 0 || colIdx >= cols.length) return;
      var maxW = 30;
      for (var i = 0; i < Math.min(rows.length, 500); i++) {
        var val = ROW_VALUE(rows[i], cols[colIdx]);
        var w = String(val).length * 8 + 24;
        if (w > maxW) maxW = w;
      }
      cfg.onColResize(colIdx, Math.min(maxW, 600));
    };

    function getColWidth(colIdx) {
      if (cfg.getColWidth) return cfg.getColWidth(colIdx);
      var cols = COLS_GET();
      if (cols[colIdx] && cols[colIdx].width) return cols[colIdx].width;
      return 100;
    }

    // ═══════════════════════════════════════════════════════════
    //  SEC 10  FIND & REPLACE
    // ═══════════════════════════════════════════════════════════

    G.openFind = function () {
      G.closeFind();
      if (!cfg.onFindOpen) return;
      MODE = 'find';
      var s = ensureState();
      s._findQuery = ''; s._findMatches = []; s._findIdx = -1;
      cfg.onFindOpen();
    };

    G.closeFind = function () {
      MODE = 'normal';
      var s = ensureState();
      G.clearFindHighlights();
      s._findQuery = ''; s._findMatches = []; s._findIdx = -1;
      if (cfg.onFindClose) cfg.onFindClose();
    };

    G.doFind = function (query) {
      var s = ensureState();
      G.clearFindHighlights();
      s._findQuery = query; s._findMatches = []; s._findIdx = -1;
      if (!query) return { count: 0 };

      var q = query.toLowerCase();
      var rows = ROWS_GET(), cols = COLS_GET();
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < cols.length; c++) {
          if (!VISIBLE(c)) continue;
          var val = ROW_VALUE(rows[r], cols[c]);
          if (val.toLowerCase().indexOf(q) >= 0) {
            s._findMatches.push({ r: r, c: c });
          }
        }
      }
      G.highlightFindMatches();
      return { count: s._findMatches.length };
    };

    G.findNext = function () {
      var s = ensureState();
      if (!s._findMatches.length) return null;
      s._findIdx = (s._findIdx + 1) % s._findMatches.length;
      G.highlightFindCurrent();
      var m = s._findMatches[s._findIdx];
      SCROLL_TO(m.r, m.c);
      return m;
    };

    G.findPrev = function () {
      var s = ensureState();
      if (!s._findMatches.length) return null;
      s._findIdx = (s._findIdx - 1 + s._findMatches.length) % s._findMatches.length;
      G.highlightFindCurrent();
      var m = s._findMatches[s._findIdx];
      SCROLL_TO(m.r, m.c);
      return m;
    };

    G.replaceCurrent = function (replacement) {
      var s = ensureState();
      if (!s._findMatches.length || s._findIdx < 0) return;
      var m = s._findMatches[s._findIdx];
      var oldVal = getCellRaw(m.r, m.c);
      var q = s._findQuery;
      var newVal = oldVal.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replacement);
      if (newVal !== oldVal) {
        var changes = [{ r: m.r, c: m.c, old: oldVal, new: newVal }];
        G.pushUndo({ type: 'cellChange', cells: [{ r: m.r, c: m.c, old: oldVal, new: newVal }], invert: function () { this.cells.forEach(function (cell) { var t = cell.old; cell.old = cell.new; cell.new = t; }); } });
        ON_DATA_CHANGE(changes);
        ON_RENDER();
      }
    };

    G.replaceAll = function (query, replacement) {
      var s = ensureState();
      var q = query.toLowerCase();
      var rows = ROWS_GET(), cols = COLS_GET();
      var changes = [], undoCells = [];
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < cols.length; c++) {
          if (!VISIBLE(c)) continue;
          var oldVal = getCellRaw(r, c);
          var newVal = oldVal.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replacement);
          if (newVal !== oldVal) {
            changes.push({ r: r, c: c, old: oldVal, new: newVal });
            undoCells.push({ r: r, c: c, old: oldVal, new: newVal });
          }
        }
      }
      if (changes.length) {
        G.pushUndo({ type: 'paste', cells: undoCells, invert: function () { this.cells.forEach(function (cell) { var t = cell.old; cell.old = cell.new; cell.new = t; }); } });
        ON_DATA_CHANGE(changes);
        ON_RENDER();
        toast('Replaced ' + changes.length + ' occurrences');
      }
    };

    G.clearFindHighlights = function () {
      var s = ensureState();
      if (s._findMatches) {
        s._findMatches.forEach(function (m) {
          var el = FIND_CELL(m.r, m.c);
          if (el) { el.classList.remove('rt-find-match', 'rt-find-current'); }
        });
      }
    };

    G.highlightFindMatches = function () {
      var s = ensureState();
      s._findMatches.forEach(function (m) {
        var el = FIND_CELL(m.r, m.c);
        if (el) el.classList.add('rt-find-match');
      });
    };

    G.highlightFindCurrent = function () {
      var s = ensureState();
      s._findMatches.forEach(function (m, i) {
        var el = FIND_CELL(m.r, m.c);
        if (el) {
          el.classList.remove('rt-find-current');
          if (i === s._findIdx) el.classList.add('rt-find-current');
        }
      });
    };

    function getCellRaw(r, c) {
      var rows = ROWS_GET(), cols = COLS_GET();
      if (!rows[r]) return '';
      return ROW_VALUE(rows[r], cols[c]);
    }

    // ═══════════════════════════════════════════════════════════
    //  SEC 11  AUTO-FILL
    // ═══════════════════════════════════════════════════════════

    var MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    var MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    G.startAutoFill = function (clientX, clientY) {
      if (MODE !== 'normal' || cfg.disableEdit) return;
      var s = ensureState();
      var rect = G.selectionRect();
      if (!rect) return;
      MODE = 'drag-fill';
      s._fillRect = rect;
      s._fillStartY = clientY;
      s._fillEndR = rect.r2;
    };

    G.onAutoFillMove = function (clientX, clientY) {
      var s = ensureState();
      if (MODE !== 'drag-fill') return;
      var rows = ROW_COUNT();
      var dy = clientY - s._fillStartY;
      // Rough: 24px per row
      var extraRows = Math.round(dy / 24);
      s._fillEndR = clamp(s._fillRect.r2 + extraRows, s._fillRect.r2, rows - 1);

      // Paint preview
      var oldEnd = s._fillPrevEnd || s._fillRect.r2;
      var r1 = s._fillRect.r2 + 1;
      var r2 = Math.max(oldEnd, s._fillEndR);
      var win = RENDERED_RANGE();
      r1 = Math.max(r1, win.start);
      r2 = Math.min(r2, win.end - 1);
      for (var r = r1; r <= r2; r++) {
        var on = r <= s._fillEndR;
        for (var c = s._fillRect.c1; c <= s._fillRect.c2; c++) {
          if (!VISIBLE(c)) continue;
          var el = FIND_CELL(r, c);
          if (!el) continue;
          if (on) el.classList.add('rt-fill-preview');
          else el.classList.remove('rt-fill-preview');
        }
      }
      s._fillPrevEnd = s._fillEndR;
    };

    G.endAutoFill = function () {
      var s = ensureState();
      if (MODE !== 'drag-fill') return;
      MODE = 'normal';

      var rect = s._fillRect;
      var endR = s._fillEndR;
      G.clearAutoFillPreview();

      if (endR <= rect.r2) { s._fillRect = null; s._fillStartY = 0; s._fillEndR = 0; s._fillPrevEnd = 0; return; }

      var rows = ROWS_GET(), cols = COLS_GET();
      var changes = [], undoCells = [];
      var srcRows = rect.r2 - rect.r1 + 1;

      for (var c = rect.c1; c <= rect.c2; c++) {
        if (!VISIBLE(c)) continue;
        var values = [];
        for (var sr = rect.r1; sr <= rect.r2; sr++) {
          values.push(ROW_VALUE(rows[sr], cols[c]));
        }
        var pattern = detectPattern(values);

        for (var tr = rect.r2 + 1; tr <= endR; tr++) {
          var idx = (tr - rect.r1) % srcRows;
          var newVal;
          if (pattern && pattern.type === 'arithmetic') {
            var step = tr - rect.r1;
            newVal = String(pattern.base + step * pattern.step);
          } else if (pattern && pattern.type === 'months') {
            newVal = pattern.months[(pattern.startIdx + (tr - rect.r1)) % pattern.months.length];
          } else if (pattern && pattern.type === 'prefixNum') {
            newVal = pattern.prefix + (pattern.base + (tr - rect.r1) * pattern.step);
          } else if (pattern && pattern.type === 'letterSuffix') {
            var ch = String.fromCharCode(pattern.base.charCodeAt(0) + (tr - rect.r1));
            newVal = pattern.prefix + ' ' + ch;
          } else {
            newVal = values[idx];
          }
          var oldVal = rows[tr] ? String(rows[tr][cols[c].k] || '') : '';
          if (newVal !== oldVal) {
            changes.push({ r: tr, c: c, old: oldVal, new: newVal });
            undoCells.push({ r: tr, c: c, old: oldVal, new: newVal });
          }
        }
      }

      if (changes.length) {
        G.pushUndo({ type: 'paste', cells: undoCells, invert: function () { this.cells.forEach(function (cell) { var t = cell.old; cell.old = cell.new; cell.new = t; }); } });
        ON_DATA_CHANGE(changes);
        ON_RENDER();
      }

      s._fillRect = null; s._fillStartY = 0; s._fillEndR = 0; s._fillPrevEnd = 0;
    };

    G.clearAutoFillPreview = function () {
      var s = ensureState();
      var r1 = s._fillRect ? s._fillRect.r2 + 1 : 0;
      var r2 = s._fillEndR || r1;
      var win = RENDERED_RANGE();
      r1 = Math.max(r1, win.start);
      r2 = Math.min(r2, win.end - 1);
      for (var r = r1; r <= r2; r++) {
        for (var c = 0; c < COLS_GET().length; c++) {
          if (!VISIBLE(c)) continue;
          var el = FIND_CELL(r, c);
          if (el) el.classList.remove('rt-fill-preview');
        }
      }
    };

    function detectPattern(values) {
      if (values.length < 2) return null;

      // Try arithmetic
      var nums = [];
      for (var i = 0; i < values.length; i++) {
        var n = parseFloat(values[i]);
        if (isNaN(n)) { nums = null; break; }
        nums.push(n);
      }
      if (nums) {
        var base = nums[0], step = nums[1] - nums[0];
        var ok = true;
        for (var j = 2; j < nums.length; j++) { if (Math.abs(nums[j] - (base + j * step)) > 0.001) { ok = false; break; } }
        if (ok && step !== 0) return { type: 'arithmetic', base: base, step: step };
      }

      // Try months
      var lower = values.map(function (v) { return String(v).toLowerCase().trim(); });
      for (var m = 0; m < MONTHS_PT.length; m++) {
        if (lower[0] === MONTHS_PT[m]) {
          var okM = true, startI = m;
          for (var k = 1; k < lower.length; k++) { if (lower[k] !== MONTHS_PT[(m + k) % MONTHS_PT.length]) { okM = false; break; } }
          if (okM) return { type: 'months', months: MONTHS_PT, startIdx: startI };
        }
      }
      for (var me = 0; me < MONTHS_EN.length; me++) {
        if (lower[0] === MONTHS_EN[me]) {
          var okMe = true, sIe = me;
          for (var ke = 1; ke < lower.length; ke++) { if (lower[ke] !== MONTHS_EN[(me + ke) % MONTHS_EN.length]) { okMe = false; break; } }
          if (okMe) return { type: 'months', months: MONTHS_EN, startIdx: sIe };
        }
      }

      // Try prefix + number (Item 1, Item 2...)
      var pnMatch = values[0].match(/^(.+?)\s*(\d+)$/);
      if (pnMatch) {
        var pfx = pnMatch[1], baseNum = parseInt(pnMatch[2], 10);
        var okPn = true;
        for (var p = 1; p < values.length; p++) {
          var m2 = values[p].match(/^(.+?)\s*(\d+)$/);
          if (!m2 || m2[1] !== pfx || parseInt(m2[2], 10) !== baseNum + p) { okPn = false; break; }
        }
        if (okPn) return { type: 'prefixNum', prefix: pfx, base: baseNum, step: 1 };
      }

      // Try prefix + letter (Item A, Item B...)
      var plMatch = values[0].match(/^(.+)\s+([A-Za-z])$/);
      if (plMatch) {
        var prefixL = plMatch[1], baseL = plMatch[2];
        var okPl = true;
        for (var li = 1; li < values.length; li++) {
          var ml = values[li].match(/^(.+)\s+([A-Za-z])$/);
          var expected = String.fromCharCode(baseL.charCodeAt(0) + li);
          if (!ml || ml[1] !== prefixL || ml[2] !== expected) { okPl = false; break; }
        }
        if (okPl) return { type: 'letterSuffix', prefix: prefixL, base: baseL };
      }

      return null;
    }

    // ═══════════════════════════════════════════════════════════
    //  SEC 12  COLUMN REORDER
    // ═══════════════════════════════════════════════════════════

    G.startColDrag = function (colIdx, startX) {
      if (MODE !== 'normal') return;
      MODE = 'drag-reorder';
      var s = ensureState();
      s._drCol = colIdx; s._drStartX = startX; s._drCurX = startX;

      var ov = doc.createElement('div');
      ov.className = 'rt-drag-indicator';
      ov.style.position = 'fixed';
      ov.style.left = startX + 'px';
      ov.style.top = '0';
      ov.style.width = '2px';
      ov.style.height = '100vh';
      ov.style.zIndex = '999';
      ov.style.background = '#ea4335';
      ov.style.pointerEvents = 'none';
      doc.body.appendChild(ov);
      s._drLine = ov;
      doc.body.style.cursor = 'col-resize';
      doc.body.style.userSelect = 'none';
    };

    G.onColDragMove = function (clientX) {
      var s = ensureState();
      if (MODE !== 'drag-reorder' || !s._drLine) return;
      s._drLine.style.left = clientX + 'px';
      s._drCurX = clientX;
    };

    G.endColDrag = function () {
      var s = ensureState();
      if (MODE !== 'drag-reorder') return;
      MODE = 'normal';
      if (s._drLine) { doc.body.removeChild(s._drLine); s._drLine = null; }
      doc.body.style.cursor = ''; doc.body.style.userSelect = '';
      if (cfg.onColReorder) cfg.onColReorder(s._drCol, s._drCurX);
      s._drCol = -1; s._drStartX = 0; s._drCurX = 0;
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 13  STATUS BAR
    // ═══════════════════════════════════════════════════════════

    G.getStatusBarData = function () {
      var selRows = G.allSelectedRows();
      var selCols = G.allSelectedCols();
      var s = ensureState();
      if (!selRows.length && s.selR >= 0) selRows = [s.selR];
      if (!selCols.length && s.selC >= 0) selCols = [s.selC];
      var rows = ROWS_GET(), cols = COLS_GET();
      var count = 0, sum = 0, min = Infinity, max = -Infinity;
      selRows.forEach(function (r) {
        selCols.forEach(function (c) {
          if (!rows[r]) return;
          var v = parseFloat(ROW_VALUE(rows[r], cols[c]));
          if (!isNaN(v)) { count++; sum += v; if (v < min) min = v; if (v > max) max = v; }
        });
      });
      return {
        count: count, sum: sum, avg: count ? sum / count : 0,
        min: count ? min : null, max: count ? max : null
      };
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 14  COLUMN SELECTION (click header)
    // ═══════════════════════════════════════════════════════════

    G.onHeaderClick = function (e, colIdx) {
      if (e.shiftKey) {
        var s = ensureState();
        if (s.anchorC >= 0 && s.selC >= 0) {
          G.setSelection(0, colIdx, true);
          s.selR = ROW_COUNT() - 1;
          G.paintSelectionRect(s._lastRect, G.rectOf(s.anchorR, s.selR, s.anchorC, s.selC));
        }
      } else {
        G.selectColumn(colIdx);
      }
      REFOCUS();
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 15  MULTI-SORT
    // ═══════════════════════════════════════════════════════════

    G.sortByClick = function (colIdx, sortState, sortFn, renderFn) {
      var st = sortState || { sortCol: -1, sortDir: 0, sortStack: [] };

      if (!window.event || !window.event.shiftKey) {
        // Single sort — reset stack
        st.sortStack = [];
        if (st.sortCol === colIdx) { st.sortDir *= -1; }
        else { st.sortCol = colIdx; st.sortDir = 1; }
        st.sortStack.push({ col: colIdx, dir: st.sortDir });
      } else {
        // Multi-sort — toggle or add
        var existing = -1;
        for (var i = 0; i < st.sortStack.length; i++) {
          if (st.sortStack[i].col === colIdx) { existing = i; break; }
        }
        if (existing >= 0) {
          st.sortStack[existing].dir *= -1;
          if (st.sortStack[existing].dir === 0) st.sortStack.splice(existing, 1);
        } else {
          st.sortStack.push({ col: colIdx, dir: 1 });
        }
        if (st.sortStack.length) {
          st.sortCol = st.sortStack[st.sortStack.length - 1].col;
          st.sortDir = st.sortStack[st.sortStack.length - 1].dir;
        }
      }
      if (sortFn) sortFn(st.sortStack);
      if (renderFn) renderFn();
    };

    G.getSortStack = function (sortState) {
      return (sortState || {}).sortStack || [];
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 16  LOADING / EMPTY / ERROR STATES
    // ═══════════════════════════════════════════════════════════

    G.setState = function (st) {
      var s = ensureState();
      var prev = s._uiState;
      s._uiState = st;
      if (cfg.onStateChange) cfg.onStateChange(st, prev);
    };

    G.getState = function () { return ensureState()._uiState || 'ready'; };

    // ═══════════════════════════════════════════════════════════
    //  SEC 17  CONTEXT MENU
    // ═══════════════════════════════════════════════════════════

    G.closeCtx = function () {
      var s = ensureState();
      if (s.ctxWrap) { s.ctxWrap.remove(); s.ctxWrap = null; }
      doc.removeEventListener('mousedown', G._onDocCtx, true);
      doc.removeEventListener('keydown', G._onCtxKey, true);
    };

    G._onDocCtx = function (e) {
      var s = ensureState();
      if (s.ctxWrap && !(e.target && e.target.closest && e.target.closest('.rt-ctx'))) G.closeCtx();
    };

    G._onCtxKey = function (e) {
      if (e.key === 'Escape') G.closeCtx();
    };

    G.openCtx = function (x, y, items) {
      G.closeCtx();
      var s = ensureState();
      var wrap = doc.createElement('div');
      wrap.className = 'rt-ctx';
      var html = '';
      items.forEach(function (it) {
        if (it.sep) { html += '<div class="rt-ctx-sep"></div>'; return; }
        html += '<button type="button" data-act="' + esc(it.act) + '" class="' + (it.cls || '') + '">' + esc(it.label) + '</button>';
      });
      wrap.innerHTML = html;
      wrap.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
        if (b) { var act = b.getAttribute('data-act'); G.closeCtx(); if (cfg.onCtxAction) cfg.onCtxAction(act); }
      });
      doc.body.appendChild(wrap);
      s.ctxWrap = wrap;
      wrap.style.position = 'fixed';
      var vw = window.innerWidth, vh = window.innerHeight;
      var w = Math.min(vw - 16, 240);
      var maxH = Math.min(vh - 16, 400);
      wrap.style.left = Math.max(4, Math.min(x, vw - w - 4)) + 'px';
      wrap.style.top = Math.max(4, Math.min(y, vh - maxH - 4)) + 'px';
      wrap.style.maxWidth = w + 'px';
      wrap.style.maxHeight = maxH + 'px';
      wrap.style.zIndex = '1000';
      doc.addEventListener('mousedown', G._onDocCtx, true);
      doc.addEventListener('keydown', G._onCtxKey, true);
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 18  FILTER POPUP
    // ═══════════════════════════════════════════════════════════

    G.closeFilter = function () {
      var s = ensureState();
      if (s.filterWrap) { s.filterWrap.remove(); s.filterWrap = null; }
      doc.removeEventListener('mousedown', G._onDocFilter, true);
      doc.removeEventListener('keydown', G._onFilterKey, true);
    };

    G._onDocFilter = function (e) {
      var s = ensureState();
      if (s.filterWrap && !(e.target && e.target.closest && e.target.closest('.rt-filter'))) G.closeFilter();
    };

    G._onFilterKey = function (e) {
      if (e.key === 'Escape') G.closeFilter();
    };

    G.openFilter = function (colIdx, anchorEl, colLabel, distinctValuesFn) {
      G.closeFilter();
      var s = ensureState();
      s.filterCol = colIdx;
      var values = distinctValuesFn(colIdx);
      var wrap = doc.createElement('div');
      wrap.className = 'rt-filter';
      var html = '<div class="rt-filt-head"><b>' + esc(colLabel) + '</b><button type="button" data-act="close">&times;</button></div>';
      html += '<div class="rt-filt-search"><input type="text" placeholder="Search…" data-act="search"></div>';
      html += '<div class="rt-filt-list">';
      values.forEach(function (v) {
        var label = v.v || '(empty)';
        html += '<label class="rt-filt-item"><input type="checkbox" data-v="' + esc(v.v) + '" checked><span>' + esc(label) + '</span></label>';
      });
      html += '</div>';
      html += '<div class="rt-filt-actions">';
      html += '<button type="button" data-act="all">Select all</button>';
      html += '<button type="button" data-act="clear">Clear filter</button>';
      html += '<button type="button" data-act="sortasc">Sort A→Z</button>';
      html += '<button type="button" data-act="sortdesc">Sort Z→A</button>';
      html += '</div>';
      wrap.innerHTML = html;
      doc.body.appendChild(wrap);
      s.filterWrap = wrap;
      var r = anchorEl.getBoundingClientRect();
      wrap.style.position = 'fixed';
      wrap.style.top = (r.bottom + 4) + 'px';
      wrap.style.left = Math.min(r.left, window.innerWidth - 280) + 'px';
      wrap.style.maxWidth = '260px';
      wrap.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - 24) + 'px';
      wrap.style.zIndex = '950';

      var si = wrap.querySelector('[data-act="search"]');
      if (si) {
        si.addEventListener('input', function () {
          var q = String(si.value).toLowerCase();
          wrap.querySelectorAll('.rt-filt-item').forEach(function (it) {
            it.style.display = q ? (String(it.querySelector('span').textContent || '').toLowerCase().indexOf(q) >= 0 ? '' : 'none') : '';
          });
        });
      }
      wrap.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
        if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'close') G.closeFilter();
        else if (cfg.onFilterAction) cfg.onFilterAction(act, wrap, colIdx);
      });
      wrap.addEventListener('change', function (e) {
        var t = e.target;
        if (t && t.tagName === 'INPUT' && t.type === 'checkbox' && t.getAttribute('data-v') !== null) {
          if (cfg.onFilterToggle) cfg.onFilterToggle(colIdx, t.getAttribute('data-v'), t.checked);
        }
      });
      doc.addEventListener('mousedown', G._onDocFilter, true);
      doc.addEventListener('keydown', G._onFilterKey, true);
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 19  SORT (compat + enhanced)
    // ═══════════════════════════════════════════════════════════

    G.sortToggle = function (colIdx, sortState, sortFn, renderFn) {
      return G.sortByClick(colIdx, sortState, sortFn, renderFn);
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 20  DEFAULT HANDLERS
    // ═══════════════════════════════════════════════════════════

    G.onContextMenu = function (e, rowIdx, colIdx) {
      e.preventDefault();
      e.stopPropagation();
      var s = ensureState();
      var inside = s.selR >= 0 && s.anchorR >= 0 &&
        rowIdx >= Math.min(s.anchorR, s.selR) &&
        rowIdx <= Math.max(s.anchorR, s.selR);
      if (!inside && !(s.extraRows && s.extraRows[rowIdx])) {
        if (SELECT_ROW) SELECT_ROW(rowIdx);
      }

      var items = [];
      if (!cfg.disableEdit) {
        items.push({ act: 'above', label: 'Insert row above' });
        items.push({ act: 'below', label: 'Insert row below' });
        items.push({ act: 'del', label: 'Delete row' });
      }
      items.push({ sep: true });
      items.push({ act: 'copy', label: 'Copy\tCtrl+C' });
      if (!cfg.disableEdit) {
        items.push({ act: 'cut', label: 'Cut\tCtrl+X' });
        items.push({ act: 'paste', label: 'Paste\tCtrl+V' });
      }
      items.push({ sep: true });
      items.push({ act: 'clear', label: 'Clear contents\tDel' });

      G.openCtx(e.clientX, e.clientY, items);
    };

    // ═══════════════════════════════════════════════════════════
    //  SEC 21  DEBUG
    // ═══════════════════════════════════════════════════════════

    G.debug = false;
    G._log = function (msg) {
      if (!G.debug) return;
      var t = new Date().toISOString().slice(11, 23);
      console.log('[GRID ' + t + '] ' + msg);
    };

    // ── Teardown ────────────────────────────

    G.destroy = function () {
      G.closeCtx();
      G.closeFilter();
      G.closeFind();
      G.cancelEdit();
      _undoStack = []; _redoStack = [];
      if (cfg.onDestroy) cfg.onDestroy();
    };

    // ── Expose state for mount ──

    G._getSt = ensureState;
    G._getMode = function () { return MODE; };
    G._setMode = function (m) { MODE = m; };

    // ═══════════════════════════════════════════════════════════
    //  SEC 22  GRID.mount — ZERO-CONFIG DROP-IN API
    // ═══════════════════════════════════════════════════════════

    return G;
  };

  // ───────────────────────────────────────────────────────
  //  GRID.mount(selector | element, opts)  — API Zero-Config
  // ───────────────────────────────────────────────────────

  window.GRID.mount = function (target, opts) {
    opts = opts || {};
    var _data = opts.data || [];
    var _cols = opts.columns || [];
    var _colWidths = _cols.map(function (c) { return c.width || 120; });
    var _hiddenCols = {};
    var _sortState = { sortCol: -1, sortDir: 0, sortStack: [] };
    var _filters = {}; // { colIdx: { allowed: Set } }
    var _readonly = opts.readonly === true;

    // ── Container ──

    var container = typeof target === 'string' ? doc.querySelector(target) : target;
    if (!container) throw new Error('GRID.mount: target not found');
    container.classList.add('rt-grid');
    if (opts.theme) container.classList.add('rt-theme-' + opts.theme);

    if (opts.height) container.style.height = typeof opts.height === 'number' ? opts.height + 'px' : opts.height;
    else container.style.height = '100%';

    // ── Find bar ──

    var findBar = doc.createElement('div');
    findBar.className = 'rt-find-bar';
    findBar.innerHTML = '<input type="text" class="rt-find-input" placeholder="Find…">' +
      '<span class="rt-find-count"></span>' +
      '<button class="rt-find-prev" title="Previous">&uarr;</button>' +
      '<button class="rt-find-next" title="Next">&darr;</button>' +
      '<input type="text" class="rt-find-replace" placeholder="Replace…">' +
      '<button class="rt-find-replace-btn">Replace</button>' +
      '<button class="rt-find-replace-all">All</button>' +
      '<button class="rt-find-close">&times;</button>';
    findBar.style.display = 'none';

    // ── Scroll wrapper ──

    var scrollWrap = doc.createElement('div');
    scrollWrap.className = 'rt-scroll';

    var table = doc.createElement('table');
    var thead = doc.createElement('thead');
    var tbody = doc.createElement('tbody');

    // ── Row height ──

    var ROW_H = 28;

    // ── Build header ──

    function buildHeader() {
      thead.innerHTML = '';
      var tr = doc.createElement('tr');
      var thNum = doc.createElement('th');
      thNum.className = 'rt-row-num';
      thNum.style.width = '50px';
      tr.appendChild(thNum);

      _cols.forEach(function (col, i) {
        if (_hiddenCols[i]) return;
        var th = doc.createElement('th');
        th.textContent = col.label || col.key;
        th.style.width = _colWidths[i] + 'px';
        th.dataset.col = i;
        th.className = 'rt-col-header';

        // Sort indicator
        if (_sortState.sortCol === i) {
          var dir = _sortState.sortDir;
          th.classList.add(dir > 0 ? 'rt-sort-asc' : 'rt-sort-desc');
        }
        // Multi-sort number
        var stackIdx = -1;
        for (var si = 0; si < _sortState.sortStack.length; si++) {
          if (_sortState.sortStack[si].col === i) { stackIdx = si + 1; break; }
        }
        if (stackIdx > 0) {
          var num = doc.createElement('span');
          num.className = 'rt-sort-num'; num.textContent = stackIdx; th.appendChild(num);
        }
        tr.appendChild(th);
      });
      thead.appendChild(tr);
    }

    // ── Render rows ──

    function getFilteredData() {
      if (!objKeys(_filters).length) return _data;
      return _data.filter(function (row) {
        for (var ci in _filters) {
          if (!Object.prototype.hasOwnProperty.call(_filters, ci)) continue;
          var cIdx = parseInt(ci, 10);
          var val = (row[_cols[cIdx].k] == null) ? '' : String(row[_cols[cIdx].k]);
          if (!_filters[ci].allowed.has(val)) return false;
        }
        return true;
      });
    }

    function getSortedData(filtered) {
      var arr = filtered.slice();
      if (!_sortState.sortStack.length) return arr;
      arr.sort(function (a, b) {
        for (var s = 0; s < _sortState.sortStack.length; s++) {
          var sc = _sortState.sortStack[s];
          var va = (a[_cols[sc.col].k] == null) ? '' : String(a[_cols[sc.col].k]);
          var vb = (b[_cols[sc.col].k] == null) ? '' : String(b[_cols[sc.col].k]);
          var na = parseFloat(va), nb = parseFloat(vb);
          var cmp;
          if (!isNaN(na) && !isNaN(nb)) cmp = na - nb;
          else cmp = va.localeCompare(vb);
          if (cmp !== 0) return cmp * sc.dir;
        }
        return 0;
      });
      return arr;
    }

    function renderVisible() {
      var filtered = getSortedData(getFilteredData());
      var count = filtered.length;
      var st = scrollWrap.scrollTop;
      var h = scrollWrap.clientHeight;
      var start = Math.floor(st / ROW_H);
      var visible = Math.ceil(h / ROW_H) + 2;
      start = Math.max(0, start - 2);
      var end = Math.min(count, start + visible);
      if (start >= count) start = Math.max(0, count - visible);

      // Spacer
      var html = '<tr style="height:' + (start * ROW_H) + 'px"></tr>';

      for (var r = start; r < end; r++) {
        var row = filtered[r];
        html += '<tr data-r="' + r + '">';
        html += '<td class="rt-row-num">' + (r + 1) + '</td>';
        _cols.forEach(function (col, c) {
          if (_hiddenCols[c]) return;
          var val = (row[col.k] == null) ? '' : String(row[col.k]);
          var cls = 'rt-cell';
          if (col.type === 'number') cls += ' rt-num';
          html += '<td class="' + cls + '" data-r="' + r + '" data-c="' + c + '" style="width:' + _colWidths[c] + 'px">' + esc(val) + '</td>';
        });
        html += '</tr>';
      }

      // Bottom spacer
      var tail = count - end;
      if (tail > 0) html += '<tr style="height:' + (tail * ROW_H) + 'px"></tr>';

      tbody.innerHTML = html;
      _renderCache = { filtered: filtered, start: start, end: end };
    }

    var _renderCache = { filtered: [], start: 0, end: 0 };

    // ── GRID instance ──

    var grid = window.GRID.create({
      getRows: function () { return _renderCache.filtered; },
      getCols: function () { return _cols; },
      colVisible: function (c) { return !_hiddenCols[c]; },
      rowCount: function () { return _renderCache.filtered.length; },
      isRowHidden: function (i) { return false; },
      isLocked: function () { return _readonly; },
      disableEdit: _readonly,
      disableToast: false,

      findCell: function (r, c) {
        return tbody.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
      },
      findRowNum: function (r) {
        var row = tbody.querySelector('tr[data-r="' + r + '"]');
        return row ? row.querySelector('.rt-row-num') : null;
      },
      renderedRange: function () {
        return { start: _renderCache.start, end: _renderCache.end };
      },
      rowValue: function (row, col) {
        var v = row[col.k];
        return (v === undefined || v === null) ? '' : String(v);
      },
      getColWidth: function (c) { return _colWidths[c] || 120; },

      scrollTo: function (r) {
        var target = r * ROW_H;
        var st = scrollWrap.scrollTop, h = scrollWrap.clientHeight;
        if (target < st + ROW_H || target > st + h - ROW_H * 2) {
          scrollWrap.scrollTop = Math.max(0, target - h / 2);
          renderVisible();
          grid.syncSelection();
        }
      },
      refocus: function () { container.focus(); },
      selectRow: function (r) {
        var s = grid._getSt();
        s.anchorR = r; s.anchorC = 0; s.selR = r; s.selC = 0;
        grid.scrollTo(r);
      },

      onRender: function () { renderVisible(); grid.syncSelection(); },
      onCellChange: function () {},
      onDataChange: function (changes) {
        changes.forEach(function (ch) {
          var row = _data[ch.r];
          if (row) row[_cols[ch.c].k] = ch.new;
        });
        if (opts.onDataChange) opts.onDataChange(changes);
      },
      onCtxAction: function (act) {
        // Header context menu actions
        if (_hdrCtxCol >= 0) {
          var hc = _hdrCtxCol;
          _hdrCtxCol = -1;
          switch (act) {
            case 'sortasc': grid.sortByClick(hc, _sortState, null, function () { renderVisible(); grid.syncSelection(); buildHeader(); }); buildHeader(); return;
            case 'sortdesc': _sortState.sortStack = [{ col: hc, dir: -1 }]; _sortState.sortCol = hc; _sortState.sortDir = -1; renderVisible(); grid.syncSelection(); buildHeader(); return;
            case 'autofit': grid.autoFitColumn(hc); buildHeader(); renderVisible(); grid.syncSelection(); return;
            case 'hide': _hiddenCols[hc] = true; buildHeader(); renderVisible(); grid.syncSelection(); return;
          }
        }
        var s = grid._getSt();
        switch (act) {
          case 'copy': grid.copy(); break;
          case 'cut': grid.cut(); break;
          case 'paste': grid.paste(); break;
          case 'clear': grid.clearSelection(); break;
          case 'above': case 'below': case 'del':
            if (opts.onCtxAction) opts.onCtxAction(act, s.selR);
            break;
        }
      },
      onColResize: function (c, w) {
        _colWidths[c] = w;
        buildHeader();
        renderVisible();
        grid.syncSelection();
      },
      onColReorder: function (from, endX) {
        // Find target column based on x position
        var ths = thead.querySelectorAll('th.rt-col-header');
        var target = from;
        var minDist = Infinity;
        ths.forEach(function (th) {
          var r = th.getBoundingClientRect();
          var mid = r.left + r.width / 2;
          var d = Math.abs(endX - mid);
          if (d < minDist) { minDist = d; target = parseInt(th.dataset.col, 10); }
        });
        if (target !== from) {
          var moved = _cols.splice(from, 1)[0];
          var wMoved = _colWidths.splice(from, 1)[0];
          _cols.splice(target, 0, moved);
          _colWidths.splice(target, 0, wMoved);
          buildHeader();
          renderVisible();
          grid.syncSelection();
        }
      },
      onFilterAction: function (act, wrap, colIdx) {
        var cbs = wrap.querySelectorAll('.rt-filt-item input[type="checkbox"]');
        switch (act) {
          case 'all': cbs.forEach(function (cb) { cb.checked = true; }); break;
          case 'clear': cbs.forEach(function (cb) { cb.checked = false; }); break;
          case 'sortasc': grid.sortByClick(colIdx, _sortState, null, function () { renderVisible(); grid.syncSelection(); }); break;
          case 'sortdesc':
            _sortState.sortStack = [{ col: colIdx, dir: -1 }];
            _sortState.sortCol = colIdx; _sortState.sortDir = -1;
            renderVisible(); grid.syncSelection();
            break;
        }
        var allowed = new Set();
        cbs.forEach(function (cb) { if (cb.checked) allowed.add(cb.getAttribute('data-v')); });
        if (allowed.size < cbs.length) _filters[colIdx] = { allowed: allowed };
        else delete _filters[colIdx];
        renderVisible();
        grid.syncSelection();
      },
      onFilterToggle: function (colIdx, val, checked) {
        if (!_filters[colIdx]) _filters[colIdx] = { allowed: new Set() };
        if (checked) _filters[colIdx].allowed.add(val);
        else _filters[colIdx].allowed.delete(val);
        renderVisible();
        grid.syncSelection();
      },

      onFindOpen: function () { findBar.style.display = 'flex'; findBar.querySelector('.rt-find-input').focus(); },
      onFindClose: function () { findBar.style.display = 'none'; },
      onStateChange: function (st) {
        var overlay = container.querySelector('.rt-overlay');
        if (!overlay) {
          overlay = doc.createElement('div');
          overlay.className = 'rt-overlay';
          container.appendChild(overlay);
        }
        if (st === 'ready') { overlay.style.display = 'none'; }
        else { overlay.style.display = 'flex'; overlay.textContent = st === 'loading' ? 'Loading…' : st === 'empty' ? 'No data' : 'Error loading data'; }
      },
    });

    // ── Wire events ──

    buildHeader();
    table.appendChild(thead);
    table.appendChild(tbody);
    scrollWrap.appendChild(table);

    // Scroll handler
    scrollWrap.addEventListener('scroll', function () {
      renderVisible();
      grid.syncSelection();
    });

    // Keyboard
    container.tabIndex = 0;
    container.addEventListener('keydown', function (e) {
      grid.handleKeyDown(e);
    });

    // Mouse: click on cell
    tbody.addEventListener('click', function (e) {
      var td = e.target.closest ? e.target.closest('td[data-r]') : null;
      if (!td) return;
      var r = parseInt(td.dataset.r, 10), c = parseInt(td.dataset.c, 10);
      grid.setSelection(r, c, e.shiftKey);
    });

    // Mouse: double-click to edit
    tbody.addEventListener('dblclick', function (e) {
      var td = e.target.closest ? e.target.closest('td[data-r]') : null;
      if (!td) return;
      if (_readonly) return;
      var r = parseInt(td.dataset.r, 10), c = parseInt(td.dataset.c, 10);
      grid.setSelection(r, c, false);
      grid.startEdit();
    });

    // Mouse: context menu
    tbody.addEventListener('contextmenu', function (e) {
      var td = e.target.closest ? e.target.closest('td[data-r]') : null;
      if (!td) return;
      var r = parseInt(td.dataset.r, 10), c = parseInt(td.dataset.c, 10);
      grid.onContextMenu(e, r, c);
    });

    // Header click: sort + column select
    thead.addEventListener('click', function (e) {
      var th = e.target.closest ? e.target.closest('th.rt-col-header') : null;
      if (!th) return;
      var c = parseInt(th.dataset.col, 10);
      if (e.shiftKey && e.ctrlKey) return; // resize drag
      grid.sortByClick(c, _sortState, null, function () { renderVisible(); grid.syncSelection(); buildHeader(); });
      grid.onHeaderClick(e, c);
      buildHeader();
    });

    // Header context menu
    var _hdrCtxCol = -1;
    thead.addEventListener('contextmenu', function (e) {
      var th = e.target.closest ? e.target.closest('th.rt-col-header') : null;
      if (!th) return;
      e.preventDefault();
      _hdrCtxCol = parseInt(th.dataset.col, 10);
      var items = [
        { act: 'sortasc', label: 'Sort A-Z' },
        { act: 'sortdesc', label: 'Sort Z-A' },
        { act: 'autofit', label: 'Auto-fit column' },
        { sep: true },
        { act: 'hide', label: 'Hide column' },
      ];
      grid.openCtx(e.clientX, e.clientY, items);
    });

    // Column resize: mousedown on right border of header cell
    thead.addEventListener('mousedown', function (e) {
      var th = e.target.closest ? e.target.closest('th.rt-col-header') : null;
      if (!th) return;
      var rect = th.getBoundingClientRect();
      if (e.clientX > rect.right - 6) {
        e.preventDefault();
        var c = parseInt(th.dataset.col, 10);
        grid.startResize(c, e.clientX);
      } else if (e.clientX > rect.left + 4 && e.clientX < rect.right - 6) {
        // Start column drag for reorder (on header click hold)
      }
    });

    // Global mouse handlers for drag operations
    doc.addEventListener('mousemove', function (e) {
      var st = grid._getSt();
      if (st._rsLine) grid.onResizeMove(e.clientX);
      if (st._drLine) grid.onColDragMove(e.clientX);
      if (st._fillRect && grid._getMode() === 'drag-fill') grid.onAutoFillMove(e.clientX, e.clientY);

      // Cursor hint for resize
      var ths = thead.querySelectorAll('th.rt-col-header');
      var overBorder = false;
      ths.forEach(function (th) {
        var r = th.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom && e.clientX > r.right - 6 && e.clientX < r.right + 6) {
          overBorder = true;
        }
      });
      if (!st._rsLine && !st._drLine) {
        scrollWrap.style.cursor = overBorder ? 'col-resize' : '';
      }
    });

    doc.addEventListener('mouseup', function () {
      var mode = grid._getMode();
      if (mode === 'drag-resize') grid.endResize();
      if (mode === 'drag-reorder') grid.endColDrag();
      if (mode === 'drag-fill') grid.endAutoFill();
    });

    // Find bar
    findBar.querySelector('.rt-find-input').addEventListener('input', function () {
      var res = grid.doFind(this.value);
      findBar.querySelector('.rt-find-count').textContent = res.count ? '0/' + res.count : '0';
    });
    findBar.querySelector('.rt-find-next').addEventListener('click', function () {
      var m = grid.findNext();
      var st = grid._getSt();
      if (m) findBar.querySelector('.rt-find-count').textContent = (st._findIdx + 1) + '/' + (st._findMatches || []).length;
    });
    findBar.querySelector('.rt-find-prev').addEventListener('click', function () {
      var m = grid.findPrev();
      var st = grid._getSt();
      if (m) findBar.querySelector('.rt-find-count').textContent = (st._findIdx + 1) + '/' + (st._findMatches || []).length;
    });
    findBar.querySelector('.rt-find-close').addEventListener('click', function () { grid.closeFind(); });
    findBar.querySelector('.rt-find-replace-btn').addEventListener('click', function () {
      grid.replaceCurrent(findBar.querySelector('.rt-find-replace').value);
      grid.findNext();
      renderVisible();
      grid.syncSelection();
    });
    findBar.querySelector('.rt-find-replace-all').addEventListener('click', function () {
      grid.replaceAll(findBar.querySelector('.rt-find-input').value, findBar.querySelector('.rt-find-replace').value);
      renderVisible();
      grid.syncSelection();
    });

    // Status bar
    if (opts.statusBar !== false) {
      var statusBar = doc.createElement('div');
      statusBar.className = 'rt-status';
      container.appendChild(statusBar);
      var updateStatus = function () {
        var d = grid.getStatusBarData();
        statusBar.textContent = 'Count: ' + d.count + ' | Sum: ' + (d.sum ? d.sum.toFixed(2) : '—') + ' | Avg: ' + (d.avg ? d.avg.toFixed(2) : '—');
      };
      tbody.addEventListener('mouseup', updateStatus);
      container.addEventListener('keyup', updateStatus);
    }

    // Assemble DOM
    container.appendChild(findBar);
    container.appendChild(scrollWrap);

    // Initial render
    renderVisible();
    grid.setState('ready');

    // ── Public API on mount instance ──

    grid.setData = function (data) {
      _data = data || [];
      renderVisible();
      grid.syncSelection();
    };

    grid.getData = function () { return _data; };

    grid.setColumns = function (cols) {
      _cols = cols || [];
      _colWidths = _cols.map(function (c) { return c.width || 120; });
      _hiddenCols = {};
      buildHeader();
      renderVisible();
      grid.syncSelection();
    };

    grid.refresh = function () {
      buildHeader();
      renderVisible();
      grid.syncSelection();
    };

    grid.destroyMount = function () {
      grid.destroy();
      container.innerHTML = '';
      container.classList.remove('rt-grid');
    };

    return grid;
  };

  // ═══════════════════════════════════════════════════════════

  if (typeof global !== 'undefined') global.GRID = window.GRID;

})();
