/*
 * NAVEX NDS
 * Adapted conceptually from Project NAVEX's scripts/index.js:
 * - Google Maps click-to-add markers
 * - draggable route points
 * - Kertau RSO / RSO Malaya (EPSG:3168) <-> WGS84 (EPSG:4326) conversion via epsg.io
 * - 6400-mil azimuth calculation
 *
 * Replace YOUR_GOOGLE_MAPS_API_KEY in index.html with a Google Maps browser key.
 */

let map;
let poly;
let markers = [];
let nextId = 1;
let activePointId = null;
let editingPointId = null;

const state = {
  speedKmh: 4.0,
  distanceUnit: 'm',
  mgrPrecision: 4,
};

const els = {};

window.initMap = function initMap() {
  Object.assign(els, {
    speed: document.getElementById('speed'),
    distanceUnit: document.getElementById('distanceUnit'),
    mgrPrecision: document.getElementById('mgrPrecision'),
    mgrInput: document.getElementById('mgrInput'),
    mgrStatus: document.getElementById('mgrStatus'),
    pointList: document.getElementById('pointList'),
    ndsBody: document.querySelector('#ndsTable tbody'),
    routeSummary: document.getElementById('routeSummary'),
    mapType: document.getElementById('mapType'),
    editDialog: document.getElementById('editDialog'),
    editDescription: document.getElementById('editDescription'),
    editRemarks: document.getElementById('editRemarks'),
  });

  map = new google.maps.Map(document.getElementById('map'), {
    zoom: 12,
    center: { lat: 1.3521, lng: 103.8198 },
    restriction: {
      latLngBounds: { north: 1.466878, south: 1.21186, west: 103.584676, east: 104.114079 },
      strictBounds: false,
    },
    mapTypeControl: false,
    clickableIcons: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  poly = new google.maps.Polyline({
    strokeColor: '#d5a84b',
    strokeOpacity: 0.95,
    strokeWeight: 3,
    map,
  });

  map.addListener('click', e => addPoint(e.latLng));

  bindUI();
  render();
};

function bindUI() {
  els.speed.addEventListener('input', () => { state.speedKmh = Math.max(0.1, Number(els.speed.value) || 4); render(); });
  els.distanceUnit.addEventListener('change', () => { state.distanceUnit = els.distanceUnit.value; render(); });
  els.mgrPrecision.addEventListener('change', () => { state.mgrPrecision = Number(els.mgrPrecision.value); render(); });
  els.mapType.addEventListener('change', () => map.setMapTypeId(els.mapType.value));
  document.getElementById('clearBtn').addEventListener('click', clearRoute);
  document.getElementById('addMgrBtn').addEventListener('click', addMGR);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);
  document.getElementById('addRowBtn').addEventListener('click', () => addBlankPoint());
  els.mgrInput.addEventListener('keydown', e => { if (e.key === 'Enter') addMGR(); });
}

function addPoint(latLng, mgr = null) {
  const point = {
    id: nextId++,
    lat: latLng.lat(),
    lng: latLng.lng(),
    mgr,
    description: '',
    remarks: '',
  };

  const marker = new google.maps.Marker({
    position: latLng,
    map,
    draggable: true,
    label: { text: String(markers.length + 1), color: '#ffffff', fontWeight: '700' },
  });

  marker.__pointId = point.id;
  marker.addListener('click', () => openPointEditor(point.id));
  marker.addListener('dragend', () => {
    point.lat = marker.getPosition().lat();
    point.lng = marker.getPosition().lng();
    point.mgr = null;
    syncPolyline();
    convertAllMGRs().then(render).catch(() => render());
  });

  markers.push({ point, marker });
  syncPolyline();
  convertAllMGRs().then(render).catch(() => render());
}

function addBlankPoint() {
  if (!markers.length) {
    addPoint(new google.maps.LatLng(1.3521, 103.8198));
  } else {
    const last = markers[markers.length - 1].point;
    addPoint(new google.maps.LatLng(last.lat + 0.001, last.lng + 0.001));
  }
}

function removePoint(id) {
  const i = markers.findIndex(x => x.point.id === id);
  if (i < 0) return;
  markers[i].marker.setMap(null);
  markers.splice(i, 1);
  renumberMarkers();
  syncPolyline();
  convertAllMGRs().then(render).catch(() => render());
}

function renumberMarkers() {
  markers.forEach((x, i) => x.marker.setLabel({ text: String(i + 1), color: '#ffffff', fontWeight: '700' }));
}

function syncPolyline() {
  poly.setPath(markers.map(x => x.marker.getPosition()));
}

function clearRoute() {
  markers.forEach(x => x.marker.setMap(null));
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

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('editForm');
  form?.addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    const item = markers.find(x => x.point.id === editingPointId);
    if (!item) return;
    item.point.description = els.editDescription.value.trim();
    item.point.remarks = els.editRemarks.value.trim();
    render();
  });
});

function addMGR() {
  const raw = els.mgrInput.value.replace(/\s+/g, '');
  if (!/^\d{8}$/.test(raw)) {
    els.mgrStatus.textContent = 'Invalid MGR. Enter exactly 8 digits, e.g. 28465132.';
    return;
  }

  els.mgrStatus.textContent = 'Converting MGR…';
  const e = raw.slice(0, 4);
  const n = raw.slice(4, 8);
  const x = `6${e}0`;
  const y = `1${n}0`;
  jsonp(`https://epsg.io/trans?x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}&s_srs=3168&t_srs=4326`, response => {
    try {
      const latLng = new google.maps.LatLng(Number(response.y), Number(response.x));
      addPoint(latLng, `${e} ${n}`);
      map.panTo(latLng);
      els.mgrInput.value = '';
      els.mgrStatus.textContent = 'MGR plotted.';
    } catch (err) {
      els.mgrStatus.textContent = 'MGR conversion failed.';
    }
  });
}

