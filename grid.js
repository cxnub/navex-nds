/*
 * Grid maths for Kertau (RSO) / RSO Malaya (m), EPSG:3168, done locally with proj4js.
 *
 * An 8-digit MGR "2846 5132" is easting 6 2846 0 m, northing 1 5132 0 m (10 m resolution).
 * Distances and azimuths are calculated from grid coordinates in metres.
 */
(function () {
  const RSO_MALAYA = '+proj=omerc +lat_0=4 +lonc=102.25 +alpha=323.0257905 +gamma=323.130102361111 '
    + '+k=0.99984 +x_0=804670.24 +y_0=0 +no_uoff +a=6377295.664 +rf=300.8017 '
    + '+towgs84=-11,851,5,0,0,0,0 +units=m +no_defs';
  const projection = proj4('EPSG:4326', RSO_MALAYA);

  function parseMGR(mgr) {
    const raw = String(mgr || '').replace(/\s+/g, '');
    if (!/^\d{8}$/.test(raw)) return null;
    return { x: Number(`6${raw.slice(0, 4)}0`), y: Number(`1${raw.slice(4)}0`) };
  }

  function mgrToLatLng(mgr) {
    const grid = parseMGR(mgr);
    if (!grid) throw new Error('Invalid MGR');
    const [lng, lat] = projection.inverse([grid.x, grid.y]);
    return { lat, lng };
  }

  function latLngToGrid(lat, lng) {
    const [x, y] = projection.forward([Number(lng), Number(lat)]);
    return { x, y };
  }

  // precision 4: 8-digit MGR ("2846 5132"); precision 6: full easting/northing in metres.
  function formatMGR(lat, lng, precision = 4) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return '—';
    const { x, y } = latLngToGrid(lat, lng);
    if (precision === 6) return `${Math.round(x)} ${Math.round(y)}`;
    const digits = v => String(Math.floor((Math.round(v) % 100000) / 10)).padStart(4, '0');
    return `${digits(x)} ${digits(y)}`;
  }

  function leg(a, b) {
    const from = latLngToGrid(a.lat, a.lng);
    const to = latLngToGrid(b.lat, b.lng);
    const eDiff = to.x - from.x;
    const nDiff = to.y - from.y;
    const distance = Math.hypot(eDiff, nDiff);
    const mils = Math.round((Math.atan2(eDiff, nDiff) * 3200 / Math.PI + 6400) % 6400);
    return { distance, azimuth: mils === 0 || mils === 6400 ? 6400 : mils };
  }

  window.NavexGrid = { parseMGR, mgrToLatLng, latLngToGrid, formatMGR, leg };
})();
