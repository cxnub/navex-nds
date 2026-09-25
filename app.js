/*
 * NAVEX NDS
 * See the checkpoints, plan a route between them and read off the MGR, azimuth and distance
 * of each leg for map-and-compass navigation.
 *
 * Map: MapTiler SDK (MapLibre). Grid maths: grid.js. Legs and route files: share.js.
 */

const MAPTILER_STORAGE_KEY = 'navex.maptiler.apiKey';
const ROUTE_STORAGE_KEY = 'navex.route';
const ROA_COLOR = '#22c55e';
const MAP_STYLES = {
  topo: maptilersdk.MapStyle.OUTDOOR,
  satellite: maptilersdk.MapStyle.HYBRID,
};

let map = null;
let mapStyle = 'topo';
let mapMarkers = [];
let checkpoints = []; // { id, name, type: 'CP' | 'SCP', mgr, lat, lng }
let route = [];       // { id, lat, lng, checkpointId }
let nextPointId = 1;
const els = {};

window.addEventListener('load', init);

function init() {
  [
    'importBtn', 'exportBtn', 'printBtn', 'mapKeyBtn', 'importFile',
    'cpForm', 'cpType', 'cpMgr', 'cpId', 'cpStatus', 'cpCount', 'checkpointList',
    'undoBtn', 'clearBtn', 'routeSummary', 'routeList', 'printSheet', 'mapHint',
    'apiKeyDialog', 'apiKeyForm', 'apiKeyInput', 'apiKeyStatus', 'apiKeyCancelBtn',
  ].forEach(id => { els[id] = document.getElementById(id); });

  checkpoints = loadCheckpoints();
  route = loadRoute();
  bindUI();
  renderPanel();

  const key = getStoredApiKey();
  if (key) initMap(key);
  else showApiKeyDialog(true);
}

function bindUI() {
  els.cpForm.addEventListener('submit', addCheckpoint);
  els.cpMgr.addEventListener('input', () => autoFormatMGRInput(els.cpMgr));
  els.checkpointList.addEventListener('click', event => {
    const target = event.target.closest('[data-route], [data-delete], [data-focus]');
    if (!target) return;
    const cp = findCheckpoint(target.dataset.route || target.dataset.delete || target.dataset.focus);
    if (!cp) return;
    if (target.dataset.route) addRoutePoint(cp, cp.id);
    else if (target.dataset.delete) removeCheckpoint(cp.id);
    else map?.flyTo({ center: [cp.lng, cp.lat], zoom: Math.max(map.getZoom(), 15) });
  });

  els.routeList.addEventListener('click', event => {
    const btn = event.target.closest('[data-remove]');
    if (btn) removeRoutePoint(Number(btn.dataset.remove));
  });
  els.undoBtn.addEventListener('click', () => { route.pop(); routeChanged(); });
  els.clearBtn.addEventListener('click', () => {
    if (route.length && confirm('Clear the whole route?')) { route = []; routeChanged(); }
  });

  els.exportBtn.addEventListener('click', exportFile);
  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => {
    const file = els.importFile.files[0];
    els.importFile.value = '';
    if (file) importFile(file);
  });
  els.printBtn.addEventListener('click', () => { renderPrintSheet(); window.print(); });

  document.querySelector('.map-style').addEventListener('click', event => {
    const btn = event.target.closest('[data-style]');
    if (!btn || btn.dataset.style === mapStyle) return;
    mapStyle = btn.dataset.style;
    document.querySelectorAll('.map-style [data-style]').forEach(b => b.classList.toggle('active', b === btn));
    map?.setStyle(MAP_STYLES[mapStyle]);
  });

  els.mapKeyBtn.addEventListener('click', () => showApiKeyDialog(false));
  els.apiKeyForm.addEventListener('submit', event => {
    event.preventDefault();
    const key = els.apiKeyInput.value.trim();
    if (!key) { els.apiKeyStatus.textContent = 'Enter a MapTiler API key.'; return; }
    try { localStorage.setItem(MAPTILER_STORAGE_KEY, key); } catch { /* map still loads for this session */ }
    els.apiKeyDialog.close();
    initMap(key);
  });
  els.apiKeyCancelBtn.addEventListener('click', () => els.apiKeyDialog.close());
  els.apiKeyDialog.addEventListener('cancel', event => { if (!getStoredApiKey()) event.preventDefault(); });
}

/* ---------- Storage ---------- */

function isCoord(p) {
  return Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng));
}

