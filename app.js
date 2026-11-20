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

  // ---- Charging stations ----
  // Two sources: stations.json (our own list, e.g. from EVAN app screenshots)
  // and every charging station in Armenia from OpenStreetMap, loaded live.
  const NETWORKS = [
    { re: /\bevan\b/i, color: '#34c759' },
    { re: /\bteam\b/i, color: '#ff9f0a' },
    { re: /\beva\b/i, color: '#bf5af2' },
    { re: /eco\s*cars/i, color: '#64d2ff' },
  ];
  const OTHER_COLOR = '#ffd60a';

  const OVERPASS_SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  // Armenia plus a small margin.
  const OSM_QUERY = '[out:json][timeout:60];nwr["amenity"="charging_station"](38.8,43.4,41.35,46.7);out center tags;';
  const OSM_CACHE_KEY = 'carDash.osmStations.v1';
  const OSM_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const SAME_STATION_KM = 0.05;

  const SOCKETS = {
    type2: 'Type 2',
    type2_cable: 'Type 2 (մալուխով)',
    type2_combo: 'CCS2',
    type1: 'Type 1',
    type1_combo: 'CCS1',
    chademo: 'CHAdeMO',
    gb_dc: 'GB/T DC',
    gb_ac: 'GB/T AC',
    tesla_supercharger: 'Tesla',
    nacs: 'Tesla (NACS)',
    schuko: 'Schuko',
  };

  const stationLayer = L.layerGroup().addTo(map);
  let manualStations = [];
  let osmStations = [];
  let stations = [];
  let stationsOn = true;
  let manualStatus = 'Բեռնում եմ…';
  let osmStatus = 'բեռնում եմ…';

  function networkColor(network) {
    const n = String(network || '');
    const hit = NETWORKS.find((x) => x.re.test(n));
    return hit ? hit.color : OTHER_COLOR;
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function stationPopup(s) {
    const rows = [
      '<b>' + escapeHtml(s.name || s.network || 'Կայան') + '</b>',
      s.network && s.network !== s.name ? escapeHtml(s.network) : '',
      s.address ? escapeHtml(s.address) : '',
      s.power_kw ? escapeHtml(s.power_kw) + ' kW' : '',
      Array.isArray(s.connectors) && s.connectors.length ? escapeHtml(s.connectors.join(', ')) : '',
      s.price ? escapeHtml(s.price) : '',
      s.hours ? 'Ժամեր՝ ' + escapeHtml(s.hours) : '',
      s.opened ? 'Բացվել ա՝ ' + escapeHtml(s.opened) : '',
      '<span class="station-src">' + (s.source === 'osm' ? 'OpenStreetMap' : 'Մեր ցուցակ') + '</span>',
    ].filter(Boolean);
    return '<div class="station-popup">' + rows.join('<br>') + '</div>';
  }

  // Turn one OpenStreetMap element into our station format.
  function fromOsm(el) {
    const t = el.tags || {};
    const lat = el.lat != null ? el.lat : el.center && el.center.lat;
    const lng = el.lon != null ? el.lon : el.center && el.center.lon;
    const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
    const address = [street, t['addr:city']].filter(Boolean).join(', ');

    const connectors = [];
    let power = 0;
    Object.keys(t).forEach((k) => {
      const m = /^socket:([a-z0-9_]+)$/.exec(k);
      if (m && t[k] !== 'no' && t[k] !== '0') connectors.push(SOCKETS[m[1]] || m[1]);
      if (/^socket:[a-z0-9_]+:output$/.test(k) || k === 'charging_station:output') {
        const kw = parseFloat(String(t[k]).replace(',', '.'));
        if (isFinite(kw)) power = Math.max(power, /\bw\b/i.test(t[k]) && !/kw/i.test(t[k]) ? kw / 1000 : kw);
      }
    });

    return {
      name: t.name || t['name:hy'] || t['name:en'] || '',
      network: t.network || t.operator || t.brand || '',
      lat: Number(lat),
      lng: Number(lng),
      address,
      power_kw: power || null,
      connectors,
      price: t.fee === 'no' ? 'Անվճար' : t.charge || '',
      hours: t.opening_hours || '',
      source: 'osm',
    };
  }

  function validStation(s) {
    return s && isFinite(s.lat) && isFinite(s.lng) && Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180;
  }

  // Our own list wins: drop OSM stations that sit on top of one of ours.
  function mergeStations() {
    const extra = osmStations.filter((o) => !manualStations.some((m) => distanceKm([m.lat, m.lng], [o.lat, o.lng]) < SAME_STATION_KM));
    stations = manualStations.concat(extra);
    renderStations();
  }

  function renderStations() {
    stationLayer.clearLayers();
    stations.forEach((s) => {
      L.circleMarker([s.lat, s.lng], {
        radius: s.source === 'osm' ? 7 : 9,
        color: '#0b0d10',
        weight: 2,
        fillColor: networkColor(s.network || s.name),
        fillOpacity: 0.95,
      }).bindPopup(stationPopup(s)).addTo(stationLayer);
    });
    const evan = stations.filter((s) => /\bevan\b/i.test(s.network + ' ' + s.name)).length;
    const head = stations.length ? stations.length + ' կայան' + (evan ? ', EVAN՝ ' + evan : '') : 'Կայաններ չկան';
    $('station-count').textContent = head + ' · ցուցակ՝ ' + manualStatus + ' · OSM՝ ' + osmStatus;
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

  // Our own list.
  fetch('stations.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      const list = Array.isArray(data) ? data : data.stations;
      manualStations = (list || [])
        .map((s) => Object.assign({}, s, { lat: Number(s.lat), lng: Number(s.lng), source: 'list' }))
        .filter(validStation);
      manualStatus = String(manualStations.length);
    })
    .catch(() => { manualStatus = 'չբացվեց'; })
    .then(mergeStations);

  // OpenStreetMap, with a local cache so the car does not download it on every start.
  function readOsmCache() {
    try {
      const c = JSON.parse(localStorage.getItem(OSM_CACHE_KEY) || 'null');
      return c && Array.isArray(c.stations) ? c : null;
    } catch (e) { return null; }
  }

  function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(() => clearTimeout(timer));
  }

  async function fetchOsmStations() {
    for (const url of OVERPASS_SERVERS) {
      try {
        const r = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(OSM_QUERY),
        }, 45000);
        if (!r.ok) continue;
        const data = await r.json();
        if (!data || !Array.isArray(data.elements)) continue;
        return data.elements.map(fromOsm).filter(validStation);
      } catch (e) { /* try the next server */ }
    }
    return null;
  }

  async function loadOsmStations() {
    const cached = readOsmCache();
    if (cached) {
      osmStations = cached.stations;
      osmStatus = String(osmStations.length);
      mergeStations();
      if (Date.now() - cached.at < OSM_MAX_AGE_MS) return;
    }
    const fresh = await fetchOsmStations();
    if (fresh) {
      osmStations = fresh;
      osmStatus = String(fresh.length);
      try { localStorage.setItem(OSM_CACHE_KEY, JSON.stringify({ at: Date.now(), stations: fresh })); } catch (e) { /* storage full or blocked */ }
    } else if (!cached) {
      osmStatus = 'չբեռնվեց';
    }
    mergeStations();
  }
  loadOsmStations();

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
