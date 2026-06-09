/**
 * ============================================================
 * Siemens PCB / Schematic Net Comparator — app.js
 * Professional Engineering Review Tool
 *
 * Modules:
 *   1. SiemensParser      – Parses exported .txt files
 *   2. ComparisonEngine   – Diffs old vs new databases
 *   3. UIController       – Renders dashboard, tabs, tables
 *   4. ExportModule       – HTML / Excel / PDF export
 *   5. SampleData         – Built-in test data
 * ============================================================
 */

/* global XLSX */  // SheetJS (optional CDN)

// ============================================================
// 1. PARSER MODULE
// ============================================================
const SiemensParser = (() => {
  'use strict';

  /**
   * Main entry: parse an entire Siemens exported .txt file.
   * Returns { components, pinNets, nets, compPins }
   */
  function parse(text) {
    // Normalize line endings
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const compPropsRaw  = _extractSection(normalized, 'COMPPROPS');
    const compPinsRaw   = _extractSection(normalized, 'COMPPINS');
    const netsRaw       = _extractSection(normalized, 'NETS');
    const eNetsRaw      = _extractSection(normalized, 'E-NETS');

    const components = _parseCompProps(compPropsRaw);
    const compPins   = _parseCompPins(compPinsRaw);
    const { nets, pinNets } = _parseNets(netsRaw, eNetsRaw);

    return { components, compPins, pinNets, nets };
  }

  // --- Section Extraction ---
  function _extractSection(text, name) {
    const beginTag = `BEGIN_${name}`;
    const endTag   = `END_${name}`;
    const start = text.indexOf(beginTag);
    if (start === -1) return '';
    const end = text.indexOf(endTag, start);
    if (end === -1) return text.substring(start + beginTag.length);
    return text.substring(start + beginTag.length, end).trim();
  }

  // --- Component Properties Parser ---
  // Handles multiple common Siemens export formats:
  //   Format A (quoted):  "RefDes" "PropName" "PropValue"
  //   Format B (block):   RefDes\n  PropName = PropValue
  //   Format C (pipe):    RefDes|PropName|PropValue
  //   Format D (colon):   COMPPROPS lines with : separators
  function _parseCompProps(raw) {
    if (!raw) return new Map();
    const components = new Map();

    // Try quoted format first  "RefDes" "PropName" "PropValue"
    const quotedRe = /^"([^"]+)"\s+"([^"]+)"\s+"([^"]*)"$/;
    // Try pipe format  RefDes|PropName|PropValue
    const pipeRe = /^([^|]+)\|([^|]+)\|(.*)$/;
    // Try tab-separated format
    const tabRe = /^([^\t]+)\t([^\t]+)\t(.*)$/;

    const lines = raw.split('\n');
    let currentRef = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

      // --- Format A: quoted triplets ---
      let m = trimmed.match(quotedRe);
      if (m) {
        const [, refDes, propName, propValue] = m;
        if (!components.has(refDes)) {
          components.set(refDes, { refDes, properties: new Map() });
        }
        components.get(refDes).properties.set(propName, propValue);
        continue;
      }

      // --- Format C: pipe-separated ---
      m = trimmed.match(pipeRe);
      if (m) {
        const [, refDes, propName, propValue] = m;
        const ref = refDes.trim();
        const pn = propName.trim();
        const pv = propValue.trim();
        if (!components.has(ref)) {
          components.set(ref, { refDes: ref, properties: new Map() });
        }
        components.get(ref).properties.set(pn, pv);
        continue;
      }

      // --- Tab-separated ---
      m = trimmed.match(tabRe);
      if (m) {
        const [, refDes, propName, propValue] = m;
        const ref = refDes.trim();
        const pn = propName.trim();
        const pv = propValue.trim();
        if (!components.has(ref)) {
          components.set(ref, { refDes: ref, properties: new Map() });
        }
        components.get(ref).properties.set(pn, pv);
        continue;
      }

      // --- Format B: block style ---
      // A line with leading whitespace = property of current component
      if (/^\s+/.test(line) && currentRef) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const propName  = trimmed.substring(0, eqIdx).trim();
          const propValue = trimmed.substring(eqIdx + 1).trim().replace(/^"|"$/g, '');
          components.get(currentRef).properties.set(propName, propValue);
        }
        continue;
      }

      // Otherwise treat as a new RefDes header
      if (/^[A-Za-z]/.test(trimmed) && !trimmed.includes('=')) {
        currentRef = trimmed.replace(/^"|"$/g, '');
        if (!components.has(currentRef)) {
          components.set(currentRef, { refDes: currentRef, properties: new Map() });
        }
      } else if (/^[A-Za-z]/.test(trimmed) && trimmed.includes('=')) {
        // Single-line "RefDes = Value" or "RefDes PropName = PropValue"
        const eqIdx = trimmed.indexOf('=');
        const left  = trimmed.substring(0, eqIdx).trim();
        const right = trimmed.substring(eqIdx + 1).trim().replace(/^"|"$/g, '');
        const parts = left.split(/\s+/);
        if (parts.length >= 2) {
          const ref = parts[0];
          const propName = parts.slice(1).join(' ');
          if (!components.has(ref)) {
            components.set(ref, { refDes: ref, properties: new Map() });
          }
          components.get(ref).properties.set(propName, right);
        } else {
          // "RefDes = Value"
          if (!components.has(left)) {
            components.set(left, { refDes: left, properties: new Map() });
          }
          components.get(left).properties.set('Value', right);
        }
      }
    }

    return components;
  }

  // --- Component Pins Parser ---
  function _parseCompPins(raw) {
    if (!raw) return new Map();
    const compPins = new Map(); // refDes -> [pinNumbers]

    const quotedRe = /^"([^"]+)"\s+"([^"]+)"(?:\s+"([^"]*)")?$/;
    const lines = raw.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      let m = trimmed.match(quotedRe);
      if (m) {
        const refDes = m[1];
        const pin = m[2];
        if (!compPins.has(refDes)) compPins.set(refDes, []);
        compPins.get(refDes).push(pin);
        continue;
      }

      // Tab or pipe separated
      const parts = trimmed.split(/[\t|]/);
      if (parts.length >= 2) {
        const refDes = parts[0].trim().replace(/^"|"$/g, '');
        const pin = parts[1].trim().replace(/^"|"$/g, '');
        if (refDes && pin) {
          if (!compPins.has(refDes)) compPins.set(refDes, []);
          compPins.get(refDes).push(pin);
        }
      }
    }

    return compPins;
  }

  // --- Net Parser ---
  // Builds nets (netName -> [refDes.pin, ...]) and pinNets (refDes.pin -> netName)
  function _parseNets(netsRaw, eNetsRaw) {
    const nets = new Map();
    const pinNets = new Map();

    // Parse both NETS and E-NETS sections (same format)
    _parseNetSection(netsRaw, nets, pinNets);
    _parseNetSection(eNetsRaw, nets, pinNets);

    return { nets, pinNets };
  }

  function _parseNetSection(raw, nets, pinNets) {
    if (!raw) return;

    const lines = raw.split('\n');
    let currentNet = null;

    // Detect format: quoted vs non-quoted
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

      // --- Quoted net name: "NetName" on its own line ---
      if (/^"[^"]+"$/.test(trimmed) && !trimmed.includes('" "')) {
        currentNet = trimmed.replace(/^"|"$/g, '');
        if (!nets.has(currentNet)) nets.set(currentNet, []);
        continue;
      }

      // --- Quoted pin entry: "RefDes" "Pin" under a net ---
      const quotedPinRe = /^"([^"]+)"\s+"([^"]+)"$/;
      let m = trimmed.match(quotedPinRe);
      if (m && currentNet) {
        const pin = `${m[1]}.${m[2]}`;
        nets.get(currentNet).push(pin);
        pinNets.set(pin, currentNet);
        continue;
      }

      // --- Quoted triple: "NetName" "RefDes" "Pin" (flat format) ---
      const quotedTripleRe = /^"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"$/;
      m = trimmed.match(quotedTripleRe);
      if (m) {
        const netName = m[1];
        const pin = `${m[2]}.${m[3]}`;
        if (!nets.has(netName)) nets.set(netName, []);
        nets.get(netName).push(pin);
        pinNets.set(pin, netName);
        continue;
      }

      // --- Non-quoted block: net name as header, indented pins ---
      if (/^\s+/.test(line) && currentNet) {
        // Indented line = pin under current net
        // Could be "RefDes.Pin" or "RefDes Pin"
        const parts = trimmed.split(/[\s.]+/);
        if (parts.length >= 2) {
          const pin = `${parts[0]}.${parts[1]}`;
          nets.get(currentNet).push(pin);
          pinNets.set(pin, currentNet);
        } else if (trimmed.includes('.')) {
          nets.get(currentNet).push(trimmed);
          pinNets.set(trimmed, currentNet);
        }
        continue;
      }

      // --- Non-indented, non-quoted: could be a net name or tab/pipe row ---
      if (trimmed.includes('|') || trimmed.includes('\t')) {
        const parts = trimmed.split(/[|\t]+/).map(s => s.trim());
        if (parts.length >= 3) {
          const netName = parts[0];
          const pin = `${parts[1]}.${parts[2]}`;
          if (!nets.has(netName)) nets.set(netName, []);
          nets.get(netName).push(pin);
          pinNets.set(pin, netName);
        }
        continue;
      }

      // Non-indented text without separators = new net name
      if (/^[^\s]/.test(line)) {
        currentNet = trimmed.replace(/^"|"$/g, '');
        if (!nets.has(currentNet)) nets.set(currentNet, []);
      }
    }
  }

  return { parse };
})();


