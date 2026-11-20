# Car Dash

Web app for the car's browser (and phones): live position on a map, plus EV charging stations.

Open `index.html` through any static web server (GitHub Pages works). Geolocation needs HTTPS.

## Charging stations

Two sources are shown together:

1. **OpenStreetMap, live.** On start the app asks Overpass for every `amenity=charging_station` in Armenia, trying `overpass-api.de`, then `overpass.kumi.systems`, then `overpass.private.coffee`. The result is cached in the browser for 12 hours, so the car does not download it on every start and still shows stations when offline.
2. **`stations.json`, our own list** (for example EVAN stations taken from the EVAN app). If an OpenStreetMap station is within 50 m of one of ours, only ours is shown.

The side card shows how many stations came from each source.

The app reads `stations.json` like this. Each station needs `lat` and `lng`; everything else is optional.

```json
{
  "updated": "2026-11-20",
  "stations": [
    {
      "name": "Station name",
      "network": "EVAN",
      "lat": 40.1811,
      "lng": 44.5136,
      "address": "Street, city",
      "power_kw": 60,
      "connectors": ["CCS2", "Type 2"],
      "price": "120 AMD/kWh",
      "opened": "2026-11-01"
    }
  ]
}
```

Marker colours by `network`: EVAN green, Team Energy orange, Eva Charging purple, EcoCars light blue, anything else yellow.
