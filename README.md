# NAVEX NDS

Plan a navigation route and get the **MGR, azimuth and distance** of every leg, for navigating with a map and compass.

1. **Checkpoints:** add each CP/SCP by its 8-digit MGR. They show on the map as black dots.
2. **Route:** the route starts at a checkpoint. Tap checkpoints in the order you will visit them, and tap the map to add waypoints between them. The route of advance (ROA) is drawn in green.
3. **Sections:** the route is grouped into collapsible checkpoint-to-checkpoint sections, each holding its intermediate waypoints. Drag waypoints on the map to adjust them. Drag them in the list (⠿) to reorder them within a section or move them to another section.
4. **Legs:** each leg shows the destination MGR, the grid azimuth in mils and the distance in metres.

**Print** produces a navigational data sheet (legs plus a checkpoint list). **Export** and **Import** share all checkpoints, the route and the NDS as a `navex-nds-*.json` file. On import, checkpoints in the file replace local checkpoints with the same ID, and the route is replaced.

Checkpoints and the route are saved in the browser.

## Map

The map uses **MapTiler SDK JS / MapLibre**, with Topo (default) and Satellite styles. The app asks for a MapTiler Cloud API key on first launch and stores it in the browser. Use the ⚙ button to change it.

## MGR

MGR conversion uses EPSG:3168 (Kertau RSO / RSO Malaya) ↔ EPSG:4326 (WGS84), calculated in the browser with [proj4js](https://github.com/proj4js/proj4js) (see `grid.js`).

An 8-digit MGR `2846 5132` is easting 6 2846 0 m, northing 1 5132 0 m (10 m resolution). Leg distances and grid azimuths (6400 mils) are calculated from grid coordinates in metres.

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `grid.js`: MGR ↔ lat/lng conversion, distance and azimuth
- `share.js`: legs, and export/import of route files

## Deploying changes

`index.html` loads `styles.css`, `grid.js`, `share.js` and `app.js` with a `?v=` version tag. Bump it whenever any of these files change, so browsers don't mix a new page with cached old files.

## Run locally

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