// ============================================================
// 2. COMPARISON ENGINE
// ============================================================
const ComparisonEngine = (() => {
  'use strict';

  /**
   * Compare two parsed databases (old, new).
   * Returns the full comparison result object.
   */
  function compare(oldData, newData) {
    const componentChanges    = _compareComponents(oldData.components, newData.components);
    const netRenames          = _detectNetRenames(oldData.nets, newData.nets);
    const netChanges          = _compareNets(oldData.nets, newData.nets, netRenames);
    const connectivityChanges = _compareConnectivity(oldData.pinNets, newData.pinNets, netRenames);

    return {
      componentChanges,
      connectivityChanges,
      netRenames,
      netChanges,
      oldData,
      newData
    };
  }

  // --- Component Comparison ---
  function _compareComponents(oldComps, newComps) {
    const results = [];

    // Deleted components (in old, not in new)
    for (const [refDes, oldComp] of oldComps) {
      if (!newComps.has(refDes)) {
        results.push({
          refDes,
          status: 'deleted',
          oldProps: _propsToObj(oldComp.properties),
          newProps: {},
          changedProps: []
        });
      }
    }

    // Added components (in new, not in old)
    for (const [refDes, newComp] of newComps) {
      if (!oldComps.has(refDes)) {
        results.push({
          refDes,
          status: 'added',
          oldProps: {},
          newProps: _propsToObj(newComp.properties),
          changedProps: []
        });
      }
    }

    // Modified components (in both, any property changed)
    for (const [refDes, oldComp] of oldComps) {
      if (!newComps.has(refDes)) continue;
      const newComp = newComps.get(refDes);
      const changedProps = [];

      // Collect all property keys
      const allKeys = new Set([...oldComp.properties.keys(), ...newComp.properties.keys()]);
      for (const key of allKeys) {
        const oldVal = oldComp.properties.get(key) || '';
        const newVal = newComp.properties.get(key) || '';
        if (oldVal !== newVal) {
          changedProps.push({ property: key, oldValue: oldVal, newValue: newVal });
        }
      }

      if (changedProps.length > 0) {
        results.push({
          refDes,
          status: 'modified',
          oldProps: _propsToObj(oldComp.properties),
          newProps: _propsToObj(newComp.properties),
          changedProps
        });
      }
    }

    // Sort: deleted first, then added, then modified; alpha within each group
    const order = { deleted: 0, added: 1, modified: 2 };
    results.sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.refDes.localeCompare(b.refDes, undefined, { numeric: true });
    });

    return results;
  }

  // --- Net Rename Detection ---
  // Two nets are considered a rename when:
  //   - oldNet exists only in oldData
  //   - newNet exists only in newData
  //   - They share the EXACT same set of connected pins (sorted)
  function _detectNetRenames(oldNets, newNets) {
    const renames = []; // { oldName, newName }
    const renameMapOldToNew = new Map();
    const renameMapNewToOld = new Map();

    // Find nets unique to each side
    const oldOnly = new Map();
    for (const [name, pins] of oldNets) {
      if (!newNets.has(name)) oldOnly.set(name, pins);
    }
    const newOnly = new Map();
    for (const [name, pins] of newNets) {
      if (!oldNets.has(name)) newOnly.set(name, pins);
    }

    // Build fingerprint map for old-only nets
    const oldFingerprints = new Map(); // fingerprint -> netName
    for (const [name, pins] of oldOnly) {
      const fp = [...pins].sort().join(',');
      if (fp) oldFingerprints.set(fp, name);
    }

    // Match new-only nets to old-only via fingerprint
    for (const [name, pins] of newOnly) {
      const fp = [...pins].sort().join(',');
      if (fp && oldFingerprints.has(fp)) {
        const oldName = oldFingerprints.get(fp);
        // Ensure 1:1 matching
        if (!renameMapOldToNew.has(oldName) && !renameMapNewToOld.has(name)) {
          renames.push({ oldName, newName: name });
          renameMapOldToNew.set(oldName, name);
          renameMapNewToOld.set(name, oldName);
          oldFingerprints.delete(fp); // consume the match
        }
      }
    }

    renames.sort((a, b) => a.oldName.localeCompare(b.oldName));
    return renames;
  }

  // --- Net-Level Comparison (Added / Deleted nets, excluding renames) ---
  function _compareNets(oldNets, newNets, netRenames) {
    const renamedOld = new Set(netRenames.map(r => r.oldName));
    const renamedNew = new Set(netRenames.map(r => r.newName));

    const added = [];
    const deleted = [];

    for (const name of oldNets.keys()) {
      if (!newNets.has(name) && !renamedOld.has(name)) {
        deleted.push(name);
      }
    }
    for (const name of newNets.keys()) {
      if (!oldNets.has(name) && !renamedNew.has(name)) {
        added.push(name);
      }
    }

    added.sort((a, b) => a.localeCompare(b));
    deleted.sort((a, b) => a.localeCompare(b));

    return { added, deleted };
  }

  // --- Pin Connectivity Comparison ---
  function _compareConnectivity(oldPinNets, newPinNets, netRenames) {
    const results = [];

    // Build rename lookup: old net name -> new net name
    const renameOldToNew = new Map();
    for (const r of netRenames) renameOldToNew.set(r.oldName, r.newName);

    // All unique pins across both
    const allPins = new Set([...oldPinNets.keys(), ...newPinNets.keys()]);

    for (const pin of allPins) {
      const oldNet = oldPinNets.get(pin) || null;
      const newNet = newPinNets.get(pin) || null;

      // Skip if identical
      if (oldNet === newNet) continue;

      // Check if the difference is only due to a rename
      if (oldNet && newNet && renameOldToNew.get(oldNet) === newNet) continue;

      // Parse refDes.pinNumber
      const dotIdx = pin.lastIndexOf('.');
      const refDes = dotIdx > 0 ? pin.substring(0, dotIdx) : pin;
      const pinNum = dotIdx > 0 ? pin.substring(dotIdx + 1) : '';

      let status;
      if (!oldNet && newNet) {
        status = 'Added Connection';
      } else if (oldNet && !newNet) {
        status = 'Removed Connection';
      } else {
        status = 'Net Changed';
      }

      results.push({
        refDes,
        pin: pinNum,
        oldNet: oldNet || '—',
        newNet: newNet || '—',
        status
      });
    }

    // Sort by refDes (natural), then pin (numeric)
    results.sort((a, b) => {
      const cmp = a.refDes.localeCompare(b.refDes, undefined, { numeric: true });
      if (cmp !== 0) return cmp;
      return String(a.pin).localeCompare(String(b.pin), undefined, { numeric: true });
    });

    return results;
  }

  // Helper: Map -> plain object
  function _propsToObj(map) {
    const obj = {};
    for (const [k, v] of map) obj[k] = v;
    return obj;
  }

  return { compare };
})();


