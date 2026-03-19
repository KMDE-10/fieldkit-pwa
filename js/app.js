// --- Config ---
var RASTENBERG_CENTER = [51.172, 11.427];
var DEFAULT_ZOOM = 13;
var SEARCH_ZOOM = 18;

// Base path for data/tiles (relative, works on GitHub Pages subdirectory)
var BASE = (function() {
    var path = location.pathname;
    var idx = path.lastIndexOf('/');
    return idx > 0 ? path.substring(0, idx) : '.';
})();

// --- Local data store ---
var parcelData = null;
var parcelBBoxIndex = [];
var pointsData = null;

// --- DMS parsing ---
function parseDMS(input) {
    input = input.trim();
    var decMatch = input.match(/^(-?\d+[.,]\d+)\s*[,;\s]\s*(-?\d+[.,]\d+)$/);
    if (decMatch) {
        var lat = parseFloat(decMatch[1].replace(',', '.'));
        var lng = parseFloat(decMatch[2].replace(',', '.'));
        if (!isNaN(lat) && !isNaN(lng)) return { lat: lat, lng: lng };
    }
    var dmsRe = /(\d+)\s*°\s*(\d+)\s*[''′]\s*([\d.,]+)\s*["″]?\s*([NSns])/;
    var dmsRe2 = /(\d+)\s*°\s*(\d+)\s*[''′]\s*([\d.,]+)\s*["″]?\s*([EWewOo])/;
    var dmsReAlt = /([NSns])\s*(\d+)\s*°\s*(\d+)\s*[''′]\s*([\d.,]+)\s*["″]?/;
    var dmsReAlt2 = /([EWewOo])\s*(\d+)\s*°\s*(\d+)\s*[''′]\s*([\d.,]+)\s*["″]?/;
    var m1 = input.match(dmsRe), m2 = input.match(dmsRe2);
    var latParts = null, lngParts = null;
    if (m1 && m2) {
        latParts = { d: parseInt(m1[1]), m: parseInt(m1[2]), s: parseFloat(m1[3].replace(',', '.')), h: m1[4].toUpperCase() };
        lngParts = { d: parseInt(m2[1]), m: parseInt(m2[2]), s: parseFloat(m2[3].replace(',', '.')), h: m2[4].toUpperCase() };
    } else {
        var a1 = input.match(dmsReAlt), a2 = input.match(dmsReAlt2);
        if (a1 && a2) {
            latParts = { d: parseInt(a1[2]), m: parseInt(a1[3]), s: parseFloat(a1[4].replace(',', '.')), h: a1[1].toUpperCase() };
            lngParts = { d: parseInt(a2[2]), m: parseInt(a2[3]), s: parseFloat(a2[4].replace(',', '.')), h: a2[1].toUpperCase() };
        }
    }
    if (!latParts || !lngParts) return null;
    var lat = latParts.d + latParts.m / 60 + latParts.s / 3600;
    if (latParts.h === 'S') lat = -lat;
    var lng = lngParts.d + lngParts.m / 60 + lngParts.s / 3600;
    if (lngParts.h === 'W') lng = -lng;
    return { lat: lat, lng: lng };
}

function toDMS(deg, isLng) {
    var dir = isLng ? (deg >= 0 ? 'E' : 'W') : (deg >= 0 ? 'N' : 'S');
    deg = Math.abs(deg);
    var d = Math.floor(deg);
    var minFloat = (deg - d) * 60;
    var m = Math.floor(minFloat);
    var s = ((minFloat - m) * 60).toFixed(1);
    return d + '\u00B0' + (m < 10 ? '0' : '') + m + '\u2032' + (parseFloat(s) < 10 ? '0' : '') + s + '\u2033' + dir;
}
function formatDMS(lat, lng) { return toDMS(lat, false) + ' ' + toDMS(lng, true); }

// --- Point in polygon (ray casting) ---
function pointInPolygon(lng, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1];
        var xj = ring[j][0], yj = ring[j][1];
        if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function pointNearRing(px, py, ring, tol) {
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var ax = ring[j][0], ay = ring[j][1], bx = ring[i][0], by = ring[i][1];
        var dx = bx - ax, dy = by - ay;
        var t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
        var cx = ax + t * dx, cy = ay + t * dy;
        if (Math.abs(px - cx) < tol && Math.abs(py - cy) < tol) return true;
    }
    return false;
}

function findParcelAtPoint(lat, lng) {
    if (!parcelData) return null;
    for (var i = 0; i < parcelBBoxIndex.length; i++) {
        var bb = parcelBBoxIndex[i];
        if (lng < bb.minLng || lng > bb.maxLng || lat < bb.minLat || lat > bb.maxLat) continue;
        var feature = parcelData.features[bb.idx];
        var coords = feature.geometry.coordinates;
        var rings = feature.geometry.type === 'MultiPolygon' ? coords.map(function(p) { return p[0]; }) : [coords[0]];
        for (var r = 0; r < rings.length; r++) {
            if (pointInPolygon(lng, lat, rings[r])) return feature;
        }
    }
    return null;
}

function populateFlstDropdown(parcelsConfig, gmkNames) {
    var sel = document.getElementById('flst-select');
    parcelsConfig.forEach(function (entry) {
        var gmk = entry.gemarkung || '';
        var name = gmkNames[gmk] || gmk;
        entry.numbers.forEach(function (nr) {
            var opt = document.createElement('option');
            opt.value = gmk + ':' + nr;
            opt.textContent = name + ' (' + gmk + ') — ' + nr;
            sel.appendChild(opt);
        });
    });
}

function buildBBoxIndex(fc) {
    parcelBBoxIndex = [];
    for (var i = 0; i < fc.features.length; i++) {
        var coords = fc.features[i].geometry.coordinates;
        var allRings = fc.features[i].geometry.type === 'MultiPolygon'
            ? coords.reduce(function(a, p) { return a.concat(p[0]); }, [])
            : coords[0];
        var minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        for (var j = 0; j < allRings.length; j++) {
            if (allRings[j][0] < minLng) minLng = allRings[j][0];
            if (allRings[j][0] > maxLng) maxLng = allRings[j][0];
            if (allRings[j][1] < minLat) minLat = allRings[j][1];
            if (allRings[j][1] > maxLat) maxLat = allRings[j][1];
        }
        parcelBBoxIndex.push({ minLng: minLng, minLat: minLat, maxLng: maxLng, maxLat: maxLat, idx: i });
    }
}

// --- Accuracy color coding for boundary points ---
function accuracyColor(props) {
    var de = props.datenerhebung || '';
    var gs = props.genauigkeitsstufe || '';
    if (gs) {
        var code = parseInt(gs);
        if (code <= 1200) return '#22c55e';
        if (code <= 2200) return '#eab308';
        if (code <= 2300) return '#f97316';
        return '#ef4444';
    }
    if (de === '4200') return '#ef4444';
    if (parseInt(de) <= 1800 && de !== '') return '#eab308';
    return '#9ca3af';
}

function accuracyLabel(props) {
    var gs = props.genauigkeitsstufe || '';
    var de = props.datenerhebung || '';
    var labels = {
        '1100': '\u00B12cm (GPS/Tachymeter)', '1200': '\u00B13cm', '2100': '\u00B16cm',
        '2200': '\u00B110cm', '2300': '\u00B130cm', '3100': '\u00B160cm',
        '3200': '\u00B11m', '3300': '\u00B13m'
    };
    var methods = {
        '1800': 'Tachymetrisch', '4200': 'Aus Katasterunterlagen digitalisiert'
    };
    var parts = [];
    if (gs && labels[gs]) parts.push(labels[gs]);
    if (de && methods[de]) parts.push(methods[de]);
    return parts.join(' \u2014 ') || 'Unbekannt';
}

// --- Map ---
var map = L.map('map', { zoomControl: true }).setView(RASTENBERG_CENTER, DEFAULT_ZOOM);

// --- Online / Offline mode ---
var OFFLINE = true; // start offline by default
var offlineToggle = document.getElementById('toggle-offline');
offlineToggle.checked = true;

// Per-state WMS endpoints (direct URLs, no proxy needed — Leaflet loads as <img>)
var STATE_WMS = {
    TH: {
        dop: { url: 'https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP', layers: 'th_dop' },
        dgm: { url: 'https://www.geoproxy.geoportal-th.de/geoproxy/services/DGM', layers: 'DGM2' }
    },
    BY: {
        dop: { url: 'https://geoservices.bayern.de/od/wms/dop/v1/dop20', layers: 'by_dop20c' },
        dgm: { url: 'https://geoservices.bayern.de/od/wms/dgm/v1/relief', layers: 'by_dgm_relief' }
    },
    ST: {
        dop: { url: 'https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest', layers: 'lsa_lvermgeo_dop20_2' },
        dgm: null // ST DGM WMS is broken, use local tiles
    }
};

function makeWmsLayer(wmsUrl, wmsLayers, opts) {
    return L.tileLayer.wms(wmsUrl, Object.assign({
        layers: wmsLayers, transparent: true, format: 'image/png',
        version: '1.1.1', maxZoom: 22
    }, opts || {}));
}

// Online layers
var osmOnline = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors', maxZoom: 22, maxNativeZoom: 19
});

// Online DOP/DGM: one WMS layer per state (they return transparent outside coverage)
var dopOnlineLayers = [];
var dgmOnlineLayers = [];
var localDgmTile = L.tileLayer(BASE + '/tiles/dgm/{z}/{x}/{y}.png', {
    maxZoom: 22, maxNativeZoom: 18, errorTileUrl: '', opacity: 0.5
});
Object.keys(STATE_WMS).forEach(function(st) {
    var cfg = STATE_WMS[st];
    dopOnlineLayers.push(makeWmsLayer(cfg.dop.url, cfg.dop.layers, { opacity: 0.5 }));
    if (cfg.dgm) {
        dgmOnlineLayers.push(makeWmsLayer(cfg.dgm.url, cfg.dgm.layers, { opacity: 0.5 }));
    } else {
        dgmOnlineLayers.push(localDgmTile);
    }
});
var dopOnline = L.layerGroup(dopOnlineLayers);
var dgmOnline = L.layerGroup(dgmOnlineLayers);

// Offline layers — local pre-downloaded tiles
var osmOffline = L.tileLayer(BASE + '/tiles/osm/{z}/{x}/{y}.png', {
    attribution: '&copy; OSM (offline)', maxZoom: 22, maxNativeZoom: 18, errorTileUrl: ''
});
var dopOffline = L.tileLayer(BASE + '/tiles/dop/{z}/{x}/{y}.png', {
    maxZoom: 22, maxNativeZoom: 18, opacity: 0.5, errorTileUrl: ''
});
var dgmOffline = L.tileLayer(BASE + '/tiles/dgm/{z}/{x}/{y}.png', {
    maxZoom: 22, maxNativeZoom: 18, opacity: 0.5, errorTileUrl: ''
});

// Current active layers
var osmLayer = osmOffline;
var dopLayer = dopOffline;
var dgmLayer = dgmOffline;
osmLayer.addTo(map);

function switchOfflineMode(offline) {
    OFFLINE = offline;

    // Swap OSM
    var osmWasOn = map.hasLayer(osmLayer);
    if (osmWasOn) map.removeLayer(osmLayer);
    osmLayer = offline ? osmOffline : osmOnline;
    if (osmWasOn && document.getElementById('toggle-osm').checked) osmLayer.addTo(map);

    // Swap DOP and DGM
    [{old: offline ? dopOnline : dopOffline, nw: offline ? dopOffline : dopOnline, ref: 'dop'},
     {old: offline ? dgmOnline : dgmOffline, nw: offline ? dgmOffline : dgmOnline, ref: 'dgm'}
    ].forEach(function(entry) {
        var wasOn = map.hasLayer(entry.old);
        if (wasOn) {
            map.removeLayer(entry.old);
            entry.nw.addTo(map);
        }
        if (entry.ref === 'dop') dopLayer = entry.nw;
        else dgmLayer = entry.nw;
    });
}

offlineToggle.addEventListener('change', function() {
    switchOfflineMode(this.checked);
});

// Auto-detect: if local tiles exist, stay offline; otherwise switch to online
fetch(BASE + '/tiles/osm/13/4356/2736.png', { method: 'HEAD' }).then(function(r) {
    if (!r.ok) {
        offlineToggle.checked = false;
        switchOfflineMode(false);
    }
}).catch(function() {
    offlineToggle.checked = false;
    switchOfflineMode(false);
});

// --- Contour lines layer ---
var contourLabels = L.layerGroup();
var contourLayer = L.geoJSON(null, {
    style: function (feature) {
        var elev = feature.properties.elevation || 0;
        var isMajor = (Math.round(elev) % 5 === 0);
        return {
            color: isMajor ? '#8B4513' : '#CD853F',
            weight: isMajor ? 1.8 : 0.6,
            opacity: isMajor ? 0.85 : 0.4
        };
    },
    onEachFeature: function (feature, layer) {
        var elev = feature.properties.elevation;
        if (elev === undefined || Math.round(elev) % 5 !== 0) return;
        var coords = feature.geometry.coordinates;
        if (!coords || coords.length < 2) return;
        var icon = L.divIcon({
            className: 'contour-label',
            html: Math.round(elev) + '',
            iconSize: [30, 12],
            iconAnchor: [15, 6]
        });
        var labelInterval = 0.002;
        var accum = 0;
        var placed = 0;
        for (var i = 1; i < coords.length; i++) {
            var dx = coords[i][0] - coords[i - 1][0];
            var dy = coords[i][1] - coords[i - 1][1];
            accum += Math.sqrt(dx * dx + dy * dy);
            if (accum >= labelInterval) {
                accum = 0;
                placed++;
                contourLabels.addLayer(L.marker([coords[i][1], coords[i][0]], { icon: icon, interactive: false }));
            }
        }
        if (placed === 0) {
            var mid = Math.floor(coords.length / 2);
            contourLabels.addLayer(L.marker([coords[mid][1], coords[mid][0]], { icon: icon, interactive: false }));
        }
    }
});

// --- Highlight layers ---
var highlightLayer = L.geoJSON(null, {
    style: { color: '#1d4ed8', weight: 3, fillColor: '#3b82f6', fillOpacity: 0.2 }
}).addTo(map);

var activeLayer = L.geoJSON(null, {
    style: { color: '#1e3a8a', weight: 4, fillColor: '#2563eb', fillOpacity: 0.35 }
}).addTo(map);

var permanentLayer = L.geoJSON(null, {
    style: { color: '#15803d', weight: 3, fillColor: '#22c55e', fillOpacity: 0.15 }
}).addTo(map);

var PERMANENT_PARCELS = null;

// --- Boundary points layer ---
var pointsLayer = L.layerGroup();
var pointsToggle = document.getElementById('toggle-points');

var searchMarker = null;

// --- Status ---
var statusEl = document.getElementById('status');
function setStatus(msg, type) { statusEl.textContent = msg; statusEl.className = type; }

// --- Layer toggles ---
function bindLayerToggle(id, getLayer) {
    document.getElementById(id).addEventListener('change', function () {
        var layer = getLayer();
        if (this.checked) map.addLayer(layer); else map.removeLayer(layer);
    });
}
bindLayerToggle('toggle-osm', function() { return osmLayer; });
bindLayerToggle('toggle-dop', function() { return dopLayer; });
bindLayerToggle('toggle-dgm', function() { return dgmLayer; });
document.getElementById('toggle-contours').addEventListener('change', function () {
    if (this.checked) { map.addLayer(contourLayer); map.addLayer(contourLabels); }
    else { map.removeLayer(contourLayer); map.removeLayer(contourLabels); }
});
document.getElementById('toggle-permanent').addEventListener('change', function () {
    if (this.checked) map.addLayer(permanentLayer); else map.removeLayer(permanentLayer);
});
document.getElementById('toggle-points').addEventListener('change', function () {
    if (this.checked) {
        updateBoundaryPoints();
        map.addLayer(pointsLayer);
    } else {
        map.removeLayer(pointsLayer);
    }
});

// --- Parcel info ---
function getParcelLabel(props) {
    return {
        id: props.flstkennz || props.gml_id || '',
        gemarkung: props.gemarkungsnummer || '',
        flur: props.flurnummer || '',
        nummer: props.flurstnr || props.zaehler || '',
        flaeche: props.flaeche || '',
        gemeinde: props.gemeinde || '',
        kreis: props.kreis || ''
    };
}

function showParcelPopup(feature, layer) {
    var p = getParcelLabel(feature.properties);
    var html = '';
    if (p.nummer) html += '<b>Flurst\u00FCck:</b> ' + p.nummer + '<br>';
    if (p.gemarkung) html += '<b>Gemarkung:</b> ' + p.gemarkung + '<br>';
    if (p.flur) html += '<b>Flur:</b> ' + p.flur + '<br>';
    if (p.flaeche) html += '<b>Fl\u00E4che:</b> ' + Number(p.flaeche).toLocaleString('de') + ' m&sup2;<br>';
    if (p.id) html += '<b>Kennz.:</b> <span style="font-family:monospace;font-size:11px">' + p.id + '</span>';
    layer.bindPopup(html, { maxWidth: 300 }).openPopup();
}

function buildParcelList(features) {
    var listEl = document.getElementById('parcel-list');
    listEl.innerHTML = '';
    if (!features || features.length === 0) {
        listEl.innerHTML = '<div style="color:#888;font-size:12px;margin-top:8px">Kein Flurst\u00FCck an dieser Position.</div>';
        return;
    }
    features.forEach(function (feature, idx) {
        var p = getParcelLabel(feature.properties);
        var div = document.createElement('div');
        div.className = 'parcel-item';
        div.innerHTML =
            '<div class="parcel-id">' + (p.nummer || p.id || 'Flurst\u00FCck') + '</div>' +
            '<div class="parcel-detail">' +
            ['Gmk ' + p.gemarkung, 'Flur ' + p.flur, p.flaeche ? (Number(p.flaeche).toLocaleString('de') + ' m\u00B2') : '']
                .filter(Boolean).join(' \u00B7 ') + '</div>';
        div.addEventListener('click', function () {
            highlightLayer.clearLayers();
            highlightLayer.addData(feature);
            var layers = highlightLayer.getLayers();
            if (layers.length) {
                map.fitBounds(layers[0].getBounds(), { padding: [40, 40] });
                showParcelPopup(feature, layers[0]);
            }
            updateBoundaryPoints();
        });
        listEl.appendChild(div);
    });
}

// --- Search (local, no network) ---
function searchParcel(lat, lng) {
    map.flyTo([lat, lng], SEARCH_ZOOM, { duration: 1.5 });

    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker([lat, lng]).addTo(map)
        .bindPopup('Suchposition<br><code>' + formatDMS(lat, lng) + '</code>')
        .openPopup();

    highlightLayer.clearLayers();
    activeLayer.clearLayers();

    if (!parcelData) {
        setStatus('Daten werden noch geladen...', 'info');
        return;
    }

    var feature = findParcelAtPoint(lat, lng);
    if (feature) {
        highlightLayer.addData(feature);
        buildParcelList([feature]);
        var p = getParcelLabel(feature.properties);
        setStatus('Flurst\u00FCck ' + (p.nummer || p.id) + ' gefunden.', 'success');
    } else {
        buildParcelList([]);
        setStatus('Kein Flurst\u00FCck an dieser Position.', 'info');
    }
    updateBoundaryPoints();
}

// --- Search by Flurstück numbers ---
function findParcelsByNumber(numbers, gemarkung, flur) {
    if (!parcelData) return [];
    var results = [];
    var searched = {};
    numbers.forEach(function (nr) {
        nr = nr.trim();
        if (!nr || searched[nr]) return;
        searched[nr] = true;
        for (var i = 0; i < parcelData.features.length; i++) {
            var f = parcelData.features[i];
            var p = f.properties;
            if (gemarkung && p.gemarkungsnummer !== gemarkung) continue;
            if (flur && p.flurnummer !== flur) continue;
            var fnr = p.flurstnr || p.zaehler || '';
            if (fnr === nr) {
                results.push(f);
            }
        }
    });
    return results;
}

function showPermanentParcels() {
    if (!PERMANENT_PARCELS || !parcelData) return;
    permanentLayer.clearLayers();
    var entries = Array.isArray(PERMANENT_PARCELS) ? PERMANENT_PARCELS : [PERMANENT_PARCELS];
    var found = [];
    entries.forEach(function (entry) {
        found = found.concat(findParcelsByNumber(entry.numbers || [], entry.gemarkung || '', entry.flur || ''));
    });
    found.forEach(function (f) {
        var layer = L.geoJSON(f, {
            style: { color: '#15803d', weight: 3, fillColor: '#22c55e', fillOpacity: 0.15 }
        });
        var p = getParcelLabel(f.properties);
        var html = '<b>Flurst\u00FCck:</b> ' + (p.nummer || p.id);
        if (p.flaeche) html += '<br><b>Fl\u00E4che:</b> ' + Number(p.flaeche).toLocaleString('de') + ' m\u00B2';
        layer.bindPopup(html, { maxWidth: 260 });
        permanentLayer.addLayer(layer);
    });
    updateBoundaryPoints();
}

function updateBoundaryPoints() {
    pointsLayer.clearLayers();
    if (!pointsData || !pointsToggle.checked) return;
    var polys = [];
    highlightLayer.eachLayer(function (l) {
        if (l.feature) polys.push(l.feature);
    });
    activeLayer.eachLayer(function (l) {
        if (l.feature) polys.push(l.feature);
    });
    permanentLayer.eachLayer(function (l) {
        if (l.toGeoJSON) {
            var gj = l.toGeoJSON();
            if (gj.type === 'FeatureCollection') {
                gj.features.forEach(function (f) { polys.push(f); });
            } else if (gj.type === 'Feature') {
                polys.push(gj);
            }
        }
    });
    if (!polys.length) return;
    var BUF = 0.0002;
    var minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    polys.forEach(function (f) {
        var coords = f.geometry.coordinates;
        var rings = f.geometry.type === 'MultiPolygon'
            ? coords.reduce(function (a, p) { return a.concat(p[0]); }, [])
            : coords[0];
        rings.forEach(function (c) {
            if (c[0] < minLng) minLng = c[0];
            if (c[0] > maxLng) maxLng = c[0];
            if (c[1] < minLat) minLat = c[1];
            if (c[1] > maxLat) maxLat = c[1];
        });
    });
    minLng -= BUF; minLat -= BUF; maxLng += BUF; maxLat += BUF;
    pointsData.features.forEach(function (f) {
        var c = f.geometry.coordinates;
        if (c[0] < minLng || c[0] > maxLng || c[1] < minLat || c[1] > maxLat) return;
        for (var i = 0; i < polys.length; i++) {
            var coords = polys[i].geometry.coordinates;
            var rings = polys[i].geometry.type === 'MultiPolygon'
                ? coords.map(function (p) { return p[0]; }) : [coords[0]];
            for (var r = 0; r < rings.length; r++) {
                if (pointInPolygon(c[0], c[1], rings[r]) || pointNearRing(c[0], c[1], rings[r], BUF)) {
                    var color = accuracyColor(f.properties);
                    var circle = L.circleMarker([c[1], c[0]], {
                        radius: 5, color: color, fillColor: color, fillOpacity: 0.8,
                        weight: 1, opacity: 0.9
                    });
                    circle.bindPopup(
                        '<b>Grenzpunkt</b><br>' +
                        '<b>Genauigkeit:</b> ' + accuracyLabel(f.properties) + '<br>' +
                        '<b>Markierung:</b> ' + (f.properties.abmarkung === '1000' ? 'Grenzstein' :
                            f.properties.abmarkung === '1100' ? 'Grenzstein (unterirdisch)' :
                            f.properties.abmarkung || 'unbekannt') + '<br>' +
                        '<code>' + formatDMS(c[1], c[0]) + '</code>',
                        { maxWidth: 260 }
                    );
                    pointsLayer.addLayer(circle);
                    return;
                }
            }
        }
    });
}

function highlightParcels(features) {
    highlightLayer.clearLayers();
    activeLayer.clearLayers();
    if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
    if (!features.length) {
        buildParcelList([]);
        setStatus('Keine Flurst\u00FCcke gefunden.', 'info');
        return;
    }
    features.forEach(function (f) { highlightLayer.addData(f); });
    buildParcelList(features);
    map.fitBounds(highlightLayer.getBounds(), { padding: [40, 40] });
    setStatus(features.length + ' Flurst\u00FCck' + (features.length > 1 ? 'e' : '') + ' gefunden.', 'success');
    updateBoundaryPoints();
}

document.getElementById('flst-select').addEventListener('change', function () {
    var val = this.value;
    if (!val || !parcelData) return;
    var sep = val.indexOf(':');
    var gemarkung = val.substring(0, sep);
    var nr = val.substring(sep + 1);
    var found = findParcelsByNumber([nr], gemarkung);
    highlightParcels(found);
});

// --- Form handler ---
document.getElementById('coords-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var parsed = parseDMS(document.getElementById('coords').value);
    if (!parsed) {
        setStatus('Ung\u00FCltige Koordinaten. Beispiel: 51\u00B010\'19.8"N 11\u00B025\'38.1"E', 'error');
        return;
    }
    searchParcel(parsed.lat, parsed.lng);
});

