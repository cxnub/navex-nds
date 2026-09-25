# NAVEX Navigational Data Sheet Web App

A browser-based route plotting and Navigational Data Sheet generator inspired by the route plotting and MGR conversion logic in Project NAVEX's `scripts/index.js`.

## Features

- Click the map to plot route points.
- Drag markers to adjust a point.
- Enter an 8-digit MGR to plot a point.
- Converts between WGS84 and Kertau RSO / RSO Malaya (EPSG:3168) using the same `epsg.io/trans` approach used by Project NAVEX.
- Calculates 6400-mil azimuth for each leg.
- Calculates straight-line distance from MGR coordinates.
- Calculates estimated movement time from configurable speed.
- Editable Description and Remarks columns.
- Delete individual route points or clear the route.
- Export the generated NDS as CSV.
- Print the NDS to PDF using the browser print dialog.
- 4-digit or 6-digit MGR display.
- Road, satellite, terrain and hybrid map modes.

## Setup

1. Create a Google Maps JavaScript API key with Maps JavaScript API enabled.
2. In `index.html`, replace:

```text
YOUR_GOOGLE_MAPS_API_KEY
```

with your browser API key.

3. Serve the folder through a local web server. Do not open `index.html` directly as a `file://` URL.

For example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Calculation model

Azimuth follows the 6400-mil convention used by Project NAVEX. Distance is derived from MGR easting/northing differences. Estimated time uses:

```text
time = distance / speed
```

where speed is the user-configured km/h value.

For 4-digit MGR, one grid digit represents 100 m. For 6-digit MGR, one grid digit represents 10 m.

## Notes

The application intentionally keeps the original NAVEX projection approach rather than attempting to reinterpret the map grid. MGR conversion depends on the external EPSG.io service, while the base map depends on Google Maps.
