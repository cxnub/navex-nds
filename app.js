/*
 * NAVEX NDS
 * MapTiler / MapLibre implementation based on Project NAVEX's map workflow.
 * MGR conversion uses EPSG:3168 <-> EPSG:4326 locally via grid.js.
 *
 */

const MAPTILER_STORAGE_KEY = 'navex.maptiler.apiKey';
const ROUTE_STORAGE_KEY = 'navex.route';
const CHECKPOINT_STORAGE_KEY = 'navex.checkpoints';
const ROA_COLOR = '#22c55e';

let map;
let routeSourceReady = false;
let markers = [];
let checkpoints = [];
let checkpointMarkers = [];
let nextId = 1;
let editingPointId = null;
let checkpointsVisible = true;

const state = {
  speedKmh: 4.0,
  distanceUnit: 'm',
  mgrPrecision: 4,
};

const els = {};

const MAP_STYLES = {
  streets: maptilersdk.MapStyle.STREETS,
  outdoor: maptilersdk.MapStyle.OUTDOOR,
  satellite: maptilersdk.MapStyle.SATELLITE,
  hybrid: maptilersdk.MapStyle.HYBRID,
};

window.addEventListener('load', initApp);

function initApp() {
  Object.assign(els, {
    speed: document.getElementById('speed'),
    distanceUnit: document.getElementById('distanceUnit'),
    mgrPrecision: document.getElementById('mgrPrecision'),
    mgrInput: document.getElementById('mgrInput'),
    mgrStatus: document.getElementById('mgrStatus'),
    pointList: document.getElementById('pointList'),
    checkpointList: document.getElementById('checkpointList'),
    cpType: document.getElementById('cpType'),
    cpId: document.getElementById('cpId'),
    cpMgr: document.getElementById('cpMgr'),
    cpName: document.getElementById('cpName'),
    cpStatus: document.getElementById('cpStatus'),
    importFile: document.getElementById('importFile'),
    shareStatus: document.getElementById('shareStatus'),
    mapType: document.getElementById('mapType'),
    editDialog: document.getElementById('editDialog'),
    editDescription: document.getElementById('editDescription'),
    editRemarks: document.getElementById('editRemarks'),
    toggleCheckpointsBtn: document.getElementById('toggleCheckpointsBtn'),
    apiKeyDialog: document.getElementById('apiKeyDialog'),
    apiKeyForm: document.getElementById('apiKeyForm'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    apiKeyStatus: document.getElementById('apiKeyStatus'),
  });

  bindApiKeyUI();
  bindUI();

  const savedKey = getStoredApiKey();
  if (savedKey) {
    initMap(savedKey);
  } else {
    showApiKeyDialog(true);
  }
}

function getStoredApiKey() {
  try { return localStorage.getItem(MAPTILER_STORAGE_KEY)?.trim() || ''; }
  catch { return ''; }
}

function saveApiKey(key) {
  localStorage.setItem(MAPTILER_STORAGE_KEY, key.trim());
}

function showApiKeyDialog(required = false) {
  els.apiKeyStatus.textContent = required ? 'A MapTiler API key is required to load the map.' : '';
  els.apiKeyInput.value = getStoredApiKey();
  els.apiKeyCancelBtn = document.getElementById('apiKeyCancelBtn');
  els.apiKeyCancelBtn.style.display = required ? 'none' : '';
  if (!els.apiKeyDialog.open) els.apiKeyDialog.showModal();
  setTimeout(() => els.apiKeyInput.focus(), 0);
}

function bindApiKeyUI() {
  els.apiKeyForm.addEventListener('submit', event => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    const key = els.apiKeyInput.value.trim();
    if (!key) {
      els.apiKeyStatus.textContent = 'Enter a MapTiler API key.';
      return;
    }
    saveApiKey(key);
    els.apiKeyDialog.close();
    if (map) map.remove();
    markers.forEach(x => x.marker.remove());
    checkpointMarkers.forEach(x => x.marker.remove());
    markers = [];
    checkpointMarkers = [];
    routeSourceReady = false;
    nextId = 1;
    initMap(key);
  });
  document.getElementById('apiKeyCancelBtn').addEventListener('click', () => els.apiKeyDialog.close());
  els.apiKeyDialog.addEventListener('cancel', event => {
    if (!getStoredApiKey()) event.preventDefault();
  });
  els.apiKeyDialog.addEventListener('close', () => {
    if (!getStoredApiKey()) setTimeout(() => showApiKeyDialog(true), 0);
  });
  document.getElementById('mapKeyBtn').addEventListener('click', () => showApiKeyDialog(false));
}