// ============================================================
// 3. UI CONTROLLER
// ============================================================
const UIController = (() => {
  'use strict';

  let comparisonResult = null;
  const PAGE_SIZE = 50;

  // Pagination states
  const paginationState = {
    components: { page: 1, filtered: [] },
    connectivity: { page: 1, filtered: [] },
    renames: { page: 1, filtered: [] }
  };

  // Sort state
  const sortState = {
    components: { col: null, dir: 'asc' },
    connectivity: { col: null, dir: 'asc' }
  };

  function init() {
    _bindFileInputs();
    _bindButtons();
    _bindTabs();
    _bindModalClose();
  }

  // --- File Input Handling ---
  function _bindFileInputs() {
    const oldInput = document.getElementById('oldFileInput');
    const newInput = document.getElementById('newFileInput');
    const oldZone  = document.getElementById('oldDropZone');
    const newZone  = document.getElementById('newDropZone');

    oldInput.addEventListener('change', (e) => _handleFile(e, 'old'));
    newInput.addEventListener('change', (e) => _handleFile(e, 'new'));

    [oldZone, newZone].forEach(zone => {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const input = zone.querySelector('input[type="file"]');
        if (e.dataTransfer.files.length) {
          input.files = e.dataTransfer.files;
          input.dispatchEvent(new Event('change'));
        }
      });
    });
  }

  const fileContents = { old: null, new: null };

  function _handleFile(event, which) {
    const file = event.target.files[0];
    if (!file) return;

    const zone = document.getElementById(which === 'old' ? 'oldDropZone' : 'newDropZone');
    const nameEl = zone.querySelector('.upload-zone__filename');

    const reader = new FileReader();
    reader.onload = (e) => {
      fileContents[which] = e.target.result;
      zone.classList.add('loaded');
      nameEl.textContent = `✓ ${file.name} (${_formatBytes(file.size)})`;
      _showToast(`${which === 'old' ? 'OLD' : 'NEW'} file loaded: ${file.name}`, 'success');
    };
    reader.onerror = () => _showToast('Error reading file', 'error');
    reader.readAsText(file);
  }

  // --- Button Bindings ---
  function _bindButtons() {
    document.getElementById('compareBtn').addEventListener('click', _runComparison);
    document.getElementById('loadSampleBtn').addEventListener('click', _loadSampleData);
    document.getElementById('exportHtmlBtn').addEventListener('click', () => ExportModule.exportHTML(comparisonResult));
    document.getElementById('exportExcelBtn').addEventListener('click', () => ExportModule.exportExcel(comparisonResult));
    document.getElementById('exportPdfBtn').addEventListener('click', () => ExportModule.exportPDF());
  }

  // --- Run Comparison ---
  function _runComparison() {
    if (!fileContents.old || !fileContents.new) {
      _showToast('Please load both OLD and NEW files before comparing.', 'error');
      return;
    }

    const btn = document.getElementById('compareBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Comparing…';

    // Use requestAnimationFrame to let UI update
    requestAnimationFrame(() => {
      try {
        const oldData = SiemensParser.parse(fileContents.old);
        const newData = SiemensParser.parse(fileContents.new);
        comparisonResult = ComparisonEngine.compare(oldData, newData);

        _renderDashboard(comparisonResult);
        _renderAllTabs(comparisonResult);

        document.querySelector('.dashboard').classList.add('visible');
        document.querySelector('.tabs-container').classList.add('visible');

        _showToast('Comparison complete!', 'success');
      } catch (err) {
        console.error(err);
        _showToast(`Comparison failed: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">⚡</span> Compare';
      }
    });
  }

  // --- Load Sample Data ---
  function _loadSampleData() {
    fileContents.old = SampleData.oldFile;
    fileContents.new = SampleData.newFile;

    // Update UI
    const oldZone = document.getElementById('oldDropZone');
    const newZone = document.getElementById('newDropZone');
    oldZone.classList.add('loaded');
    newZone.classList.add('loaded');
    oldZone.querySelector('.upload-zone__filename').textContent = '✓ sample_old.txt (demo)';
    newZone.querySelector('.upload-zone__filename').textContent = '✓ sample_new.txt (demo)';

    _showToast('Sample data loaded. Click Compare to proceed.', 'info');
  }

  // --- Dashboard ---
  function _renderDashboard(result) {
    const { componentChanges, connectivityChanges, netRenames, netChanges } = result;

    const added    = componentChanges.filter(c => c.status === 'added').length;
    const deleted  = componentChanges.filter(c => c.status === 'deleted').length;
    const modified = componentChanges.filter(c => c.status === 'modified').length;

    document.getElementById('card-added').textContent       = added;
    document.getElementById('card-deleted').textContent     = deleted;
    document.getElementById('card-modified').textContent    = modified;
    document.getElementById('card-netsAdded').textContent   = netChanges.added.length;
    document.getElementById('card-netsDeleted').textContent = netChanges.deleted.length;
    document.getElementById('card-netsRenamed').textContent = netRenames.length;
    document.getElementById('card-connectivity').textContent = connectivityChanges.length;
  }

  // --- Tabs ---
  function _bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.panel).classList.add('active');
      });
    });
  }

  function _renderAllTabs(result) {
    _renderComponentsTab(result.componentChanges);
    _renderConnectivityTab(result.connectivityChanges);
    _renderRenamesTab(result.netRenames);
    _renderNetDetailsTab(result);
    _updateTabCounts(result);
  }

  function _updateTabCounts(result) {
    document.getElementById('tab-comp-count').textContent = result.componentChanges.length;
    document.getElementById('tab-conn-count').textContent = result.connectivityChanges.length;
    document.getElementById('tab-rename-count').textContent = result.netRenames.length;

    // Net details: total unique nets across old and new
    const allNets = new Set([
      ...(result.oldData.nets ? result.oldData.nets.keys() : []),
      ...(result.newData.nets ? result.newData.nets.keys() : [])
    ]);
    document.getElementById('tab-net-count').textContent = allNets.size;
  }

  // ==========================================
  // TAB 1: Component Changes
  // ==========================================
  function _renderComponentsTab(changes) {
    const state = paginationState.components;
    state.filtered = changes;

    // Bind search
    const searchEl = document.getElementById('componentSearch');
    const filterEl = document.getElementById('componentFilter');
    searchEl.value = '';
    filterEl.value = 'all';

    const handler = () => {
      const q = searchEl.value.toLowerCase();
      const f = filterEl.value;
      state.filtered = changes.filter(c => {
        const matchSearch = !q ||
          c.refDes.toLowerCase().includes(q) ||
          _propsString(c.oldProps).toLowerCase().includes(q) ||
          _propsString(c.newProps).toLowerCase().includes(q);
        const matchFilter = f === 'all' || c.status === f;
        return matchSearch && matchFilter;
      });
      state.page = 1;
      _drawComponentsTable();
    };

    searchEl.removeEventListener('input', searchEl._handler);
    searchEl._handler = _debounce(handler, 200);
    searchEl.addEventListener('input', searchEl._handler);
    filterEl.removeEventListener('change', filterEl._handler);
    filterEl._handler = handler;
    filterEl.addEventListener('change', filterEl._handler);

    _drawComponentsTable();
  }

  function _drawComponentsTable() {
    const state = paginationState.components;
    const data  = state.filtered;
    const start = (state.page - 1) * PAGE_SIZE;
    const page  = data.slice(start, start + PAGE_SIZE);

    const tbody = document.getElementById('componentTableBody');
    const info  = document.getElementById('componentInfo');

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state"><div class="empty-state__icon">📋</div><div class="empty-state__text">No component changes detected</div></td></tr>`;
      info.textContent = '0 results';
      _drawPagination('componentPagination', state, _drawComponentsTable);
      return;
    }

    info.textContent = `${data.length} result${data.length !== 1 ? 's' : ''}`;

    tbody.innerHTML = page.map(c => {
      const rowClass = `row-${c.status}`;
      const badge = _statusBadge(c.status);
      const oldVal = _propsString(c.oldProps);
      const newVal = _propsString(c.newProps);
      return `<tr class="${rowClass}" data-refdes="${_esc(c.refDes)}" style="cursor:pointer">
        <td><strong>${_esc(c.refDes)}</strong></td>
        <td>${badge}</td>
        <td>${_esc(oldVal) || '—'}</td>
        <td>${_esc(newVal) || '—'}</td>
      </tr>`;
    }).join('');

    // Click to open detail modal
    tbody.querySelectorAll('tr[data-refdes]').forEach(row => {
      row.addEventListener('click', () => {
        const refDes = row.dataset.refdes;
        const comp = state.filtered.find(c => c.refDes === refDes);
        if (comp) _showComponentModal(comp);
      });
    });

    _drawPagination('componentPagination', state, _drawComponentsTable);
  }

  // ==========================================
  // TAB 2: Connectivity Changes
  // ==========================================
  function _renderConnectivityTab(changes) {
    const state = paginationState.connectivity;
    state.filtered = changes;

    const searchEl = document.getElementById('connectivitySearch');
    const filterEl = document.getElementById('connectivityFilter');
    searchEl.value = '';
    filterEl.value = 'all';

    const handler = () => {
      const q = searchEl.value.toLowerCase();
      const f = filterEl.value;
      state.filtered = changes.filter(c => {
        const matchSearch = !q ||
          c.refDes.toLowerCase().includes(q) ||
          c.pin.toLowerCase().includes(q) ||
          c.oldNet.toLowerCase().includes(q) ||
          c.newNet.toLowerCase().includes(q);
        const matchFilter = f === 'all' || c.status === f;
        return matchSearch && matchFilter;
      });
      state.page = 1;
      _drawConnectivityTable();
    };

    searchEl.removeEventListener('input', searchEl._handler);
    searchEl._handler = _debounce(handler, 200);
    searchEl.addEventListener('input', searchEl._handler);
    filterEl.removeEventListener('change', filterEl._handler);
    filterEl._handler = handler;
    filterEl.addEventListener('change', filterEl._handler);

    _drawConnectivityTable();
  }

  function _drawConnectivityTable() {
    const state = paginationState.connectivity;
    const data  = state.filtered;
    const start = (state.page - 1) * PAGE_SIZE;
    const page  = data.slice(start, start + PAGE_SIZE);

    const tbody = document.getElementById('connectivityTableBody');
    const info  = document.getElementById('connectivityInfo');

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><div class="empty-state__icon">🔌</div><div class="empty-state__text">No connectivity changes detected</div></td></tr>`;
      info.textContent = '0 results';
      _drawPagination('connectivityPagination', state, _drawConnectivityTable);
      return;
    }

    info.textContent = `${data.length} result${data.length !== 1 ? 's' : ''}`;

    const statusBadgeMap = {
      'Net Changed': 'badge-changed',
      'Added Connection': 'badge-connection-added',
      'Removed Connection': 'badge-removed'
    };

    tbody.innerHTML = page.map(c => {
      const badgeClass = statusBadgeMap[c.status] || 'badge-changed';
      const rowClass = c.status === 'Added Connection' ? 'row-added' :
                       c.status === 'Removed Connection' ? 'row-deleted' : 'row-modified';
      return `<tr class="${rowClass}">
        <td><strong>${_esc(c.refDes)}</strong></td>
        <td>${_esc(c.pin)}</td>
        <td>${c.oldNet !== '—' ? `<span class="net-link" data-net="${_esc(c.oldNet)}">${_esc(c.oldNet)}</span>` : '—'}</td>
        <td>${c.newNet !== '—' ? `<span class="net-link" data-net="${_esc(c.newNet)}">${_esc(c.newNet)}</span>` : '—'}</td>
        <td><span class="status-badge ${badgeClass}">${_esc(c.status)}</span></td>
      </tr>`;
    }).join('');

    // Net links → navigate to Tab 4
    tbody.querySelectorAll('.net-link').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        _switchToNetDetail(el.dataset.net);
      });
    });

    _drawPagination('connectivityPagination', state, _drawConnectivityTable);
  }

  // ==========================================
  // TAB 3: Net Rename Report
  // ==========================================
  function _renderRenamesTab(renames) {
    const state = paginationState.renames;
    state.filtered = renames;

    const searchEl = document.getElementById('renameSearch');
    searchEl.value = '';

    const handler = () => {
      const q = searchEl.value.toLowerCase();
      state.filtered = renames.filter(r =>
        !q || r.oldName.toLowerCase().includes(q) || r.newName.toLowerCase().includes(q)
      );
      state.page = 1;
      _drawRenamesTable();
    };

    searchEl.removeEventListener('input', searchEl._handler);
    searchEl._handler = _debounce(handler, 200);
    searchEl.addEventListener('input', searchEl._handler);

    _drawRenamesTable();
  }

  function _drawRenamesTable() {
    const state = paginationState.renames;
    const data  = state.filtered;
    const start = (state.page - 1) * PAGE_SIZE;
    const page  = data.slice(start, start + PAGE_SIZE);

    const tbody = document.getElementById('renameTableBody');
    const info  = document.getElementById('renameInfo');

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty-state"><div class="empty-state__icon">🏷️</div><div class="empty-state__text">No net renames detected</div></td></tr>`;
      info.textContent = '0 results';
      _drawPagination('renamePagination', state, _drawRenamesTable);
      return;
    }

    info.textContent = `${data.length} result${data.length !== 1 ? 's' : ''}`;

    tbody.innerHTML = page.map(r => {
      return `<tr class="row-renamed">
        <td><span class="diff-old">${_esc(r.oldName)}</span></td>
        <td><span class="diff-arrow">→</span></td>
        <td><span class="diff-new">${_esc(r.newName)}</span></td>
      </tr>`;
    }).join('');

    _drawPagination('renamePagination', state, _drawRenamesTable);
  }

  // ==========================================
  // TAB 4: Net Details (Side-by-Side)
  // ==========================================
  function _renderNetDetailsTab(result) {
    const oldNets = result.oldData.nets;
    const newNets = result.newData.nets;
    const allNets = new Set([...oldNets.keys(), ...newNets.keys()]);
    const sorted  = [...allNets].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const sidebar = document.getElementById('netListSidebar');
    const searchEl = document.getElementById('netDetailSearch');
    searchEl.value = '';

    let displayedNets = sorted;

    const renderSidebar = () => {
      sidebar.innerHTML = displayedNets.map(name => {
        const oldCount = oldNets.has(name) ? oldNets.get(name).length : 0;
        const newCount = newNets.has(name) ? newNets.get(name).length : 0;
        const maxCount = Math.max(oldCount, newCount);
        return `<div class="net-list-item" data-net="${_esc(name)}">
          <span>${_esc(name)}</span>
          <span class="net-list-item__count">${maxCount} pins</span>
        </div>`;
      }).join('');

      sidebar.querySelectorAll('.net-list-item').forEach(item => {
        item.addEventListener('click', () => {
          sidebar.querySelectorAll('.net-list-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          _showNetDetail(item.dataset.net, oldNets, newNets);
        });
      });
    };

    const handler = () => {
      const q = searchEl.value.toLowerCase();
      displayedNets = sorted.filter(n => !q || n.toLowerCase().includes(q));
      renderSidebar();
    };

    searchEl.removeEventListener('input', searchEl._handler);
    searchEl._handler = _debounce(handler, 200);
    searchEl.addEventListener('input', searchEl._handler);

    renderSidebar();

    // Clear detail content
    document.getElementById('netDetailContent').innerHTML =
      '<div class="net-detail-content__placeholder">← Select a net to view its connectivity</div>';
  }

  function _showNetDetail(netName, oldNets, newNets) {
    const content = document.getElementById('netDetailContent');
    const oldPins = oldNets.has(netName) ? [...oldNets.get(netName)].sort() : [];
    const newPins = newNets.has(netName) ? [...newNets.get(netName)].sort() : [];

    const oldSet = new Set(oldPins);
    const newSet = new Set(newPins);

    const renderList = (pins, oppositeSet, isOld) => {
      if (pins.length === 0) return '<li style="color:var(--text-muted)">Net not present</li>';
      return pins.map(p => {
        let cls = '';
        if (isOld && !oppositeSet.has(p)) cls = 'pin-removed';
        if (!isOld && !oppositeSet.has(p)) cls = 'pin-added';
        return `<li class="${cls}">${_esc(p)}</li>`;
      }).join('');
    };

    content.innerHTML = `
      <h3 style="margin-bottom:16px;font-size:1.1rem;font-family:var(--font-mono);color:var(--accent-hover);">${_esc(netName)}</h3>
      <div class="net-detail-grid">
        <div class="net-detail-panel">
          <div class="net-detail-panel__title net-detail-panel__title--old">OLD — ${oldPins.length} pins</div>
          <ul class="net-detail-list">${renderList(oldPins, newSet, true)}</ul>
        </div>
        <div class="net-detail-panel">
          <div class="net-detail-panel__title net-detail-panel__title--new">NEW — ${newPins.length} pins</div>
          <ul class="net-detail-list">${renderList(newPins, oldSet, false)}</ul>
        </div>
      </div>
    `;
  }

  function _switchToNetDetail(netName) {
    // Activate Tab 4
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-panel="panel-netdetails"]').classList.add('active');
    document.getElementById('panel-netdetails').classList.add('active');

    // Search for and select the net
    const searchEl = document.getElementById('netDetailSearch');
    searchEl.value = netName;
    searchEl.dispatchEvent(new Event('input'));

    // Click the first matching item
    setTimeout(() => {
      const item = document.querySelector(`.net-list-item[data-net="${CSS.escape(netName)}"]`);
      if (item) item.click();
    }, 100);
  }

  // ==========================================
  // Component Detail Modal
  // ==========================================
  function _showComponentModal(comp) {
    const overlay = document.getElementById('modalOverlay');
    const title   = document.getElementById('modalTitle');
    const body    = document.getElementById('modalBody');

    title.innerHTML = `<span style="color:var(--accent-hover)">${_esc(comp.refDes)}</span> — ${_statusBadge(comp.status)}`;

    const allKeys = new Set([...Object.keys(comp.oldProps), ...Object.keys(comp.newProps)]);
    const sortedKeys = [...allKeys].sort();

    body.innerHTML = `<table class="modal__props-table">
      <thead>
        <tr><th>Property</th><th>Old Value</th><th>New Value</th></tr>
      </thead>
      <tbody>
        ${sortedKeys.map(k => {
          const ov = comp.oldProps[k] || '—';
          const nv = comp.newProps[k] || '—';
          const changed = ov !== nv ? 'changed' : '';
          return `<tr>
            <td><strong>${_esc(k)}</strong></td>
            <td class="${changed && comp.status !== 'added' ? 'changed' : ''}">${_esc(ov)}</td>
            <td class="${changed && comp.status !== 'deleted' ? 'changed' : ''}">${_esc(nv)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

    overlay.classList.add('active');
  }

  function _bindModalClose() {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalClose').addEventListener('click', () => overlay.classList.remove('active'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') overlay.classList.remove('active');
    });
  }

  // ==========================================
  // Table Sorting (by column header click)
  // ==========================================
  function setupTableSort(tableId, stateKey, drawFn) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const headers = table.querySelectorAll('thead th');
    headers.forEach((th, idx) => {
      th.addEventListener('click', () => {
        const state = sortState[stateKey];
        if (!state) return;
        if (state.col === idx) {
          state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.col = idx;
          state.dir = 'asc';
        }

        // Remove existing sort classes
        headers.forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));
        th.classList.add(state.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');

        // Sort the filtered data
        const pagState = paginationState[stateKey];
        if (pagState && pagState.filtered) {
          const keys = _getSortKeys(stateKey);
          if (keys[idx]) {
            pagState.filtered.sort((a, b) => {
              const va = keys[idx](a);
              const vb = keys[idx](b);
              const cmp = va.localeCompare(vb, undefined, { numeric: true });
              return state.dir === 'asc' ? cmp : -cmp;
            });
            pagState.page = 1;
            drawFn();
          }
        }
      });
    });
  }

  function _getSortKeys(stateKey) {
    if (stateKey === 'components') {
      return {
        0: c => c.refDes,
        1: c => c.status,
        2: c => _propsString(c.oldProps),
        3: c => _propsString(c.newProps)
      };
    }
    if (stateKey === 'connectivity') {
      return {
        0: c => c.refDes,
        1: c => c.pin,
        2: c => c.oldNet,
        3: c => c.newNet,
        4: c => c.status
      };
    }
    return {};
  }

  // ==========================================
  // Pagination
  // ==========================================
  function _drawPagination(containerId, state, drawFn) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '';
    html += `<button class="pagination__btn" ${state.page <= 1 ? 'disabled' : ''} data-page="${state.page - 1}">◀</button>`;

    const maxButtons = 7;
    let startPage = Math.max(1, state.page - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

    if (startPage > 1) {
      html += `<button class="pagination__btn" data-page="1">1</button>`;
      if (startPage > 2) html += `<span class="pagination__info">…</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
      html += `<button class="pagination__btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += `<span class="pagination__info">…</span>`;
      html += `<button class="pagination__btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    html += `<button class="pagination__btn" ${state.page >= totalPages ? 'disabled' : ''} data-page="${state.page + 1}">▶</button>`;

    container.innerHTML = html;

    container.querySelectorAll('.pagination__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        state.page = parseInt(btn.dataset.page, 10);
        drawFn();
        // Scroll table into view
        container.closest('.tab-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ==========================================
  // Utility functions
  // ==========================================
  function _statusBadge(status) {
    const map = {
      added: '<span class="status-badge badge-added">● Added</span>',
      deleted: '<span class="status-badge badge-deleted">● Deleted</span>',
      modified: '<span class="status-badge badge-modified">● Modified</span>',
      renamed: '<span class="status-badge badge-renamed">● Renamed</span>'
    };
    return map[status] || status;
  }

  function _propsString(props) {
    if (!props || typeof props !== 'object') return '';
    const entries = Object.entries(props);
    if (entries.length === 0) return '';
    // Show key properties first
    const priority = ['Value', 'Part Number', 'Description', 'PartNumber', 'PART_NUMBER'];
    const ordered = [];
    for (const key of priority) {
      if (props[key]) ordered.push(props[key]);
    }
    // Add remaining
    for (const [k, v] of entries) {
      if (!priority.includes(k) && v) ordered.push(`${k}: ${v}`);
    }
    return ordered.join(' | ');
  }

  function _esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function _formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function _debounce(fn, ms) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function _showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  return { init, setupTableSort, _drawComponentsTable, _drawConnectivityTable };
})();


// ============================================================
// 4. EXPORT MODULE
// ============================================================
const ExportModule = (() => {
  'use strict';

  // --- HTML Export ---
  function exportHTML(result) {
    if (!result) return;
    const { componentChanges, connectivityChanges, netRenames, netChanges } = result;
    const timestamp = new Date().toLocaleString();

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PCB Net Comparator Report - ${timestamp}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; color: #222; padding: 20px; font-size: 13px; }
  h1 { color: #1a1a2e; border-bottom: 3px solid #6366f1; padding-bottom: 8px; }
  h2 { color: #333; margin-top: 30px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 20px; font-family: 'Cascadia Code', monospace; font-size: 12px; }
  th { background: #1a1a2e; color: #fff; text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; }
  td { padding: 6px 12px; border-bottom: 1px solid #ddd; }
  tr:nth-child(even) { background: #f0f0f0; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; }
  .added { background: #d1fae5; color: #065f46; }
  .deleted { background: #fee2e2; color: #991b1b; }
  .modified { background: #fef3c7; color: #92400e; }
  .renamed { background: #dbeafe; color: #1e40af; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
  .summary-card { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px 18px; text-align: center; min-width: 120px; }
  .summary-card .val { font-size: 24px; font-weight: 800; }
  .summary-card .lbl { font-size: 11px; color: #666; text-transform: uppercase; }
  .timestamp { color: #888; font-size: 12px; }
</style>
</head>
<body>
<h1>🔍 PCB/Schematic Net Comparator Report</h1>
<p class="timestamp">Generated: ${timestamp}</p>

<div class="summary">
  <div class="summary-card"><div class="val" style="color:#10b981">${componentChanges.filter(c => c.status === 'added').length}</div><div class="lbl">Components Added</div></div>
  <div class="summary-card"><div class="val" style="color:#f43f5e">${componentChanges.filter(c => c.status === 'deleted').length}</div><div class="lbl">Components Deleted</div></div>
  <div class="summary-card"><div class="val" style="color:#f59e0b">${componentChanges.filter(c => c.status === 'modified').length}</div><div class="lbl">Components Modified</div></div>
  <div class="summary-card"><div class="val" style="color:#3b82f6">${netRenames.length}</div><div class="lbl">Nets Renamed</div></div>
  <div class="summary-card"><div class="val" style="color:#a78bfa">${connectivityChanges.length}</div><div class="lbl">Connectivity Changes</div></div>
</div>

${componentChanges.length ? `
<h2>Component Changes (${componentChanges.length})</h2>
<table>
<tr><th>RefDes</th><th>Status</th><th>Details</th></tr>
${componentChanges.map(c => {
  const badge = `<span class="badge ${c.status}">${c.status.toUpperCase()}</span>`;
  let details = '';
  if (c.status === 'modified') {
    details = c.changedProps.map(p => `${p.property}: ${p.oldValue} → ${p.newValue}`).join('<br>');
  } else if (c.status === 'added') {
    details = Object.entries(c.newProps).map(([k,v]) => `${k}: ${v}`).join(', ');
  } else {
    details = Object.entries(c.oldProps).map(([k,v]) => `${k}: ${v}`).join(', ');
  }
  return `<tr><td><b>${c.refDes}</b></td><td>${badge}</td><td>${details}</td></tr>`;
}).join('')}
</table>` : ''}

${connectivityChanges.length ? `
<h2>Connectivity Changes (${connectivityChanges.length})</h2>
<table>
<tr><th>RefDes</th><th>Pin</th><th>Old Net</th><th>New Net</th><th>Status</th></tr>
${connectivityChanges.map(c => `<tr><td><b>${c.refDes}</b></td><td>${c.pin}</td><td>${c.oldNet}</td><td>${c.newNet}</td><td>${c.status}</td></tr>`).join('')}
</table>` : ''}

${netRenames.length ? `
<h2>Net Renames (${netRenames.length})</h2>
<table>
<tr><th>Old Net Name</th><th></th><th>New Net Name</th></tr>
${netRenames.map(r => `<tr><td>${r.oldName}</td><td>→</td><td>${r.newName}</td></tr>`).join('')}
</table>` : ''}

</body></html>`;

    _download('pcb_comparison_report.html', html, 'text/html');
  }

  // --- Excel Export ---
  function exportExcel(result) {
    if (!result) return;
    if (typeof XLSX === 'undefined') {
      // Fallback to CSV
      _exportCSV(result);
      return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Component Changes
    const compData = result.componentChanges.map(c => ({
      RefDes: c.refDes,
      Status: c.status.toUpperCase(),
      'Changed Properties': c.changedProps.map(p => `${p.property}: ${p.oldValue} → ${p.newValue}`).join('; '),
      'Old Values': Object.entries(c.oldProps).map(([k,v]) => `${k}: ${v}`).join('; '),
      'New Values': Object.entries(c.newProps).map(([k,v]) => `${k}: ${v}`).join('; ')
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compData), 'Component Changes');

    // Sheet 2: Connectivity Changes
    const connData = result.connectivityChanges.map(c => ({
      RefDes: c.refDes,
      Pin: c.pin,
      'Old Net': c.oldNet,
      'New Net': c.newNet,
      Status: c.status
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(connData), 'Connectivity Changes');

    // Sheet 3: Net Renames
    const renameData = result.netRenames.map(r => ({
      'Old Net Name': r.oldName,
      'New Net Name': r.newName
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(renameData), 'Net Renames');

    // Sheet 4: Summary
    const summary = [{
      Metric: 'Components Added', Value: result.componentChanges.filter(c => c.status === 'added').length
    }, {
      Metric: 'Components Deleted', Value: result.componentChanges.filter(c => c.status === 'deleted').length
    }, {
      Metric: 'Components Modified', Value: result.componentChanges.filter(c => c.status === 'modified').length
    }, {
      Metric: 'Nets Added', Value: result.netChanges.added.length
    }, {
      Metric: 'Nets Deleted', Value: result.netChanges.deleted.length
    }, {
      Metric: 'Nets Renamed', Value: result.netRenames.length
    }, {
      Metric: 'Connectivity Changes', Value: result.connectivityChanges.length
    }];
    const summarySheet = XLSX.utils.json_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    XLSX.writeFile(wb, 'pcb_comparison_report.xlsx');
  }

  // Fallback CSV export
  function _exportCSV(result) {
    let csv = 'Section,RefDes,Pin,Old,New,Status\n';
    for (const c of result.componentChanges) {
      csv += `Component,${c.refDes},,${_csvEsc(JSON.stringify(c.oldProps))},${_csvEsc(JSON.stringify(c.newProps))},${c.status}\n`;
    }
    for (const c of result.connectivityChanges) {
      csv += `Connectivity,${c.refDes},${c.pin},${c.oldNet},${c.newNet},${c.status}\n`;
    }
    for (const r of result.netRenames) {
      csv += `NetRename,,,"${r.oldName}","${r.newName}",Renamed\n`;
    }
    _download('pcb_comparison_report.csv', csv, 'text/csv');
  }

  function _csvEsc(str) {
    return `"${String(str).replace(/"/g, '""')}"`;
  }

  // --- PDF Export (via print) ---
  function exportPDF() {
    window.print();
  }

  // --- Download helper ---
  function _download(filename, content, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return { exportHTML, exportExcel, exportPDF };
})();


// ============================================================
// 5. SAMPLE DATA — realistic Siemens-exported .txt content
// ============================================================
const SampleData = (() => {
  'use strict';

  const oldFile = `
BEGIN_COMPPROPS
"C101" "Part Number" "CAP-100NF-0402"
"C101" "Value" "100nF"
"C101" "Description" "Capacitor 100nF 16V X7R 0402"
"C101" "Footprint" "0402"
"C102" "Part Number" "CAP-10UF-0805"
"C102" "Value" "10uF"
"C102" "Description" "Capacitor 10uF 16V X5R 0805"
"C102" "Footprint" "0805"
"C103" "Part Number" "CAP-22PF-0402"
"C103" "Value" "22pF"
"C103" "Description" "Capacitor 22pF 50V C0G 0402"
"C103" "Footprint" "0402"
"R101" "Part Number" "RES-10K-0402"
"R101" "Value" "10K"
"R101" "Description" "Resistor 10K 1% 0402"
"R101" "Footprint" "0402"
"R102" "Part Number" "RES-4K7-0402"
"R102" "Value" "4.7K"
"R102" "Description" "Resistor 4.7K 1% 0402"
"R102" "Footprint" "0402"
"R103" "Part Number" "RES-100R-0402"
"R103" "Value" "100R"
"R103" "Description" "Resistor 100R 1% 0402"
"R103" "Footprint" "0402"
"R104" "Part Number" "RES-1K-0402"
"R104" "Value" "1K"
"R104" "Description" "Resistor 1K 5% 0402"
"R104" "Footprint" "0402"
"U1" "Part Number" "STM32F407VGT6"
"U1" "Value" "STM32F407"
"U1" "Description" "ARM Cortex-M4 MCU 168MHz 1MB Flash"
"U1" "Footprint" "LQFP-100"
"U2" "Part Number" "LM3940-3.3"
"U2" "Value" "LM3940"
"U2" "Description" "LDO Regulator 3.3V 1A"
"U2" "Footprint" "SOT-223"
"U3" "Part Number" "MAX232CSE"
"U3" "Value" "MAX232"
"U3" "Description" "RS232 Dual Driver/Receiver"
"U3" "Footprint" "SOIC-16"
"J1" "Part Number" "USB-B-MICRO"
"J1" "Value" "USB-B"
"J1" "Description" "USB Micro-B Connector"
"J1" "Footprint" "USB-MICRO-B-SMD"
"D1" "Part Number" "LED-GREEN-0603"
"D1" "Value" "GREEN"
"D1" "Description" "LED Green 0603"
"D1" "Footprint" "0603"
"D2" "Part Number" "LED-RED-0603"
"D2" "Value" "RED"
"D2" "Description" "LED Red 0603"
"D2" "Footprint" "0603"
"Q1" "Part Number" "BSS138"
"Q1" "Value" "BSS138"
"Q1" "Description" "N-Channel MOSFET 50V SOT-23"
"Q1" "Footprint" "SOT-23"
"Y1" "Part Number" "XTAL-8MHZ"
"Y1" "Value" "8MHz"
"Y1" "Description" "Crystal 8MHz 20ppm"
"Y1" "Footprint" "HC49"
END_COMPPROPS

BEGIN_COMPPINS
"C101" "1"
"C101" "2"
"C102" "1"
"C102" "2"
"C103" "1"
"C103" "2"
"R101" "1"
"R101" "2"
"R102" "1"
"R102" "2"
"R103" "1"
"R103" "2"
"R104" "1"
"R104" "2"
"U1" "1"
"U1" "2"
"U1" "3"
"U1" "4"
"U1" "5"
"U1" "6"
"U1" "7"
"U1" "8"
"U2" "1"
"U2" "2"
"U2" "3"
"U3" "1"
"U3" "2"
"U3" "3"
"U3" "4"
"J1" "1"
"J1" "2"
"J1" "3"
"J1" "4"
"J1" "5"
"D1" "A"
"D1" "K"
"D2" "A"
"D2" "K"
"Q1" "G"
"Q1" "D"
"Q1" "S"
"Y1" "1"
"Y1" "2"
END_COMPPINS

BEGIN_NETS
"+5V"
  "C101" "1"
  "C102" "1"
  "U2" "1"
  "J1" "1"
  "R101" "1"
"+3V3"
  "U1" "1"
  "U2" "3"
  "C103" "1"
  "R102" "1"
  "R103" "1"
"GND"
  "C101" "2"
  "C102" "2"
  "C103" "2"
  "U1" "2"
  "U2" "2"
  "J1" "5"
  "D1" "K"
  "D2" "K"
  "Q1" "S"
"USB_D+"
  "J1" "3"
  "U1" "3"
"USB_D-"
  "J1" "2"
  "U1" "4"
"UART_TX"
  "U1" "5"
  "U3" "1"
"UART_RX"
  "U1" "6"
  "U3" "2"
"SPI_CLK"
  "U1" "7"
  "R104" "1"
"LED_GREEN"
  "R103" "2"
  "D1" "A"
"LED_RED"
  "R102" "2"
  "D2" "A"
"RESET_N"
  "U1" "8"
  "R101" "2"
"GATE_CTRL"
  "R104" "2"
  "Q1" "G"
"DRAIN_OUT"
  "Q1" "D"
"OSC_IN"
  "Y1" "1"
"OSC_OUT"
  "Y1" "2"
"RS232_TX"
  "U3" "3"
"RS232_RX"
  "U3" "4"
"USB_ID"
  "J1" "4"
END_NETS

BEGIN_E-NETS
END_E-NETS
`;

  const newFile = `
BEGIN_COMPPROPS
"C101" "Part Number" "CAP-100NF-0402"
"C101" "Value" "100nF"
"C101" "Description" "Capacitor 100nF 25V X7R 0402"
"C101" "Footprint" "0402"
"C102" "Part Number" "CAP-22UF-0805"
"C102" "Value" "22uF"
"C102" "Description" "Capacitor 22uF 25V X5R 0805"
"C102" "Footprint" "0805"
"C103" "Part Number" "CAP-22PF-0402"
"C103" "Value" "22pF"
"C103" "Description" "Capacitor 22pF 50V C0G 0402"
"C103" "Footprint" "0402"
"C104" "Part Number" "CAP-1UF-0402"
"C104" "Value" "1uF"
"C104" "Description" "Capacitor 1uF 16V X5R 0402"
"C104" "Footprint" "0402"
"R101" "Part Number" "RES-10K-0402"
"R101" "Value" "10K"
"R101" "Description" "Resistor 10K 1% 0402"
"R101" "Footprint" "0402"
"R102" "Part Number" "RES-4K7-0402"
"R102" "Value" "4.7K"
"R102" "Description" "Resistor 4.7K 1% 0402"
"R102" "Footprint" "0402"
"R103" "Part Number" "RES-220R-0402"
"R103" "Value" "220R"
"R103" "Description" "Resistor 220R 1% 0402"
"R103" "Footprint" "0402"
"R104" "Part Number" "RES-1K-0402"
"R104" "Value" "1K"
"R104" "Description" "Resistor 1K 1% 0402"
"R104" "Footprint" "0402"
"R105" "Part Number" "RES-47K-0402"
"R105" "Value" "47K"
"R105" "Description" "Resistor 47K 1% 0402"
"R105" "Footprint" "0402"
"U1" "Part Number" "STM32F407VGT6"
"U1" "Value" "STM32F407"
"U1" "Description" "ARM Cortex-M4 MCU 168MHz 1MB Flash"
"U1" "Footprint" "LQFP-100"
"U2" "Part Number" "TLV1117-3.3"
"U2" "Value" "TLV1117"
"U2" "Description" "LDO Regulator 3.3V 800mA"
"U2" "Footprint" "SOT-223"
"J1" "Part Number" "USB-C-16P"
"J1" "Value" "USB-C"
"J1" "Description" "USB Type-C Connector 16-pin"
"J1" "Footprint" "USB-C-SMD-16P"
"D1" "Part Number" "LED-GREEN-0603"
"D1" "Value" "GREEN"
"D1" "Description" "LED Green 0603"
"D1" "Footprint" "0603"
"D2" "Part Number" "LED-BLUE-0603"
"D2" "Value" "BLUE"
"D2" "Description" "LED Blue 0603"
"D2" "Footprint" "0603"
"Q1" "Part Number" "BSS138"
"Q1" "Value" "BSS138"
"Q1" "Description" "N-Channel MOSFET 50V SOT-23"
"Q1" "Footprint" "SOT-23"
"Y1" "Part Number" "XTAL-8MHZ"
"Y1" "Value" "8MHz"
"Y1" "Description" "Crystal 8MHz 10ppm"
"Y1" "Footprint" "HC49"
END_COMPPROPS

BEGIN_COMPPINS
"C101" "1"
"C101" "2"
"C102" "1"
"C102" "2"
"C103" "1"
"C103" "2"
"C104" "1"
"C104" "2"
"R101" "1"
"R101" "2"
"R102" "1"
"R102" "2"
"R103" "1"
"R103" "2"
"R104" "1"
"R104" "2"
"R105" "1"
"R105" "2"
"U1" "1"
"U1" "2"
"U1" "3"
"U1" "4"
"U1" "5"
"U1" "6"
"U1" "7"
"U1" "8"
"U2" "1"
"U2" "2"
"U2" "3"
"J1" "1"
"J1" "2"
"J1" "3"
"J1" "4"
"J1" "5"
"D1" "A"
"D1" "K"
"D2" "A"
"D2" "K"
"Q1" "G"
"Q1" "D"
"Q1" "S"
"Y1" "1"
"Y1" "2"
END_COMPPINS

BEGIN_NETS
"VCC_5V"
  "C101" "1"
  "C102" "1"
  "U2" "1"
  "J1" "1"
  "R101" "1"
"+3V3"
  "U1" "1"
  "U2" "3"
  "C103" "1"
  "C104" "1"
  "R102" "1"
  "R103" "1"
  "R105" "1"
"GND"
  "C101" "2"
  "C102" "2"
  "C103" "2"
  "C104" "2"
  "U1" "2"
  "U2" "2"
  "J1" "5"
  "D1" "K"
  "D2" "K"
  "Q1" "S"
"USB_DP"
  "J1" "3"
  "U1" "3"
"USB_DN"
  "J1" "2"
  "U1" "4"
"UART_TX"
  "U1" "5"
"UART_RX"
  "U1" "6"
"SPI_CLK"
  "U1" "7"
  "R104" "1"
"LED_STATUS"
  "R103" "2"
  "D1" "A"
"LED_ERR"
  "R102" "2"
  "D2" "A"
"NRST"
  "U1" "8"
  "R101" "2"
  "C104" "2"
"GATE_CTRL"
  "R104" "2"
  "Q1" "G"
  "R105" "2"
"DRAIN_OUT"
  "Q1" "D"
"OSC_IN"
  "Y1" "1"
"OSC_OUT"
  "Y1" "2"
"USB_ID"
  "J1" "4"
END_NETS

BEGIN_E-NETS
END_E-NETS
`;

  return { oldFile, newFile };
})();


// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  UIController.init();

  // Setup column sorting after DOM is ready
  // Sorting for component and connectivity tables
  requestAnimationFrame(() => {
    UIController.setupTableSort('componentTable', 'components', UIController._drawComponentsTable);
    UIController.setupTableSort('connectivityTable', 'connectivity', UIController._drawConnectivityTable);
  });
});