async function convertAllMGRs() {
  if (!markers.length) return [];
  const data = markers.map(x => `${x.point.lng},${x.point.lat}`).join(';');
  return new Promise((resolve, reject) => {
    jsonp(`https://epsg.io/trans?data=${encodeURIComponent(data)}&s_srs=4326&t_srs=3168`, response => {
      try {
        response.forEach((p, i) => {
          const e = String(p.x).replace(/\D/g, '').slice(0, 6);
          const n = String(p.y).replace(/\D/g, '').slice(0, 6);
          markers[i].point.mgr = formatMGRDigits(e, n, state.mgrPrecision);
        });
        resolve(response);
      } catch (err) { reject(err); }
    });
  });
}

function formatMGRDigits(e, n, precision) {
  if (!e || !n) return '—';
  return `${e.slice(0, precision)} ${n.slice(0, precision)}`;
}

function jsonp(url, callback) {
  const cb = `navexCallback_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const script = document.createElement('script');
  window[cb] = data => {
    delete window[cb];
    script.remove();
    callback(data);
  };
  script.onerror = () => {
    delete window[cb];
    script.remove();
    callback(null);
  };
  script.src = `${url}&callback=${cb}`;
  document.body.appendChild(script);
}

function calculateLegs() {
  const legs = [];
  for (let i = 0; i < markers.length - 1; i++) {
    const a = markers[i].point;
    const b = markers[i + 1].point;
    const e1 = mgrNumber(a.mgr, 0);
    const n1 = mgrNumber(a.mgr, 1);
    const e2 = mgrNumber(b.mgr, 0);
    const n2 = mgrNumber(b.mgr, 1);
    const eDiff = e2 - e1;
    const nDiff = n2 - n1;
    const gridUnitMeters = state.mgrPrecision === 6 ? 10 : 100;
    const distance = Math.sqrt(eDiff ** 2 + nDiff ** 2) * gridUnitMeters;
    const azimuth = calcAzimuth(eDiff, nDiff);
    const seconds = distance / (state.speedKmh * 1000 / 3600);
    legs.push({
      from: a,
      to: b,
      distance,
      azimuth,
      seconds,
      description: b.description || '',
      remarks: b.remarks || '',
    });
  }
  return legs;
}

function mgrNumber(mgr, index) {
  if (!mgr || mgr === '—') return 0;
  return Number(mgr.replace(/\s/g, '').slice(index * state.mgrPrecision, (index + 1) * state.mgrPrecision));
}

function calcAzimuth(eDiff, nDiff) {
  if (eDiff === 0) return nDiff >= 0 ? 6400 : 3200;
  let angle = Math.atan(nDiff / eDiff);
  let mil = eDiff > 0 ? 1600 - (angle / (2 * Math.PI)) * 6400 : 4800 - (angle / (2 * Math.PI)) * 6400;
  mil = Math.round(mil);
  return ((mil % 6400) + 6400) % 6400;
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
  const legs = calculateLegs();
  renderPointList();
  renderTable(legs);
  const totalDistance = legs.reduce((s, x) => s + x.distance, 0);
  const totalSeconds = legs.reduce((s, x) => s + x.seconds, 0);
  els.routeSummary.textContent = `${legs.length} leg${legs.length === 1 ? '' : 's'} · ${formatDistance(totalDistance)} · ${formatTime(totalSeconds)}`;
}

function renderPointList() {
  if (!markers.length) {
    els.pointList.innerHTML = '<div class="empty">No route points. Click the map to add one.</div>';
    return;
  }
  els.pointList.innerHTML = markers.map((x, i) => `
    <div class="point-item">
      <span class="num">${i + 1}</span>
      <span class="mgr">${x.point.mgr || 'Converting…'}</span>
      <button class="icon-btn" data-delete="${x.point.id}">×</button>
    </div>`).join('');
  els.pointList.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => removePoint(Number(btn.dataset.delete))));
}

function renderTable(legs) {
  if (!legs.length) {
    els.ndsBody.innerHTML = '<tr><td colspan="9" class="empty">Plot at least two points to generate the NDS.</td></tr>';
    return;
  }
  els.ndsBody.innerHTML = legs.map((leg, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="mgr-cell">${leg.from.mgr || '—'}</td>
      <td class="mgr-cell">${leg.to.mgr || '—'}</td>
      <td class="az-cell">${String(leg.azimuth).padStart(4, '0')}</td>
      <td class="dist-cell">${formatDistance(leg.distance)}</td>
      <td class="time-cell">${formatTime(leg.seconds)}</td>
      <td><input class="cell-input" data-desc="${leg.to.id}" value="${escapeAttr(leg.description)}" placeholder="Description"></td>
      <td><input class="cell-input" data-remarks="${leg.to.id}" value="${escapeAttr(leg.remarks)}" placeholder="Remarks"></td>
      <td><button class="delete-row" data-delete-row="${leg.to.id}">×</button></td>
    </tr>`).join('');

  els.ndsBody.querySelectorAll('[data-desc]').forEach(input => input.addEventListener('change', () => updatePointField(Number(input.dataset.desc), 'description', input.value)));
  els.ndsBody.querySelectorAll('[data-remarks]').forEach(input => input.addEventListener('change', () => updatePointField(Number(input.dataset.remarks), 'remarks', input.value)));
  els.ndsBody.querySelectorAll('[data-delete-row]').forEach(btn => btn.addEventListener('click', () => removePoint(Number(btn.dataset.deleteRow))));
}

function updatePointField(id, field, value) {
  const item = markers.find(x => x.point.id === id);
  if (item) item.point[field] = value;
}

function escapeAttr(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