function initMap(apiKey) {
  maptilersdk.config.apiKey = apiKey;

  map = new maptilersdk.Map({
    container: 'map',
    style: MAP_STYLES.streets,
    center: [103.8198, 1.3521],
    zoom: 11,
    attributionControl: true,
  });

  map.addControl(new maptilersdk.NavigationControl(), 'top-right');

  map.on('load', async () => {
    setupRouteLayer();
    await loadCheckpoints();
    await loadSavedRoute();
    render();
  });

  map.on('click', e => {
    // Ignore clicks on checkpoint markers because their DOM marker stops propagation.
    addPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng }, null, false);
  });

  map.on('style.load', () => {
    setupRouteLayer();
    syncPolyline();
  });
}

function setupRouteLayer() {
  if (!map.isStyleLoaded()) return;

  if (!map.getSource('route')) {
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
    });
  }

  if (!map.getLayer('route-line')) {
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROA_COLOR, 'line-opacity': 0.95, 'line-width': 3 },
    });
  }
  routeSourceReady = true;
}

function bindUI() {
  if (els._bound) return;
  els._bound = true;

  els.speed.addEventListener('input', () => {
    state.speedKmh = Math.max(0.1, Number(els.speed.value) || 4);
    render();
  });
  els.distanceUnit.addEventListener('change', () => {
    state.distanceUnit = els.distanceUnit.value;
    render();
  });
  els.mgrPrecision.addEventListener('change', () => {
    state.mgrPrecision = Number(els.mgrPrecision.value);
    render();
  });
  els.mapType.addEventListener('change', () => {
    const style = MAP_STYLES[els.mapType.value];
    if (style) map.setStyle(style);
  });
  els.toggleCheckpointsBtn.addEventListener('click', toggleCheckpoints);
  document.getElementById('clearBtn').addEventListener('click', clearRoute);
  document.getElementById('addMgrBtn').addEventListener('click', addMGR);
  els.mgrInput.addEventListener('keydown', e => { if (e.key === 'Enter') addMGR(); });
  document.getElementById('addCpBtn').addEventListener('click', addCheckpoint);
  document.getElementById('exportRouteBtn').addEventListener('click', exportRoute);
  document.getElementById('importRouteBtn').addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => {
    const file = els.importFile.files[0];
    els.importFile.value = '';
    if (file) importRoute(file);
  });
  [els.mgrInput, els.cpMgr].forEach(input => input.addEventListener('input', () => autoFormatMGRInput(input)));
  [els.cpId, els.cpMgr, els.cpName].forEach(input => input.addEventListener('keydown', e => { if (e.key === 'Enter') addCheckpoint(); }));

  const form = document.getElementById('editForm');
  form.addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    const item = markers.find(x => x.point.id === editingPointId);
    if (!item) return;
    item.point.description = els.editDescription.value.trim();
    item.point.remarks = els.editRemarks.value.trim();
    render();
  });
}

async function loadSavedRoute() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(ROUTE_STORAGE_KEY) || 'null'); } catch { saved = null; }
  if (!saved || !Array.isArray(saved.points)) return;
  if (saved.settings) applySettings(saved.settings);
  restorePoints(saved.points);
}

function applySettings(settings) {
  state.speedKmh = Math.max(0.1, Number(settings.speedKmh) || 4);
  state.distanceUnit = settings.distanceUnit === 'km' ? 'km' : 'm';
  state.mgrPrecision = Number(settings.mgrPrecision) === 6 ? 6 : 4;
  els.speed.value = state.speedKmh;
  els.distanceUnit.value = state.distanceUnit;
  els.mgrPrecision.value = state.mgrPrecision;
}

