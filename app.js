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

// 2005 1:50,000 topographic map of Singapore (NUS Libraries WMTS, Web Mercator). Note the {y}/{x} order.
const OVERLAY_STORAGE_KEY = 'navex.overlay';
const TOPO50K = {
  tiles: ['https://libmaps.nus.edu.sg/services/2005_50K/{z}/{y}/{x}'],
  bounds: [103.546, 1.104, 104.162, 1.533],
  minzoom: 9,
  maxzoom: 16,
};
const overlay = loadOverlaySettings();
let mapMarkers = [];
let checkpoints = []; // { id, name, type: 'CP' | 'SCP', mgr, lat, lng }
let route = [];       // { id, lat, lng, checkpointId, description, remarks }
let nextPointId = 1;
let speedKmh = 4;
const els = {};

window.addEventListener('load', init);

function init() {
  [
    'ndsBtn', 'importBtn', 'exportBtn', 'mapKeyBtn', 'importFile',
    'ndsDialog', 'ndsSummary', 'ndsSpeed', 'ndsTable', 'ndsPrintBtn', 'ndsCloseBtn',
    'cpForm', 'cpType', 'cpMgr', 'cpId', 'cpStatus', 'cpCount', 'checkpointList',
    'undoBtn', 'clearBtn', 'routeSummary', 'routeList', 'printSheet', 'mapHint',
    'overlayToggle', 'overlayOpacity', 'overlayOpacityValue',
    'apiKeyDialog', 'apiKeyForm', 'apiKeyInput', 'apiKeyStatus', 'apiKeyCancelBtn',
  ].forEach(id => { els[id] = document.getElementById(id); });

  checkpoints = loadCheckpoints();
  route = loadRoute();
  normalizeRoute();
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
    const remove = event.target.closest('[data-remove]');
    if (remove) { removeRoutePoint(Number(remove.dataset.remove)); return; }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) toggleSection(toggle);
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
  els.ndsBtn.addEventListener('click', openNds);
  els.ndsCloseBtn.addEventListener('click', () => els.ndsDialog.close());
  els.ndsPrintBtn.addEventListener('click', () => { renderPrintSheet(); window.print(); });
  els.ndsSpeed.addEventListener('input', () => {
    speedKmh = NavexShare.normalizeSpeed(els.ndsSpeed.value);
    saveRoute();
    renderNds();
  });
  els.ndsTable.addEventListener('input', event => {
    const input = event.target.closest('[data-field]');
    const point = input && route.find(p => p.id === Number(input.dataset.point));
    if (!point) return;
    point[input.dataset.field] = input.value;
    saveRoute();
  });

  renderOverlayControls();
  els.overlayToggle.addEventListener('change', () => {
    overlay.on = els.overlayToggle.checked;
    applyOverlay();
  });
  els.overlayOpacity.addEventListener('input', () => {
    overlay.opacity = Number(els.overlayOpacity.value) / 100;
    applyOverlay();
  });

  document.querySelector('.map-style').addEventListener('click', event => {
    const btn = event.target.closest('[data-style]');
    if (!btn || btn.dataset.style === mapStyle) return;
    mapStyle = btn.dataset.style;
    document.querySelectorAll('.map-style [data-style]').forEach(b => b.classList.toggle('active', b === btn));
    // diff: false forces a full reload so 'style.load' fires and re-adds the overlay and route layers;
    // a diffed style change silently drops layers that aren't in the new style.
    map?.setStyle(MAP_STYLES[mapStyle], { diff: false });
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
  speedKmh = NavexShare.normalizeSpeed(saved?.settings?.speedKmh);
  return (Array.isArray(saved?.points) ? saved.points : []).filter(isCoord).map(makePoint);
}

function saveRoute() {
  try {
    localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({
      settings: { speedKmh },
      points: route.map(({ lat, lng, checkpointId, description, remarks }) => ({ lat, lng, checkpointId, description, remarks })),
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
  map.on('style.load', () => { addOverlayLayer(); addRouteLayer(); updateRouteLine(); });
  map.on('load', () => { drawMarkers(); fitTo([...route, ...checkpoints]); });
  map.on('click', event => {
    if (!route.length) {
      NavexShare.notify(checkpoints.length ? 'Start the route at a checkpoint: tap a checkpoint first.' : 'Add a checkpoint first, then start the route from it.');
      return;
    }
    addRoutePoint({ lat: event.lngLat.lat, lng: event.lngLat.lng });
  });
}

function loadOverlaySettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY) || 'null');
    const opacity = Number(saved?.opacity);
    return { on: Boolean(saved?.on), opacity: opacity >= 0.1 && opacity <= 1 ? opacity : 0.7 };
  } catch { return { on: false, opacity: 0.7 }; }
}

