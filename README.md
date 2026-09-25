# NAVEX NDS Web App

Interactive checkpoint-to-checkpoint navigational data sheet based on the Project NAVEX map workflow.

## Map

This version uses **MapTiler SDK JS / MapLibre**, matching the mapping approach used by Project NAVEX rather than Google Maps.

The app asks for a MapTiler Cloud API key on first launch and stores it in browser `localStorage` under `navex.maptiler.apiKey`. Use the **MapTiler Key** button to change it later.

The SDK is loaded from the MapTiler CDN.

## Checkpoints

Add checkpoints in the **Checkpoints** panel:

- Pick **CP** or **SCP**, enter an 8-digit MGR and, optionally, an ID and name. Leave the ID blank to auto-number (`CP1`, `CP2`, `SCP1`, …).
- Click **×** next to a checkpoint to delete it. This also removes it from the route.

Checkpoints are saved in browser `localStorage` under `navex.checkpoints`.

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