function loadCheckpoints() {
  return NavexShare.loadStoredCheckpoints().flatMap(cp => {
    try {
      const pos = isCoord(cp) ? { lat: Number(cp.lat), lng: Number(cp.lng) } : NavexGrid.mgrToLatLng(cp.mgr);
      return [{
        id: String(cp.id).toUpperCase(),
        name: String(cp.name || ''),
        type: String(cp.type).toUpperCase() === 'SCP' ? 'SCP' : 'CP',
        mgr: NavexGrid.formatMGR(pos.lat, pos.lng),
        ...pos,
      }];
    } catch { return []; }
  });
}

function saveCheckpoints() {
  NavexShare.saveStoredCheckpoints(checkpoints);
}

function loadRoute() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(ROUTE_STORAGE_KEY) || 'null'); } catch { saved = null; }
  return (Array.isArray(saved?.points) ? saved.points : []).filter(isCoord).map(makePoint);
}

function saveRoute() {
  try {
    localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({
      points: route.map(({ lat, lng, checkpointId }) => ({ lat, lng, checkpointId })),
    }));
  } catch (err) { console.warn('Could not save route:', err); }
}

function getStoredApiKey() {
  try { return localStorage.getItem(MAPTILER_STORAGE_KEY)?.trim() || ''; }
  catch { return ''; }
}

/* ---------- Map ---------- */

function showApiKeyDialog(required) {
  els.apiKeyStatus.textContent = required ? 'A MapTiler API key is required to load the map.' : '';
  els.apiKeyInput.value = getStoredApiKey();
  els.apiKeyCancelBtn.hidden = required;
  if (!els.apiKeyDialog.open) els.apiKeyDialog.showModal();
  setTimeout(() => els.apiKeyInput.focus(), 0);
}

function initMap(apiKey) {
  maptilersdk.config.apiKey = apiKey;
  if (map) map.remove();
  mapMarkers = [];
  map = new maptilersdk.Map({
    container: 'map',
    style: MAP_STYLES[mapStyle],
    center: [103.8198, 1.3521],
    zoom: 11,
    navigationControl: 'top-right',
    geolocateControl: 'top-right',
    scaleControl: 'bottom-left',
  });
  map.on('style.load', () => { addRouteLayer(); updateRouteLine(); });
  map.on('load', () => { drawMarkers(); fitTo([...route, ...checkpoints]); });
  map.on('click', event => addRoutePoint({ lat: event.lngLat.lat, lng: event.lngLat.lng }));
}

function routeGeoJSON() {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: route.length > 1 ? route.map(p => [p.lng, p.lat]) : [] },
  };
}

function addRouteLayer() {
  if (map.getSource('route')) return;
  map.addSource('route', { type: 'geojson', data: routeGeoJSON() });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ROA_COLOR, 'line-width': 3 },
  });
}

function updateRouteLine() {
  map?.getSource('route')?.setData(routeGeoJSON());
}

function drawMarkers() {
  if (!map) return;
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];

  checkpoints.forEach(cp => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `checkpoint-marker${cp.type === 'SCP' ? ' scp' : ''}`;
    el.title = `${cp.id} · ${cp.mgr} — tap to add to route`;
    const label = document.createElement('span');
    label.className = 'cp-label';
    label.textContent = cp.id;
    el.appendChild(label);
    el.addEventListener('click', event => { event.stopPropagation(); addRoutePoint(cp, cp.id); });
    mapMarkers.push(new maptilersdk.Marker({ element: el, anchor: 'center' }).setLngLat([cp.lng, cp.lat]).addTo(map));
  });

  route.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = `route-marker${p.checkpointId ? ' on-cp' : ''}`;
    el.title = `${NavexShare.pointLabel(p, i)} — drag to adjust`;
    el.addEventListener('click', event => event.stopPropagation());
    const marker = new maptilersdk.Marker({ element: el, anchor: 'center', draggable: !p.checkpointId })
      .setLngLat([p.lng, p.lat])
      .addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLngLat();
      p.lat = pos.lat;
      p.lng = pos.lng;
      routeChanged(false);
    });
    mapMarkers.push(marker);
  });
}

function fitTo(points) {
  if (!map || !points.length) return;
  if (points.length === 1) {
    map.jumpTo({ center: [points[0].lng, points[0].lat], zoom: 15 });
    return;
  }
  const bounds = new maptilersdk.LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat]);
  points.forEach(p => bounds.extend([p.lng, p.lat]));
  map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
}

/* ---------- Checkpoints ---------- */

function findCheckpoint(id) {
  const key = String(id || '').toUpperCase();
  return checkpoints.find(cp => cp.id === key);
}