map.on('click', function (e) {
    document.getElementById('coords').value = formatDMS(e.latlng.lat, e.latlng.lng);
    searchParcel(e.latlng.lat, e.latlng.lng);
});

// --- Load all data on startup ---
setStatus('Lade Katasterdaten...', 'info');

Promise.all([
    fetch(BASE + '/data/parcels.json').then(function (r) { return r.json(); }),
    fetch(BASE + '/data/parcels.geojson').then(function (r) { return r.json(); }),
    fetch(BASE + '/data/gemarkungen.json').then(function (r) { return r.json(); }).catch(function () { return {}; })
]).then(function (results) {
    var parcelsConfig = results[0];
    var geojsonData = results[1];
    var gmkNames = results[2];

    PERMANENT_PARCELS = parcelsConfig;
    parcelData = geojsonData;
    buildBBoxIndex(geojsonData);
    showPermanentParcels();

    var entries = Array.isArray(parcelsConfig) ? parcelsConfig : [parcelsConfig];
    populateFlstDropdown(entries, gmkNames);

    setStatus(geojsonData.features.length + ' Flurst\u00FCcke geladen.', 'success');
}).catch(function (err) {
    console.error('Failed to load data:', err);
    setStatus('Fehler beim Laden der Flurst\u00FCcke.', 'error');
});