function renderOverlayControls() {
  els.overlayToggle.checked = overlay.on;
  els.overlayOpacity.value = Math.round(overlay.opacity * 100);
  els.overlayOpacityValue.textContent = `${Math.round(overlay.opacity * 100)}%`;
  els.overlayOpacity.parentElement.hidden = !overlay.on;
}

// The 1:50K map sits above the base map and below the route line.
function addOverlayLayer() {
  if (map.getSource('topo50k')) return;
  map.addSource('topo50k', {
    type: 'raster',
    tileSize: 256,
    attribution: '1:50,000 map (2005) via NUS Libraries',
    ...TOPO50K,
  });
  map.addLayer({
    id: 'topo50k',
    type: 'raster',
    source: 'topo50k',
    layout: { visibility: overlay.on ? 'visible' : 'none' },
    paint: { 'raster-opacity': overlay.opacity },
  }, map.getLayer('route-line') ? 'route-line' : undefined);
}

function applyOverlay() {
  renderOverlayControls();
  try { localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(overlay)); } catch { /* not persisted */ }
  if (!map?.getLayer('topo50k')) return;
  map.setLayoutProperty('topo50k', 'visibility', overlay.on ? 'visible' : 'none');
  map.setPaintProperty('topo50k', 'raster-opacity', overlay.opacity);
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

  const labels = NavexShare.pointLabels(route);
  route.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = `route-marker${p.checkpointId ? ' on-cp' : ''}`;
    el.title = `${labels[i]} — drag to adjust`;
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
  return {
    id: nextPointId++,
    lat: cp ? cp.lat : Number(p.lat),
    lng: cp ? cp.lng : Number(p.lng),
    checkpointId: cp ? cp.id : null,
    description: String(p.description || ''),
    remarks: String(p.remarks || ''),
  };
}

function addRoutePoint(pos, checkpointId = null) {
  if (checkpointId && route[route.length - 1]?.checkpointId === checkpointId) return;
  route.push(makePoint({ lat: pos.lat, lng: pos.lng, checkpointId }));
  routeChanged();
}

// Waypoints must sit between checkpoints: drop any before the first checkpoint.
function normalizeRoute() {
  const first = route.findIndex(p => p.checkpointId);
  const dropped = first < 0 ? route.length : first;
  if (dropped) route = route.slice(dropped);
  return dropped;
}

// Checkpoint-to-checkpoint sections as [from, to] indexes into the route.
// The last section is open when waypoints follow the last checkpoint.
function routeSections() {
  const sections = [];
  let from = 0;
  for (let i = 1; i < route.length; i++) {
    if (route[i].checkpointId) {
      sections.push({ from, to: i, open: false });
      from = i;
    }
  }
  if (from < route.length - 1) sections.push({ from, to: route.length - 1, open: true });
  return sections;
}

// Rebuild the route from the waypoint order in each section after a drag.
// Section i always starts at the i-th checkpoint of the route.
function applyWaypointOrder() {
  const byId = new Map(route.map(p => [p.id, p]));
  const bodies = [...els.routeList.querySelectorAll('.section-body')];
  route = route.filter(p => p.checkpointId).flatMap((anchor, i) => [
    anchor,
    ...[...(bodies[i]?.querySelectorAll('[data-wp-id]') ?? [])].map(el => byId.get(Number(el.dataset.wpId))),
  ]);
  routeChanged();
}

function removeRoutePoint(id) {
  const index = route.findIndex(p => p.id === id);
  if (index < 0) return;
  if (index === 0) {
    const nextCp = route.slice(1).findIndex(p => p.checkpointId);
    const orphans = nextCp < 0 ? route.length - 1 : nextCp;
    if (orphans && !confirm(`Removing the start checkpoint also removes the ${orphans} waypoint${orphans === 1 ? '' : 's'} before the next checkpoint. Continue?`)) return;
  }
  route.splice(index, 1);
  routeChanged();
}

