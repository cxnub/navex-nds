/*
 * Route legs and route files (export/import). Requires grid.js.
 * A route file holds all checkpoints, the route points and the NDS legs.
 */
(function () {
  const FORMAT = 'navex-nds-route';
  const VERSION = 3;
  const CHECKPOINT_STORAGE_KEY = 'navex.checkpoints';

  function formatTime(seconds) {
    const t = Math.round(seconds), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function travelSeconds(distance, speedKmh) {
    return distance / (speedKmh * 1000 / 3600);
  }

  function normalizeSpeed(value) {
    return Math.max(0.1, Number(value) || 4);
  }

  // Checkpoints are labelled by their ID; waypoints are numbered WP1, WP2, … along the route.
  function pointLabels(points) {
    let n = 0;
    return points.map(p => p.checkpointId || `WP${++n}`);
  }

  // Each leg also carries its section: the checkpoint-to-checkpoint group it belongs to.
  function buildLegs(points) {
    const labels = pointLabels(points);
    let sectionFrom = null;
    return points.slice(1).map((to, i) => {
      const from = points[i];
      if (from.checkpointId) sectionFrom = from.checkpointId;
      const nextCp = points.slice(i + 1).find(p => p.checkpointId);
      const { distance, azimuth } = NavexGrid.leg(from, to);
      return {
        no: i + 1,
        section: `${sectionFrom || '…'} → ${nextCp ? nextCp.checkpointId : '…'}`,
        from: labels[i],
        to: labels[i + 1],
        fromMgr: NavexGrid.formatMGR(from.lat, from.lng),
        toMgr: NavexGrid.formatMGR(to.lat, to.lng),
        azimuth: String(azimuth).padStart(4, '0'),
        distance,
      };
    });
  }

  function buildRouteFile({ checkpoints, points, speedKmh }) {
    const labels = pointLabels(points);
    const speed = normalizeSpeed(speedKmh);
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      settings: { speedKmh: speed },
      checkpoints: checkpoints.map(({ id, name, type, mgr, lat, lng }) => ({ id, name: name || '', type, mgr, lat, lng })),
      points: points.map((p, i) => ({
        label: labels[i],
        mgr: NavexGrid.formatMGR(p.lat, p.lng),
        lat: p.lat,
        lng: p.lng,
        checkpointId: p.checkpointId || null,
        description: p.description || '',
        remarks: p.remarks || '',
      })),
      nds: buildLegs(points).map(leg => ({
        leg: leg.no,
        section: leg.section,
        from: leg.from,
        fromMgr: leg.fromMgr,
        to: leg.to,
        toMgr: leg.toMgr,
        azimuthMils: leg.azimuth,
        distanceM: Math.round(leg.distance),
        estTime: formatTime(travelSeconds(leg.distance, speed)),
        description: points[leg.no].description || '',
        remarks: points[leg.no].remarks || '',
      })),
    };
  }

  // Returns { checkpoints, points, speedKmh }; throws with a user-facing message on bad input.
  // Also reads files from earlier versions. The nds section is informational: legs are recalculated.
  function parseRouteFile(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Not a valid route file.'); }
    if (data?.format !== FORMAT || !Array.isArray(data.points)) throw new Error('Not a NAVEX route file.');

    const isCoord = p => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng));
    const checkpoints = (Array.isArray(data.checkpoints) ? data.checkpoints : [])
      .filter(cp => cp && cp.id && isCoord(cp))
      .map(cp => ({
        id: String(cp.id).toUpperCase(),
        name: String(cp.name || ''),
        type: String(cp.type).toUpperCase() === 'SCP' ? 'SCP' : 'CP',
        mgr: NavexGrid.formatMGR(cp.lat, cp.lng),
        lat: Number(cp.lat),
        lng: Number(cp.lng),
      }));
    const cpIds = new Set(checkpoints.map(cp => cp.id));
    const points = data.points.filter(isCoord).map(p => {
      const checkpointId = p.checkpointId ? String(p.checkpointId).toUpperCase() : null;
      return {
        lat: Number(p.lat),
        lng: Number(p.lng),
        checkpointId: cpIds.has(checkpointId) ? checkpointId : null,
        description: String(p.description || ''),
        remarks: String(p.remarks || ''),
      };
    });
    if (!points.length && !checkpoints.length) throw new Error('The file has no route points or checkpoints.');
    return { checkpoints, points, speedKmh: normalizeSpeed(data.settings?.speedKmh) };
  }

  // Imported checkpoints replace local ones with the same ID; other local checkpoints are kept.
  function mergeCheckpoints(local, imported) {
    const ids = new Set(imported.map(cp => cp.id));
    return local.filter(cp => !ids.has(String(cp.id).toUpperCase())).concat(imported);
  }

  function loadStoredCheckpoints() {
    try {
      const saved = JSON.parse(localStorage.getItem(CHECKPOINT_STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter(cp => cp && cp.id) : [];
    } catch { return []; }
  }

  function saveStoredCheckpoints(checkpoints) {
    try { localStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(checkpoints)); }
    catch (err) { console.warn('Could not save checkpoints:', err); }
  }

  function downloadRouteFile(data) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `navex-nds-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let toastTimer;
  function notify(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  }

  window.NavexShare = {
    formatTime, travelSeconds, normalizeSpeed, pointLabels, buildLegs, buildRouteFile, parseRouteFile, mergeCheckpoints,
    loadStoredCheckpoints, saveStoredCheckpoints, downloadRouteFile, notify,
  };
})();