function restorePoints(points) {
  points.forEach(data => {
    if (!Number.isFinite(Number(data.lat)) || !Number.isFinite(Number(data.lng))) return;
    const point = { ...data, id: nextId++ };
    const el = document.createElement('div');
    el.className = `route-marker ${point.fixed ? 'fixed' : 'manual'}`;
    el.title = point.fixed ? `${point.checkpointId} — fixed checkpoint` : `Route point ${markers.length + 1}`;
    const marker = new maptilersdk.Marker({ element: el, anchor: 'center', draggable: !point.fixed })
      .setLngLat([point.lng, point.lat]).addTo(map);
    el.addEventListener('click', event => { event.stopPropagation(); openPointEditor(point.id); });
    if (!point.fixed) {
      marker.on('dragend', () => {
        const pos = marker.getLngLat();
        point.lat = pos.lat; point.lng = pos.lng; point.mgr = null;
        syncPolyline();
        render();
      });
    }
    markers.push({ point, marker });
  });
  syncPolyline();
}

const EXPORT_FORMAT = 'navex-nds-route';

function exportRoute() {
  if (!markers.length) {
    els.shareStatus.textContent = 'Nothing to export. Plot a route first.';
    return;
  }
  const usedIds = new Set(markers.map(x => x.point.checkpointId).filter(Boolean));
  const data = {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { ...state },
    checkpoints: checkpoints.filter(cp => usedIds.has(cp.id)),
    points: markers.map(({ point }) => ({
      lat: point.lat,
      lng: point.lng,
      description: point.description || '',
      remarks: point.remarks || '',
      checkpointId: point.checkpointId || null,
      checkpointType: point.checkpointType || null,
      fixed: Boolean(point.fixed),
    })),
  };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `navex-route-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  els.shareStatus.textContent = `Exported ${data.points.length} points.`;
}

async function importRoute(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { els.shareStatus.textContent = 'Not a valid route file.'; return; }
  if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.points)) {
    els.shareStatus.textContent = 'Not a NAVEX route file.';
    return;
  }

  const isCoord = p => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng));
  const importedCps = (Array.isArray(data.checkpoints) ? data.checkpoints : [])
    .filter(cp => cp && cp.id && isCoord(cp))
    .map(cp => ({
      id: String(cp.id).toUpperCase(),
      name: String(cp.name || ''),
      type: String(cp.type).toUpperCase() === 'SCP' ? 'SCP' : 'CP',
      mgr: NavexGrid.formatMGR(cp.lat, cp.lng, 4),
      lat: Number(cp.lat),
      lng: Number(cp.lng),
    }));
  const cpIds = new Set(importedCps.map(cp => cp.id));
  const points = data.points.filter(isCoord).map(p => {
    const checkpointId = p.checkpointId ? String(p.checkpointId).toUpperCase() : null;
    const linked = checkpointId && cpIds.has(checkpointId);
    return {
      lat: Number(p.lat),
      lng: Number(p.lng),
      description: String(p.description || ''),
      remarks: String(p.remarks || ''),
      checkpointId: linked ? checkpointId : null,
      checkpointType: linked ? p.checkpointType || null : null,
      fixed: Boolean(linked && p.fixed),
    };
  });
  if (!points.length) {
    els.shareStatus.textContent = 'The file has no route points.';
    return;
  }
  if (markers.length && !confirm(`Replace the current route (${markers.length} points) with the imported one?`)) return;

  // Imported checkpoints replace local ones with the same ID; other local checkpoints are kept.
  checkpoints = checkpoints.filter(cp => !cpIds.has(cp.id.toUpperCase())).concat(importedCps);
  saveCheckpoints();
  checkpointMarkers.forEach(x => x.marker.remove());
  checkpointMarkers = [];
  checkpoints.forEach(createCheckpointMarker);

  markers.forEach(x => x.marker.remove());
  markers = [];
  nextId = 1;
  if (data.settings) applySettings(data.settings);
  restorePoints(points);
  render();

  const bounds = new maptilersdk.LngLatBounds();
  points.forEach(p => bounds.extend([p.lng, p.lat]));
  map.fitBounds(bounds, { padding: 60, maxZoom: 16 });
  els.shareStatus.textContent = `Imported ${points.length} points and ${importedCps.length} checkpoints.`;
}

function saveRoute() {
  try {
    localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({
      settings: { ...state },
      points: markers.map(x => ({ ...x.point })),
      savedAt: new Date().toISOString(),
    }));
  } catch (err) { console.warn('Could not save route:', err); }
}

async function loadCheckpoints() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(CHECKPOINT_STORAGE_KEY) || '[]'); } catch { saved = []; }
  checkpoints = Array.isArray(saved) ? saved.filter(cp => cp && cp.id) : [];
  checkpointMarkers.forEach(x => x.marker.remove());
  checkpointMarkers = [];

  for (const cp of checkpoints) {
    try {
      if (!Number.isFinite(Number(cp.lat)) || !Number.isFinite(Number(cp.lng))) {
        Object.assign(cp, NavexGrid.mgrToLatLng(cp.mgr));
      }
      createCheckpointMarker(cp);
    } catch (err) {
      console.warn(`Could not plot ${cp.id}:`, err);
    }
  }
  saveCheckpoints();
  renderCheckpointList();
}

function saveCheckpoints() {
  try { localStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(checkpoints)); }
  catch (err) { console.warn('Could not save checkpoints:', err); }
}

function nextCheckpointId(type) {
  let n = 1;
  while (checkpoints.some(cp => cp.id.toUpperCase() === `${type}${n}`)) n++;
  return `${type}${n}`;
}

function addCheckpoint() {
  const type = els.cpType.value === 'SCP' ? 'SCP' : 'CP';
  const id = els.cpId.value.trim().toUpperCase() || nextCheckpointId(type);
  const raw = els.cpMgr.value.replace(/\s+/g, '');
  if (checkpoints.some(cp => cp.id.toUpperCase() === id)) {
    els.cpStatus.textContent = `${id} already exists.`;
    return;
  }
  if (!/^\d{8}$/.test(raw)) {
    els.cpStatus.textContent = 'Enter an 8-digit MGR, e.g. 28465132.';
    return;
  }

  let latLng;
  try { latLng = NavexGrid.mgrToLatLng(raw); }
  catch { els.cpStatus.textContent = 'MGR conversion failed.'; return; }
  const cp = { id, name: els.cpName.value.trim(), type, mgr: `${raw.slice(0, 4)} ${raw.slice(4)}`, ...latLng };
  checkpoints.push(cp);
  saveCheckpoints();
  createCheckpointMarker(cp);
  renderCheckpointList();
  map.flyTo({ center: [cp.lng, cp.lat], zoom: Math.max(map.getZoom(), 14) });
  els.cpId.value = '';
  els.cpMgr.value = '';
  els.cpName.value = '';
  els.cpStatus.textContent = `${id} added.`;
}

function removeCheckpoint(id) {
  const i = checkpoints.findIndex(cp => cp.id === id);
  if (i < 0) return;
  checkpoints.splice(i, 1);
  checkpointMarkers = checkpointMarkers.filter(x => {
    if (x.cp.id !== id) return true;
    x.marker.remove();
    return false;
  });
  saveCheckpoints();
  const routePoint = markers.find(x => x.point.checkpointId === id);
  if (routePoint) removePoint(routePoint.point.id);
  else renderCheckpointList();
}

function createCheckpointMarker(cp) {
  const type = String(cp.type || 'CP').toUpperCase() === 'SCP' ? 'SCP' : 'CP';
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `checkpoint-marker ${type.toLowerCase()}`;
  const label = document.createElement('span');
  label.className = 'cp-label';
  label.textContent = cp.id || cp.name || type;
  el.appendChild(label);
  el.title = `${cp.name || cp.id || type} — click to add to route`;

  const marker = new maptilersdk.Marker({ element: el, anchor: 'center' })
    .setLngLat([cp.lng, cp.lat])
    .addTo(map);
  if (!checkpointsVisible) el.style.display = 'none';

  el.addEventListener('click', event => {
    event.stopPropagation();
    addCheckpointToRoute(cp);
  });

  checkpointMarkers.push({ cp, marker });
}

function addCheckpointToRoute(cp) {
  const existing = markers.find(x => x.point.checkpointId === cp.id);
  if (existing) {
    map.flyTo({ center: [cp.lng, cp.lat], zoom: Math.max(map.getZoom(), 14) });
    return;
  }
  addPoint({ lat: cp.lat, lng: cp.lng }, {
    id: cp.id,
    name: cp.name || cp.id,
    type: cp.type || 'CP',
    mgr: cp.mgr || null,
  }, true);
  map.flyTo({ center: [cp.lng, cp.lat], zoom: Math.max(map.getZoom(), 14) });
}

function addPoint(latLng, checkpoint = null, fixed = false) {
  const point = {
    id: nextId++,
    lat: Number(latLng.lat),
    lng: Number(latLng.lng),
    mgr: null,
    description: checkpoint?.name || '',
    remarks: '',
    checkpointId: checkpoint?.id || null,
    checkpointType: checkpoint?.type || null,
    fixed: Boolean(fixed),
  };

  const el = document.createElement('div');
  el.className = `route-marker ${point.fixed ? 'fixed' : 'manual'}`;
  el.title = point.fixed ? `${point.checkpointId} — fixed checkpoint` : `Route point ${markers.length + 1}`;

  const marker = new maptilersdk.Marker({ element: el, anchor: 'center', draggable: !fixed })
    .setLngLat([point.lng, point.lat])
    .addTo(map);

  el.addEventListener('click', event => {
    event.stopPropagation();
    openPointEditor(point.id);
  });

  if (!fixed) {
    marker.on('dragend', () => {
      const pos = marker.getLngLat();
      point.lat = pos.lat;
      point.lng = pos.lng;
      point.mgr = null;
      syncPolyline();
      render();
    });
  }

  markers.push({ point, marker });
  syncPolyline();
  render();
}

function removePoint(id) {
  const i = markers.findIndex(x => x.point.id === id);
  if (i < 0) return;
  markers[i].marker.remove();
  markers.splice(i, 1);
  syncPolyline();
  render();
}

function syncPolyline() {
  if (!routeSourceReady || !map.getSource('route')) return;
  const coordinates = markers.map(x => [x.point.lng, x.point.lat]);
  map.getSource('route').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coordinates.length >= 2 ? coordinates : [] },
    properties: {},
  });
}

function clearRoute() {
  markers.forEach(x => x.marker.remove());
  markers = [];
  nextId = 1;
  syncPolyline();
  render();
}

function openPointEditor(id) {
  const item = markers.find(x => x.point.id === id);
  if (!item) return;
  editingPointId = id;
  els.editDescription.value = item.point.description || '';
  els.editRemarks.value = item.point.remarks || '';
  els.editDialog.showModal();
}

function addMGR() {
  const raw = els.mgrInput.value.replace(/\s+/g, '');
  if (!/^\d{8}$/.test(raw)) {
    els.mgrStatus.textContent = 'Invalid MGR. Enter exactly 8 digits, e.g. 28465132.';
    return;
  }

  let latLng;
  try { latLng = NavexGrid.mgrToLatLng(raw); }
  catch { els.mgrStatus.textContent = 'MGR conversion failed.'; return; }
  addPoint(latLng, null, false);
  map.flyTo({ center: [latLng.lng, latLng.lat], zoom: Math.max(map.getZoom(), 14) });
  els.mgrInput.value = '';
  els.mgrStatus.textContent = 'MGR plotted.';
}

function updateMGRs() {
  markers.forEach(x => { x.point.mgr = NavexGrid.formatMGR(x.point.lat, x.point.lng, state.mgrPrecision); });
}

// Keep only digits and insert the easting/northing space after the 4th digit, preserving the caret.
function autoFormatMGRInput(input) {
  const caret = input.selectionStart ?? input.value.length;
  const digitsBeforeCaret = input.value.slice(0, caret).replace(/\D/g, '').length;
  const digits = input.value.replace(/\D/g, '').slice(0, 8);
  input.value = digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
  const pos = digitsBeforeCaret > 4 ? digitsBeforeCaret + 1 : digitsBeforeCaret;
  input.setSelectionRange(pos, pos);
}

function calculateLegs() {
  const legs = [];
  for (let i = 0; i < markers.length - 1; i++) {
    const a = markers[i].point;
    const b = markers[i + 1].point;
    const { distance, azimuth } = NavexGrid.leg(a, b);
    const seconds = distance / (state.speedKmh * 1000 / 3600);
    legs.push({ from: a, to: b, distance, azimuth, seconds, description: b.description || '', remarks: b.remarks || '' });
  }
  return legs;
}

function formatDistance(m) {
  return state.distanceUnit === 'km' ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function formatTime(seconds) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h ? `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${min}:${String(sec).padStart(2, '0')}`;
}

function render() {
  updateMGRs();
  saveRoute();
  const legs = calculateLegs();
  renderPointList();
  renderCheckpointList();

}

function renderCheckpointList() {
  if (!checkpoints.length) {
    els.checkpointList.innerHTML = '<div class="empty">No checkpoints yet. Add one above.</div>';
    return;
  }
  els.checkpointList.innerHTML = checkpoints.map(cp => {
    const plotted = markers.some(x => x.point.checkpointId === cp.id);
    return `<div class="checkpoint-item">
      <span class="cp-badge ${String(cp.type || 'CP').toLowerCase()}">${escapeHtml(cp.type || 'CP')}</span>
      <span class="cp-name"><strong>${escapeHtml(cp.id)}</strong><small>${escapeHtml([cp.mgr, cp.name].filter(Boolean).join(' · '))}</small></span>
      <button class="icon-btn" data-add-cp="${escapeAttr(cp.id)}" ${plotted ? 'disabled' : ''} title="Add to route">${plotted ? '✓' : 'Add'}</button>
      <button class="icon-btn" data-remove-cp="${escapeAttr(cp.id)}" title="Delete checkpoint">×</button>
    </div>`;
  }).join('');
  els.checkpointList.querySelectorAll('[data-add-cp]').forEach(btn => btn.addEventListener('click', () => {
    const cp = checkpoints.find(x => x.id === btn.dataset.addCp);
    if (cp) addCheckpointToRoute(cp);
  }));
  els.checkpointList.querySelectorAll('[data-remove-cp]').forEach(btn => btn.addEventListener('click', () => removeCheckpoint(btn.dataset.removeCp)));
}

function renderPointList() {
  if (!markers.length) {
    els.pointList.innerHTML = '<div class="empty">No route points. Click the map or add a checkpoint.</div>';
    return;
  }
  els.pointList.innerHTML = markers.map((x, i) => `
    <div class="point-item">
      <span class="num">${i + 1}</span>
      <span class="mgr">${escapeHtml(x.point.checkpointId || x.point.mgr || 'Converting…')}</span>
      <button class="icon-btn" data-delete="${x.point.id}">×</button>
    </div>`).join('');
  els.pointList.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => removePoint(Number(btn.dataset.delete))));
}

function updatePointField(id, field, value) {
  const item = markers.find(x => x.point.id === id);
  if (item) { item.point[field] = value; saveRoute(); }
}

function toggleCheckpoints() {
  checkpointsVisible = !checkpointsVisible;
  checkpointMarkers.forEach(x => x.marker.getElement().style.display = checkpointsVisible ? '' : 'none');
  els.toggleCheckpointsBtn.textContent = checkpointsVisible ? 'Hide Checkpoints' : 'Show Checkpoints';
}

function escapeAttr(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function exportCSV() {
  const legs = calculateLegs();
  const rows = [
    ['No.', 'From MGR', 'To MGR', 'Azimuth (mil)', 'Distance', 'Est. Time', 'Description', 'Remarks'],
    ...legs.map((x, i) => [i + 1, x.from.mgr, x.to.mgr, String(x.azimuth).padStart(4, '0'), formatDistance(x.distance), formatTime(x.seconds), x.description, x.remarks]),
  ];
  const csv = rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'navigational-data-sheet.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