function routeChanged(redrawMarkers = true) {
  const dropped = normalizeRoute();
  if (dropped) NavexShare.notify(`Removed ${dropped} waypoint${dropped === 1 ? '' : 's'} that came before the first checkpoint.`);
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
  const data = NavexShare.buildRouteFile({ checkpoints, points: route, speedKmh });
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
  speedKmh = imported.speedKmh;
  routeChanged();
  fitTo(route.length ? route : imported.checkpoints);
  NavexShare.notify(`Imported ${imported.checkpoints.length} checkpoints and ${imported.points.length} route points.`);
}

function legSeconds(leg) {
  return NavexShare.travelSeconds(leg.distance, speedKmh);
}

function ndsSummary(legs) {
  const distance = legs.reduce((sum, leg) => sum + leg.distance, 0);
  const seconds = legs.reduce((sum, leg) => sum + legSeconds(leg), 0);
  return `${legs.length} leg${legs.length === 1 ? '' : 's'} · ${formatDistance(distance)} · ${NavexShare.formatTime(seconds)} at ${speedKmh} km/h`;
}

// The NDS table, grouped by section. Description and Remarks are inputs on screen and text in print.
function ndsTableHtml(legs, editable) {
  const cell = (leg, point, field, label) => editable
    ? `<input class="nds-input" data-point="${point.id}" data-field="${field}" value="${esc(point[field])}" placeholder="${label}" aria-label="${label}, leg ${leg.no}">`
    : esc(point[field]);
  const rows = routeSections().map(section => {
    const sectionLegs = legs.slice(section.from, section.to);
    const distance = sectionLegs.reduce((sum, leg) => sum + leg.distance, 0);
    const seconds = sectionLegs.reduce((sum, leg) => sum + legSeconds(leg), 0);
    return `<tr class="section-row"><td colspan="8">${esc(sectionLegs[0].section)} · ${formatDistance(distance)} · ${NavexShare.formatTime(seconds)}</td></tr>`
      + sectionLegs.map(leg => {
        const to = route[leg.no];
        return `<tr>
          <td class="num">${leg.no}</td>
          <td class="mono">${esc(leg.fromMgr)}</td>
          <td class="mono">${esc(leg.toMgr)}</td>
          <td class="mono num">${leg.azimuth}</td>
          <td class="mono num">${Math.round(leg.distance)} m</td>
          <td class="mono num">${NavexShare.formatTime(legSeconds(leg))}</td>
          <td class="text">${cell(leg, to, 'description', 'Description')}</td>
          <td class="text">${cell(leg, to, 'remarks', 'Remarks')}</td>
        </tr>`;
      }).join('');
  }).join('');
  return `<table class="nds-table">
    <thead><tr><th>No.</th><th>From MGR</th><th>To MGR</th><th>Azimuth</th><th>Distance</th><th>Est. Time</th><th>Description</th><th>Remarks</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="8" class="empty">No legs planned yet.</td></tr>'}</tbody>
  </table>`;
}

function openNds() {
  els.ndsSpeed.value = speedKmh;
  renderNds();
  els.ndsDialog.showModal();
}

function renderNds() {
  const legs = NavexShare.buildLegs(route);
  els.ndsSummary.textContent = ndsSummary(legs);
  els.ndsTable.innerHTML = ndsTableHtml(legs, true);
}

