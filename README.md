# Car Dash

Web app for the car's browser (and phones): live position on a map, plus EV charging stations.

Open `index.html` through any static web server (GitHub Pages works). Geolocation needs HTTPS.

## Charging stations

The map reads `stations.json`. Each station needs `lat` and `lng`; everything else is optional.

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
