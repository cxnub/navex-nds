# NAVEX NDS

Plan a navigation route and get the **MGR, azimuth and distance** of every leg, for navigating with a map and compass.

1. **Checkpoints:** add each CP/SCP by its 8-digit MGR. They show on the map as black dots.
2. **Route:** the route starts at a checkpoint. Tap checkpoints in the order you will visit them, and tap the map to add waypoints between them. The route of advance (ROA) is drawn in green.
3. **Sections:** the route is grouped into collapsible checkpoint-to-checkpoint sections, each holding its intermediate waypoints. Drag waypoints on the map to adjust them. Drag them in the list (⠿) to reorder them within a section or move them to another section.
4. **Legs:** each leg shows the destination MGR, the grid azimuth in mils and the distance in metres. For a leg that ends at a waypoint, tap the mils/metres to type an exact azimuth and distance. The waypoint moves to that bearing and distance from the previous point.

**NDS** opens the navigational data sheet as a table: No., From MGR, To MGR, Azimuth, Distance, Est. Time, Description and Remarks, grouped by section. Set the speed (km/h) used for Est. Time there, fill in Description and Remarks for each leg, and **Print** it (legs plus a checkpoint list). **Export** and **Import** share all checkpoints, the route and the NDS as a `navex-nds-*.json` file. On import, checkpoints in the file replace local checkpoints with the same ID, and the route is replaced.

Checkpoints and the route are saved in the browser.

## Map

The map uses **MapTiler SDK JS / MapLibre**, with Topo (default) and Satellite styles. The **1:50K map (2005)** checkbox overlays the 2005 1:50,000 topographic map of Singapore from the NUS Libraries WMTS (`https://libmaps.nus.edu.sg/services/2005_50K/wmts`, zoom 9–16), with an adjustable opacity. The app asks for a MapTiler Cloud API key on first launch and stores it in the browser. Use the ⚙ button to change it.

To get a free key:

1. Open https://cloud.maptiler.com/account/keys/ and sign up for a free MapTiler Cloud account, or log in.
2. On the **API keys** page, copy your default key, or create a new one.
3. Recommended: add `cxnub.github.io` to the key's allowed HTTP origins so it only works on this app.
4. Paste it into the app's key dialog and choose **Save & load map**.

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