function renderPrintSheet() {
  const legs = NavexShare.buildLegs(route);
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const cpRows = sortedCheckpoints().map(cp => `<tr><td>${esc(cp.id)}</td><td>${cp.type}</td><td class="mono">${esc(cp.mgr)}</td></tr>`).join('');
  els.printSheet.innerHTML = `
    <h1>Navigational Data Sheet</h1>
    <p>${esc(date)} · ${esc(ndsSummary(legs))}</p>
    ${ndsTableHtml(legs, false)}
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

const collapsedSections = new Set();

function sectionKey(section) {
  return `${route[section.from].id}-${section.open ? 'open' : route[section.to].id}`;
}

function toggleSection(button) {
  const key = button.dataset.toggle;
  const collapsed = !collapsedSections.has(key);
  if (collapsed) collapsedSections.add(key);
  else collapsedSections.delete(key);
  button.closest('.section').classList.toggle('collapsed', collapsed);
  button.setAttribute('aria-expanded', String(!collapsed));
}

function renderRoute() {
  els.mapHint.hidden = route.length > 0;
  els.undoBtn.disabled = !route.length;
  els.clearBtn.disabled = !route.length;
  if (!route.length) {
    els.routeSummary.textContent = '';
    els.routeList.innerHTML = `<p class="empty">${checkpoints.length
      ? 'Tap a checkpoint (on the map or + Route) to start the route.'
      : 'Add checkpoints above, then tap one to start the route.'}</p>`;
    return;
  }

  const labels = NavexShare.pointLabels(route);
  const legs = NavexShare.buildLegs(route);
  const total = legs.reduce((sum, leg) => sum + leg.distance, 0);
  els.routeSummary.innerHTML = legs.length
    ? `<b>${legs.length}</b> leg${legs.length === 1 ? '' : 's'} · <b>${formatDistance(total)}</b> total`
    : 'Tap the map to add waypoints, or tap the next checkpoint.';

  const start = route[0];
  const sections = routeSections().map(section => {
    const key = sectionKey(section);
    const collapsed = !section.open && collapsedSections.has(key);
    const sectionLegs = legs.slice(section.from, section.to);
    const distance = sectionLegs.reduce((sum, leg) => sum + leg.distance, 0);
    const toLabel = section.open ? 'next checkpoint' : labels[section.to];
    return `
    <section class="section${section.open ? ' open' : ''}${collapsed ? ' collapsed' : ''}">
      <button type="button" class="section-head"${section.open ? '' : ` data-toggle="${key}" aria-expanded="${!collapsed}"`}>
        <span class="chev" aria-hidden="true">${section.open ? '' : '▾'}</span>
        <span class="section-title"><strong>${esc(labels[section.from])}</strong> → <strong>${esc(toLabel)}</strong></span>
        <span class="section-meta">${sectionLegs.length} leg${sectionLegs.length === 1 ? '' : 's'} · ${formatDistance(distance)}</span>
      </button>
      <div class="section-body">
        ${sectionLegs.map(leg => legCard(leg, route[leg.no])).join('')}
        ${section.open ? '<p class="section-hint">Tap the map to add waypoints, then tap a checkpoint to close this section.</p>' : ''}
      </div>
    </section>`;
  }).join('');

  els.routeList.innerHTML = `
    <div class="route-start">
      <span class="tag">Start</span>
      <strong>${esc(labels[0])}</strong>
      <span class="mgr">${esc(NavexGrid.formatMGR(start.lat, start.lng))}</span>
      <button class="icon-btn" data-remove="${start.id}" aria-label="Remove ${esc(labels[0])}" title="Remove ${esc(labels[0])}">×</button>
    </div>
    ${sections}`;

  // Waypoints can be dragged within a section or into another one; checkpoints stay fixed.
  els.routeList.querySelectorAll('.section-body').forEach(body => Sortable.create(body, {
    group: 'waypoints',
    handle: '.drag-handle',
    draggable: '[data-wp-id]',
    animation: 150,
    onMove: event => !(event.related.classList.contains('leg-end') && event.willInsertAfter),
    onEnd: event => { if (event.from !== event.to || event.oldIndex !== event.newIndex) applyWaypointOrder(); },
  }));
}

function legCard(leg, point) {
  const isWaypoint = !point.checkpointId;
  return `
    <div class="leg${isWaypoint ? '' : ' leg-end'}"${isWaypoint ? ` data-wp-id="${point.id}"` : ''}>
      <span class="drag-handle${isWaypoint ? '' : ' placeholder'}"${isWaypoint ? ' title="Drag to reorder"' : ''} aria-hidden="true">⠿</span>
      <span class="leg-no">${leg.no}</span>
      <div class="leg-body">
        <div class="leg-to">to <strong>${esc(leg.to)}</strong> <span class="mgr">${esc(leg.toMgr)}</span></div>
        <div class="leg-nums">
          <div><b>${leg.azimuth}</b><span>mils</span></div>
          <div><b>${Math.round(leg.distance)}</b><span>m</span></div>
        </div>
      </div>
      <button class="icon-btn" data-remove="${point.id}" aria-label="Remove ${esc(leg.to)}" title="Remove ${esc(leg.to)}">×</button>
    </div>`;
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
