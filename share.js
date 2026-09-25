/*
 * Route file export/import, shared by the plot page and the NDS page.
 * A route file holds the settings, all checkpoints, the route points and the NDS as displayed.
 * Requires grid.js.
 */
(function () {
  const FORMAT = 'navex-nds-route';
  const VERSION = 2;
  const CHECKPOINT_STORAGE_KEY = 'navex.checkpoints';

  function formatDistance(m, unit) {
    return unit === 'km' ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
  }

  function formatTime(seconds) {
    const t = Math.round(seconds), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function buildNDS(points, settings) {
    const rows = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const { distance, azimuth } = NavexGrid.leg(a, b);
      rows.push({
        no: i + 1,
        fromMgr: NavexGrid.formatMGR(a.lat, a.lng, settings.mgrPrecision),
        toMgr: NavexGrid.formatMGR(b.lat, b.lng, settings.mgrPrecision),
        azimuth: String(azimuth).padStart(4, '0'),
        distance: formatDistance(distance, settings.distanceUnit),
        estTime: formatTime(distance / (settings.speedKmh * 1000 / 3600)),
        description: b.description || '',
        remarks: b.remarks || '',
      });
    }
    return rows;
  }

  function normalizeSettings(settings = {}) {
    return {
      speedKmh: Math.max(0.1, Number(settings.speedKmh) || 4),
      distanceUnit: settings.distanceUnit === 'km' ? 'km' : 'm',
      mgrPrecision: Number(settings.mgrPrecision) === 6 ? 6 : 4,
    };
  }

  function buildRouteFile({ settings, checkpoints, points }) {
    const s = normalizeSettings(settings);
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      settings: s,
      checkpoints: checkpoints.map(cp => ({
        id: cp.id, name: cp.name || '', type: cp.type, mgr: cp.mgr, lat: cp.lat, lng: cp.lng,
      })),
      points: points.map(p => ({
        lat: p.lat,
        lng: p.lng,
        mgr: NavexGrid.formatMGR(p.lat, p.lng, 4),
        description: p.description || '',
        remarks: p.remarks || '',
        checkpointId: p.checkpointId || null,
        checkpointType: p.checkpointType || null,
        fixed: Boolean(p.fixed),
      })),
      nds: buildNDS(points, s),
    };
  }

  // Returns { settings, checkpoints, points }; throws with a user-facing message on bad input.
  // The file's nds section is informational: the NDS is always recalculated from the points.
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
        mgr: NavexGrid.formatMGR(cp.lat, cp.lng, 4),
        lat: Number(cp.lat),
        lng: Number(cp.lng),
      }));
    const cpIds = new Set(checkpoints.map(cp => cp.id));
    const points = data.points.filter(isCoord).map(p => {
      const checkpointId = p.checkpointId ? String(p.checkpointId).toUpperCase() : null;
      const linked = Boolean(checkpointId && cpIds.has(checkpointId));
      return {
        lat: Number(p.lat),
        lng: Number(p.lng),
        description: String(p.description || ''),
        remarks: String(p.remarks || ''),
        checkpointId: linked ? checkpointId : null,
        checkpointType: linked ? p.checkpointType || null : null,
        fixed: linked && Boolean(p.fixed),
      };
    });
    if (!points.length && !checkpoints.length) throw new Error('The file has no route points or checkpoints.');
    return { settings: normalizeSettings(data.settings), checkpoints, points };
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
    a.download = `navex-route-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  window.NavexShare = {
    buildRouteFile, parseRouteFile, mergeCheckpoints, downloadRouteFile,
    loadStoredCheckpoints, saveStoredCheckpoints, buildNDS,
  };
})();
