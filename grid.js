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

  // 8-digit MGR, e.g. "2846 5132".
  function formatMGR(lat, lng) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return '—';
    const { x, y } = latLngToGrid(lat, lng);
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

  function gridToLatLng(x, y) {
    const [lng, lat] = projection.inverse([x, y]);
    return { lat, lng };
  }

  // The point at a grid azimuth (mils) and distance (m) from a start point.
  function offset(from, azimuthMils, distance) {
    const start = latLngToGrid(from.lat, from.lng);
    const angle = azimuthMils * Math.PI / 3200;
    return gridToLatLng(start.x + distance * Math.sin(angle), start.y + distance * Math.cos(angle));
  }

  // The 8-digit MGR used here covers eastings 6xxxxx m and northings 1xxxxx m (Singapore).
  function inMgrArea(lat, lng) {
    const { x, y } = latLngToGrid(lat, lng);
    return x >= 600000 && x < 700000 && y >= 100000 && y < 200000;
  }

  function formatLatLng(lat, lng) {
    return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  }

  window.NavexGrid = { parseMGR, mgrToLatLng, latLngToGrid, gridToLatLng, formatMGR, formatLatLng, inMgrArea, leg, offset };
})();
