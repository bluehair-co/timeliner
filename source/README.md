# Timeliner

Timeliner 2.0 shows where you've been and how you get around, using your Google Timeline. It is the successor to Transport Footprint, which is frozen as v1.0 in `../versions/v1.0/`.

## Open it

- **On a Mac or PC:** open `dist/index.html` in a browser.
- **On a phone:** host the `dist/` folder over HTTPS (for example GitHub Pages or Netlify), open it, and choose *Add to Home screen*. It then starts offline, and your last import stays saved on the phone.

Your Timeline file is read on the device and is never uploaded.

## Layout

- **Map:** full-screen map with the time slider at the top. When a single day is chosen, the top bar becomes a day navigator. Filters are bottom-left (the gear there opens Settings). Views and layers are bottom-right: Mercator, Equal Earth or Globe; paths; a heatmap of where you travelled or stayed, with dot size and intensity; and countries visited.
- **Insights:** summary, how you travel, weekly rhythm, change over time, top routes, places, records, countries and CO₂.
- **Timeline:** every trip in the filter range, newest first. Tap a trip to see it on a map at the top of the list.

## Rebuild

Run `python3 build.py`. It assembles `dist/index.html` from `src/` and copies `static/` (the manifest, service worker and icons).