function nextCheckpointId(type) {
  let n = 1;
  while (findCheckpoint(`${type}${n}`)) n++;
  return `${type}${n}`;
}

function addCheckpoint(event) {
  event.preventDefault();
  const type = els.cpType.value === 'SCP' ? 'SCP' : 'CP';
  const id = els.cpId.value.trim().toUpperCase() || nextCheckpointId(type);
  const raw = els.cpMgr.value.replace(/\s+/g, '');
  if (!/^\d{8}$/.test(raw)) { els.cpStatus.textContent = 'Enter an 8-digit MGR, e.g. 2846 5132.'; return; }
  if (findCheckpoint(id)) { els.cpStatus.textContent = `${id} already exists.`; return; }

  const pos = NavexGrid.mgrToLatLng(raw);
  const cp = { id, name: '', type, mgr: NavexGrid.formatMGR(pos.lat, pos.lng), ...pos };
  checkpoints.push(cp);
  saveCheckpoints();
  els.cpMgr.value = '';
  els.cpId.value = '';
  els.cpStatus.textContent = `${id} added at ${cp.mgr}.`;
  drawMarkers();
  renderPanel();
  map?.flyTo({ center: [cp.lng, cp.lat], zoom: Math.max(map.getZoom(), 14) });
  els.cpMgr.focus();
}

function removeCheckpoint(id) {
  const used = route.some(p => p.checkpointId === id);
  if (!confirm(used ? `Delete ${id}? It will also be removed from the route.` : `Delete ${id}?`)) return;
  checkpoints = checkpoints.filter(cp => cp.id !== id);
  route = route.filter(p => p.checkpointId !== id);
  saveCheckpoints();
  routeChanged();
}