fetch(BASE + '/data/points.geojson')
    .then(function (r) { return r.json(); })
    .then(function (data) {
        pointsData = data;
        console.log(data.features.length + ' boundary points loaded');
        updateBoundaryPoints();
    })
    .catch(function (err) {
        console.warn('Failed to load boundary points:', err);
    });

fetch(BASE + '/data/contours.geojson')
    .then(function (r) { return r.json(); })
    .then(function (data) {
        contourLayer.addData(data);
        console.log(data.features.length + ' contour lines loaded');
    })
    .catch(function (err) {
        console.warn('Contour data not available:', err);
    });

map.attributionControl.addAttribution('Katasterdaten: &copy; GDI-Th (dl-de/by-2-0)');

// --- Panel minimize / expand (mobile) ---
(function() {
    var panel = document.getElementById('panel');
    var minimizeBtn = document.getElementById('panel-minimize');
    var expandBtn = document.getElementById('panel-expand');

    minimizeBtn.addEventListener('click', function(e) {
        e.preventDefault();
        panel.classList.add('minimized');
    });

    expandBtn.addEventListener('click', function(e) {
        e.preventDefault();
        panel.classList.remove('minimized');
    });
})();

// --- Service Worker registration ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(BASE + '/sw.js').then(function(reg) {
        console.log('Service Worker registered, scope:', reg.scope);
    }).catch(function(err) {
        console.warn('Service Worker registration failed:', err);
    });
}
