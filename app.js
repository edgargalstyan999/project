// Car Dash: map + live position for the car's browser.
// Position comes from the browser's geolocation for now.
// Vehicle data (battery, range, locks) will come from Tesla Fleet API later.

(function () {
  'use strict';

  const START = [40.1792, 44.4991]; // Yerevan, until we know the real position
  const TILES = {
    street: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap',
      dark: true,
      maxZoom: 19,
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
      dark: false,
      maxZoom: 19,
    },
  };

  const $ = (id) => document.getElementById(id);

  // ---- Map ----
  const map = L.map('map', { zoomControl: false, attributionControl: true }).setView(START, 13);
  let layerName = 'street';
  let tileLayer = null;

  function setLayer(name) {
    if (tileLayer) map.removeLayer(tileLayer);
    const t = TILES[name];
    tileLayer = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: t.maxZoom }).addTo(map);
    map.getPane('tilePane').classList.toggle('dark', t.dark);
    layerName = name;
    $('btn-layer').textContent = name === 'street' ? 'Արբանյակ' : 'Քարտեզ';
  }
  setLayer('street');

  const carIcon = L.divIcon({ className: '', html: '<div class="car-dot"></div>', iconSize: [26, 26], iconAnchor: [13, 13] });
  let marker = null;
  let accuracyCircle = null;
  let follow = true;
  let lastPos = null;

  function setFollow(on) {
    follow = on;
    $('btn-follow').classList.toggle('on', on);
  }
  setFollow(true);

  // Stop following when the user drags the map themselves.
  map.on('dragstart', () => setFollow(false));

  $('btn-follow').addEventListener('click', () => {
    setFollow(!follow);
    if (follow && lastPos) map.setView(lastPos, Math.max(map.getZoom(), 16));
  });
  $('btn-center').addEventListener('click', () => {
    if (lastPos) map.setView(lastPos, Math.max(map.getZoom(), 16));
  });
  $('btn-layer').addEventListener('click', () => setLayer(layerName === 'street' ? 'satellite' : 'street'));

  // ---- Position ----
  function onPosition(pos) {
    const { latitude, longitude, accuracy, speed } = pos.coords;
    const ll = [latitude, longitude];
    const first = !lastPos;
    lastPos = ll;

    if (!marker) {
      marker = L.marker(ll, { icon: carIcon }).addTo(map);
      accuracyCircle = L.circle(ll, { radius: accuracy, color: '#3e8bff', weight: 1, fillOpacity: 0.08 }).addTo(map);
    } else {
      marker.setLatLng(ll);
      accuracyCircle.setLatLng(ll).setRadius(accuracy);
    }

    if (first) map.setView(ll, 16);
    else if (follow) map.panTo(ll);

    $('coords').textContent = latitude.toFixed(5) + ', ' + longitude.toFixed(5);
    $('accuracy').textContent = 'Ճշտություն՝ ±' + Math.round(accuracy) + ' մ';
    $('speed').textContent = speed == null || isNaN(speed) ? '0' : Math.round(speed * 3.6);
    updateNearest();
    $('map-status').textContent = 'Թարմացվել ա ' + new Date().toLocaleTimeString('hy-AM', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function onPositionError(err) {
    const msg = {
      1: 'Տեղորոշումը արգելված ա. թույլ տուր browser-ում',
      2: 'Տեղը հնարավոր չի որոշել',
      3: 'Տեղորոշումը չպատասխանեց, նորից եմ փորձում…',
    }[err.code] || 'Տեղորոշման սխալ';
    $('map-status').textContent = msg;
  }

  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    });
  } else {
    $('map-status').textContent = 'Այս browser-ը տեղորոշում չի աջակցում';
  }

  // ---- Charging stations (from stations.json) ----
  const NETWORK_COLORS = {
    evan: '#34c759',
    'team energy': '#ff9f0a',
    'eva charging': '#bf5af2',
    ecocars: '#64d2ff',
  };
  const stationLayer = L.layerGroup().addTo(map);
  let stations = [];
  let stationsOn = true;

  function networkColor(network) {
    return NETWORK_COLORS[String(network || '').trim().toLowerCase()] || '#ffd60a';
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function stationPopup(s) {
    const rows = [
      '<b>' + escapeHtml(s.name || s.network || 'Կայան') + '</b>',
      s.network ? escapeHtml(s.network) : '',
      s.address ? escapeHtml(s.address) : '',
      s.power_kw ? escapeHtml(s.power_kw) + ' kW' : '',
      Array.isArray(s.connectors) && s.connectors.length ? escapeHtml(s.connectors.join(', ')) : '',
      s.price ? escapeHtml(s.price) : '',
      s.opened ? 'Բացվել ա՝ ' + escapeHtml(s.opened) : '',
    ].filter(Boolean);
    return '<div class="station-popup">' + rows.join('<br>') + '</div>';
  }

  function renderStations() {
    stationLayer.clearLayers();
    stations.forEach((s) => {
      L.circleMarker([s.lat, s.lng], {
        radius: 9,
        color: '#0b0d10',
        weight: 2,
        fillColor: networkColor(s.network),
        fillOpacity: 0.95,
      }).bindPopup(stationPopup(s)).addTo(stationLayer);
    });
    $('station-count').textContent = stations.length ? stations.length + ' կայան' : 'Կայաններ չկան';
    updateNearest();
  }

  // Straight-line distance in km.
  function distanceKm(a, b) {
    const R = 6371;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLng = (b[1] - a[1]) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function updateNearest() {
    if (!lastPos || !stations.length) { $('nearest').textContent = '—'; return; }
    let best = null;
    stations.forEach((s) => {
      const d = distanceKm(lastPos, [s.lat, s.lng]);
      if (!best || d < best.d) best = { s, d };
    });
    const dist = best.d < 1 ? Math.round(best.d * 1000) + ' մ' : best.d.toFixed(1) + ' կմ';
    $('nearest').textContent = (best.s.name || best.s.network || 'Կայան') + ' · ' + dist;
  }

  $('btn-stations').addEventListener('click', () => {
    stationsOn = !stationsOn;
    $('btn-stations').classList.toggle('on', stationsOn);
    if (stationsOn) stationLayer.addTo(map); else map.removeLayer(stationLayer);
  });
  $('btn-stations').classList.add('on');

  fetch('stations.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      const list = Array.isArray(data) ? data : data.stations;
      stations = (list || []).filter((s) => isFinite(s.lat) && isFinite(s.lng));
      renderStations();
    })
    .catch(() => { $('station-count').textContent = 'stations.json-ը չբացվեց'; });

  // ---- Clock and network ----
  function tick() {
    $('clock').textContent = new Date().toLocaleTimeString('hy-AM', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  tick();
  setInterval(tick, 10000);

  function updateNet() { $('net').classList.toggle('off', !navigator.onLine); }
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);
  updateNet();

  // Leaflet needs a size refresh after layout changes (e.g. rotation on a phone).
  window.addEventListener('resize', () => map.invalidateSize());
})();
