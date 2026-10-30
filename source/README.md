# Timeliner

Timeliner 2.0 shows where you've been and how you get around, using your Google Timeline. It is the successor to Transport Footprint, which is frozen as v1.0 in `../versions/v1.0/`.

## Open it

- **On a Mac or PC:** open `dist/index.html` in a browser.
- **On a phone:** host the `dist/` folder over HTTPS (for example GitHub Pages or Netlify), open it, and choose *Add to Home screen*. It then starts offline, and your last import stays saved on the phone.

Your Timeline file is read on the device and is never uploaded.

## Strava

In Settings, *Load Strava export* takes the ZIP from Strava (Settings → My Account → Download or Delete Your Account), or single .gpx, .fit or .tcx files. Only the activity files inside the ZIP are read, so a large export with photos is fine. A Strava activity replaces every Timeline trip that is at least half inside its time (whatever transport Timeline guessed), and activities Timeline missed are added. Virtual rides are skipped. The Strava activities are saved apart from the Timeline trips, so re-importing either one keeps the match.

## Trips from Timeline's loose GPS points

Older on-device Timeline data often keeps GPS points while you were moving but no trip for them, so a day of driving shows up as a few stays and nothing else. Points outside every trip and stay are joined into trips (a run ends at a gap of over 30 minutes, a jump of over 50 km, or a trip or stay) when they get at least 500 m from where they started. Their transport type is guessed from the speed they kept while moving: 30 km/h or more is a car, 10 km/h or more a bike, slower is walking. They are marked as guessed, and the trip details say they were made from loose points.

## Records.json under Timeline

Load the on-device Timeline.json together with Takeout Records.json files (all at once, or one after the other) to get the best of both. Timeline still decides where you stayed, how you travelled and where each trip starts and ends. Records.json, which keeps a GPS point about every minute where Timeline kept one every few minutes, gives those trips their line: each trip is drawn along the Records points recorded during it, and when they cover the whole trip (no gap over 15 minutes) its distance is measured along them too, with Timeline's own figure shown in the trip details. Points less accurate than 200 m are left out, and when two phones recorded at once, a trip uses the phone its own Timeline points came from. On days only Records.json covers, trips are rebuilt from its points as before. On days Timeline covers, a trip rebuilt from Records.json is still kept when it falls in a gap Timeline left (older Timeline data often has a stay and nothing else on a day of driving): at most a fifth of it may overlap Timeline's trips and at most half its stays. Flights always come from Timeline. The Records points are saved on the device with the trips, so files loaded later are matched too.

## Simulated trips

A file in the on-device Timeline.json format with `"simulated": true` at the top is read as simulated trips, for example trips rebuilt from booking emails. Where they clash with an exported Timeline, the simulated trips win: an exported trip that overlaps a simulated one for at least half of its time (or half of the simulated trip's time) is left out, and exported stays are cut back to the time around it. A few minutes' overlap at either end is not a clash, so the walk to the station stays. Everything else on those days still comes from the export.

## Layout

- **Map:** full-screen map with the time slider at the top. When a single day is chosen, the top bar becomes a navigator: switch between Day, Week (Monday to Sunday), Month and Year, and the arrows (or the arrow keys) step to the previous or next one with trips. Filters are bottom-left (the gear there opens Settings). Views and layers are bottom-right: Mercator, Equal Earth or Globe; paths; a heatmap of where you travelled or stayed, with dot size and intensity; and countries visited.
- **Insights:** the same navigator as the map, in the same place (the period is shared, so stepping on any tab moves them all, and it stays put as you switch tabs), then summary, how you travel, weekly rhythm, change over time, top routes, places, records, countries and CO₂.
- **Timeline:** the same navigator, then every trip in the filter range, newest first. Tap a trip to see it on a map at the top of the list.

## Rebuild

Run `python3 build.py`. It assembles `dist/index.html` from `src/` and copies `static/` (the manifest, service worker and icons).
