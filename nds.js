const ROUTE_STORAGE_KEY = 'navex.route';
const state = { speedKmh: 4, distanceUnit: 'm', mgrPrecision: 4 };
let points = [];

const els = {
  speed: document.getElementById('speed'),
  distanceUnit: document.getElementById('distanceUnit'),
  mgrPrecision: document.getElementById('mgrPrecision'),
  body: document.querySelector('#ndsTable tbody'),
  summary: document.getElementById('routeSummary'),
};

window.addEventListener('load', init);

function init() {
  loadRoute();
  els.speed.addEventListener('input', () => { state.speedKmh = Math.max(0.1, Number(els.speed.value) || 4); saveAndRender(); });
  els.distanceUnit.addEventListener('change', () => { state.distanceUnit = els.distanceUnit.value; saveAndRender(); });
  els.mgrPrecision.addEventListener('change', () => { state.mgrPrecision = Number(els.mgrPrecision.value) === 6 ? 6 : 4; saveAndRender(); });
  document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  render();
}

function loadRoute() {
  try {
    const saved = JSON.parse(localStorage.getItem(ROUTE_STORAGE_KEY) || 'null');
    if (saved?.settings) {
      state.speedKmh = Number(saved.settings.speedKmh) || 4;
      state.distanceUnit = saved.settings.distanceUnit === 'km' ? 'km' : 'm';
      state.mgrPrecision = Number(saved.settings.mgrPrecision) === 6 ? 6 : 4;
    }
    points = Array.isArray(saved?.points) ? saved.points.map(x => ({ ...x })) : [];
  } catch { points = []; }
  els.speed.value = state.speedKmh;
  els.distanceUnit.value = state.distanceUnit;
  els.mgrPrecision.value = state.mgrPrecision;
}

function saveAndRender() {
  try {
    localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({
      settings: { ...state }, points, savedAt: new Date().toISOString(),
    }));
  } catch {}
  render();
}

function calculateLegs() {
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const { distance, azimuth } = NavexGrid.leg(a, b);
    const seconds = distance / (state.speedKmh * 1000 / 3600);
    legs.push({ from:a, to:b, distance, seconds, azimuth });
  }
  return legs;
}

function formatDistance(m) { return state.distanceUnit === 'km' ? `${(m/1000).toFixed(2)} km` : `${Math.round(m)} m`; }
function formatTime(seconds) { const t=Math.round(seconds), h=Math.floor(t/3600), m=Math.floor((t%3600)/60), s=t%60; return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`; }
function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function render() {
  points.forEach(p => { p.mgr = NavexGrid.formatMGR(p.lat, p.lng, state.mgrPrecision); });
  const legs = calculateLegs();
  const totalDistance = legs.reduce((s,x)=>s+x.distance,0);
  const totalSeconds = legs.reduce((s,x)=>s+x.seconds,0);
  els.summary.textContent = `${legs.length} leg${legs.length===1?'':'s'} · ${formatDistance(totalDistance)} · ${formatTime(totalSeconds)}`;
  if (!legs.length) {
    els.body.innerHTML = `<tr><td colspan="9" class="empty">${points.length ? 'Plot at least two points to generate the NDS.' : 'No route has been plotted yet. Return to Plot Route.'}</td></tr>`;
    return;
  }
  els.body.innerHTML = legs.map((leg,i)=>`<tr>
    <td>${i+1}</td><td class="mgr-cell">${esc(leg.from.mgr||'—')}</td><td class="mgr-cell">${esc(leg.to.mgr||'—')}</td>
    <td class="az-cell">${String(leg.azimuth).padStart(4,'0')}</td><td class="dist-cell">${formatDistance(leg.distance)}</td><td class="time-cell">${formatTime(leg.seconds)}</td>
    <td><input class="cell-input" data-id="${leg.to.id}" data-field="description" value="${esc(leg.to.description)}" placeholder="Description"></td>
    <td><input class="cell-input" data-id="${leg.to.id}" data-field="remarks" value="${esc(leg.to.remarks)}" placeholder="Remarks"></td>
    <td><button class="delete-row" data-delete="${leg.to.id}">×</button></td>
  </tr>`).join('');
  els.body.querySelectorAll('[data-field]').forEach(input=>input.addEventListener('change',()=>{ const p=points.find(x=>String(x.id)===input.dataset.id); if(p){p[input.dataset.field]=input.value; saveAndRender();}}));
  els.body.querySelectorAll('[data-delete]').forEach(btn=>btn.addEventListener('click',()=>{ points=points.filter(x=>String(x.id)!==btn.dataset.delete); saveAndRender(); }));
}

function exportCSV() {
  const legs=calculateLegs();
  const rows=[['No.','From MGR','To MGR','Azimuth (mil)','Distance','Est. Time','Description','Remarks'],...legs.map((x,i)=>[i+1,x.from.mgr,x.to.mgr,String(x.azimuth).padStart(4,'0'),formatDistance(x.distance),formatTime(x.seconds),x.to.description||'',x.to.remarks||''])];
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download='navigational-data-sheet.csv'; a.click(); URL.revokeObjectURL(a.href);
}
