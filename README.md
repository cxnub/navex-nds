# NAVEX NDS Web App

Interactive checkpoint-to-checkpoint navigational data sheet based on the Project NAVEX map workflow.

## Map

This version uses **MapTiler SDK JS / MapLibre**, matching the mapping approach used by Project NAVEX rather than Google Maps.

1. Create a MapTiler Cloud API key.
2. Open `app.js`.
3. Replace:

```js
The app asks the user for a MapTiler Cloud API key on first launch and stores it in browser `localStorage` under `navex.maptiler.apiKey`. Use the **MapTiler Key** button to change it later.
```

with your key.

The SDK is loaded from the MapTiler CDN.

## Checkpoints

Edit `checkpoints.js`:

```js
window.CHECKPOINTS = [
  { id: 'CP1', name: 'Checkpoint 1', type: 'CP', mgr: '28465132' },
  { id: 'SCP1', name: 'Sub-checkpoint 1', type: 'SCP', mgr: '28505155' },
  { id: 'CP2', name: 'Checkpoint 2', type: 'CP', mgr: '29104876' },
];
```

You can also provide WGS84 coordinates directly:

```js
{ id: 'CP1', name: 'Checkpoint 1', type: 'CP', lat: 1.3521, lng: 103.8198 }
```

## Route workflow

- Click **CP/SCP** on the map or click **Add** in the checkpoint list to put a fixed checkpoint into the route.
- Click anywhere else on the map to add a manual route point.
- Manual points are draggable.
- Checkpoints in the route are fixed and cannot be dragged.
- Continue plotting until the route is `CP1 → manual point → SCP1 → manual point → CP2` or any other sequence you need.
- Use **Hide Checkpoints / Show Checkpoints** to declutter the map without removing the checkpoint data.

## MGR

MGR conversion follows the Project NAVEX approach using EPSG:3168 (Kertau RSO / RSO Malaya) and EPSG:4326 WGS84 through EPSG.io.

## Run locally

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.