function sortedCheckpoints() {
  return [...checkpoints].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/* ---------- Route ---------- */

function makePoint(p) {
  const cp = p.checkpointId ? findCheckpoint(p.checkpointId) : null;
  return cp
    ? { id: nextPointId++, lat: cp.lat, lng: cp.lng, checkpointId: cp.id }
    : { id: nextPointId++, lat: Number(p.lat), lng: Number(p.lng), checkpointId: null };
}

function addRoutePoint(pos, checkpointId = null) {
  if (checkpointId && route[route.length - 1]?.checkpointId === checkpointId) return;
  route.push(makePoint({ lat: pos.lat, lng: pos.lng, checkpointId }));
  routeChanged();
}

function removeRoutePoint(id) {
  route = route.filter(p => p.id !== id);
  routeChanged();
}

function routeChanged(redrawMarkers = true) {
  saveRoute();
  updateRouteLine();
  if (redrawMarkers) drawMarkers();
  renderPanel();
}

/* ---------- Export / import / print ---------- */

function exportFile() {
  if (!route.length && !checkpoints.length) {
    NavexShare.notify('Nothing to export yet.');
    return;
  }
  const data = NavexShare.buildRouteFile({ checkpoints, points: route });
  NavexShare.downloadRouteFile(data);
  NavexShare.notify(`Exported ${data.checkpoints.length} checkpoints and ${data.points.length} route points.`);
}

async function importFile(file) {
  let imported;
  try { imported = NavexShare.parseRouteFile(await file.text()); }
  catch (err) { NavexShare.notify(err.message); return; }
  if (route.length && !confirm(`Replace the current route (${route.length} points) with the imported one?`)) return;

  checkpoints = NavexShare.mergeCheckpoints(checkpoints, imported.checkpoints);
  saveCheckpoints();
  route = imported.points.map(makePoint);
  routeChanged();
  fitTo(route.length ? route : imported.checkpoints);
  NavexShare.notify(`Imported ${imported.checkpoints.length} checkpoints and ${imported.points.length} route points.`);
}

function renderPrintSheet() {
  const legs = NavexShare.buildLegs(route);
  const total = legs.reduce((sum, leg) => sum + leg.distance, 0);
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const legRows = legs.map(leg => `<tr>
      <td>${leg.no}</td><td>${esc(leg.from)}</td><td class="mono">${esc(leg.fromMgr)}</td>
      <td>${esc(leg.to)}</td><td class="mono">${esc(leg.toMgr)}</td>
      <td class="num">${leg.azimuth}</td><td class="num">${Math.round(leg.distance)}</td>
    </tr>`).join('');
  const cpRows = sortedCheckpoints().map(cp => `<tr><td>${esc(cp.id)}</td><td>${cp.type}</td><td class="mono">${esc(cp.mgr)}</td></tr>`).join('');
  els.printSheet.innerHTML = `
    <h1>Navigational Data Sheet</h1>
    <p>${esc(date)} · ${legs.length} leg${legs.length === 1 ? '' : 's'} · ${formatDistance(total)}</p>
    <table>
      <thead><tr><th>Leg</th><th>From</th><th>From MGR</th><th>To</th><th>To MGR</th><th>Azimuth (mils)</th><th>Distance (m)</th></tr></thead>
      <tbody>${legRows || '<tr><td colspan="7">No legs planned.</td></tr>'}</tbody>
    </table>
    ${cpRows ? `<h2>Checkpoints</h2><table class="cp-table"><thead><tr><th>ID</th><th>Type</th><th>MGR</th></tr></thead><tbody>${cpRows}</tbody></table>` : ''}`;
}

/* ---------- Panel ---------- */

function renderPanel() {
  renderCheckpoints();
  renderRoute();
}

function renderCheckpoints() {
  els.cpCount.textContent = checkpoints.length ? checkpoints.length : '';
  if (!checkpoints.length) {
    els.checkpointList.innerHTML = '<p class="empty">No checkpoints yet. Add one by MGR above.</p>';
    return;
  }
  const inRoute = new Set(route.map(p => p.checkpointId).filter(Boolean));
  els.checkpointList.innerHTML = sortedCheckpoints().map(cp => `
    <div class="cp-row" data-focus="${esc(cp.id)}" title="Show ${esc(cp.id)} on the map">
      <span class="cp-dot${cp.type === 'SCP' ? ' scp' : ''}"></span>
      <span class="cp-text">
        <span class="cp-id">${esc(cp.id)}</span>
        <span class="mgr">${esc(cp.mgr)}</span>
        ${inRoute.has(cp.id) ? '<span class="in-route">in route</span>' : ''}
      </span>
      <button class="small" data-route="${esc(cp.id)}" title="Add ${esc(cp.id)} to the route">+ Route</button>
      <button class="icon-btn" data-delete="${esc(cp.id)}" aria-label="Delete ${esc(cp.id)}" title="Delete ${esc(cp.id)}">×</button>
    </div>`).join('');
}

function renderRoute() {
  els.mapHint.hidden = route.length > 0;
  els.undoBtn.disabled = !route.length;
  els.clearBtn.disabled = !route.length;
  if (!route.length) {
    els.routeSummary.textContent = '';
    els.routeList.innerHTML = '<p class="empty">Tap the map to add route points, or tap a checkpoint to route to it.</p>';
    return;
  }

  const legs = NavexShare.buildLegs(route);
  const total = legs.reduce((sum, leg) => sum + leg.distance, 0);
  els.routeSummary.innerHTML = legs.length
    ? `<b>${legs.length}</b> leg${legs.length === 1 ? '' : 's'} · <b>${formatDistance(total)}</b> total`
    : 'Add another point to get the first leg.';

  const start = route[0];
  const startLabel = NavexShare.pointLabel(start, 0);
  els.routeList.innerHTML = `
    <div class="route-start">
      <span class="tag">Start</span>
      <strong>${esc(startLabel)}</strong>
      <span class="mgr">${esc(NavexGrid.formatMGR(start.lat, start.lng))}</span>
      <button class="icon-btn" data-remove="${start.id}" aria-label="Remove ${esc(startLabel)}" title="Remove ${esc(startLabel)}">×</button>
    </div>
    ${legs.map((leg, i) => `
    <div class="leg">
      <span class="leg-no">${leg.no}</span>
      <div class="leg-body">
        <div class="leg-to">to <strong>${esc(leg.to)}</strong> <span class="mgr">${esc(leg.toMgr)}</span></div>
        <div class="leg-nums">
          <div><b>${leg.azimuth}</b><span>mils</span></div>
          <div><b>${Math.round(leg.distance)}</b><span>m</span></div>
        </div>
      </div>
      <button class="icon-btn" data-remove="${route[i + 1].id}" aria-label="Remove ${esc(leg.to)}" title="Remove ${esc(leg.to)}">×</button>
    </div>`).join('')}`;
}

/* ---------- Helpers ---------- */

// Keep only digits and insert the easting/northing space after the 4th digit, preserving the caret.
function autoFormatMGRInput(input) {
  const caret = input.selectionStart ?? input.value.length;
  const digitsBeforeCaret = input.value.slice(0, caret).replace(/\D/g, '').length;
  const digits = input.value.replace(/\D/g, '').slice(0, 8);
  input.value = digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
  const pos = digitsBeforeCaret > 4 ? digitsBeforeCaret + 1 : digitsBeforeCaret;
  input.setSelectionRange(pos, pos);
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
