// --- GPS Module ---
// Uses Geolocation API to show device position on the map.
// GPS button: click to start tracking + fly to position, click again to re-center.
// Long press (>800ms) to stop tracking and remove marker.

(function() {
    var gpsMarker = null;
    var gpsCircle = null;
    var gpsWatchId = null;
    var gpsBtn = document.getElementById('gps-btn');
    var gpsStatus = document.getElementById('gps-status');
    var isTracking = false;
    var lastLat = null, lastLng = null;

    function updatePosition(lat, lng, accuracy) {
        lastLat = lat;
        lastLng = lng;

        if (gpsMarker) {
            gpsMarker.setLatLng([lat, lng]);
            gpsCircle.setLatLng([lat, lng]).setRadius(accuracy);
        } else {
            gpsCircle = L.circle([lat, lng], {
                radius: accuracy, color: '#2563eb', fillColor: '#2563eb',
                fillOpacity: 0.1, weight: 1
            }).addTo(map);
            gpsMarker = L.circleMarker([lat, lng], {
                radius: 8, color: '#fff', fillColor: '#2563eb',
                fillOpacity: 1, weight: 3
            }).addTo(map);
        }

        // Update accuracy badge
        gpsStatus.style.display = 'block';
        var accRound = Math.round(accuracy);
        gpsStatus.textContent = 'GPS: \u00B1' + accRound + 'm';
        if (accuracy < 10) {
            gpsStatus.style.background = 'rgba(34,197,94,0.85)';
        } else if (accuracy < 30) {
            gpsStatus.style.background = 'rgba(234,179,8,0.85)';
        } else {
            gpsStatus.style.background = 'rgba(239,68,68,0.85)';
        }
    }

    function startTracking() {
        if (!navigator.geolocation) {
            alert('GPS ist auf diesem Ger\u00E4t nicht verf\u00FCgbar.');
            return;
        }
        isTracking = true;
        gpsBtn.classList.add('active');

        gpsWatchId = navigator.geolocation.watchPosition(
            function(pos) {
                updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
            },
            function(err) {
                console.warn('GPS error:', err.message);
                if (err.code === 1) {
                    alert('GPS-Zugriff verweigert. Bitte in den Einstellungen erlauben.');
                } else {
                    alert('GPS Fehler: ' + err.message);
                }
                stopTracking();
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
    }

    function stopTracking() {
        if (gpsWatchId !== null) {
            navigator.geolocation.clearWatch(gpsWatchId);
            gpsWatchId = null;
        }
        isTracking = false;
        gpsBtn.classList.remove('active');
    }

    function removeMarker() {
        if (gpsMarker) { map.removeLayer(gpsMarker); gpsMarker = null; }
        if (gpsCircle) { map.removeLayer(gpsCircle); gpsCircle = null; }
        gpsStatus.style.display = 'none';
        lastLat = null;
        lastLng = null;
    }

    function flyToGPS() {
        if (lastLat !== null) {
            map.flyTo([lastLat, lastLng], Math.max(map.getZoom(), 18), { duration: 1.0 });
        }
    }

    // Button interaction
    var pressTimer = null;
    var pressHandled = false;

    function onPressStart(e) {
        e.preventDefault();
        pressHandled = false;
        pressTimer = setTimeout(function() {
            pressHandled = true;
            stopTracking();
            removeMarker();
        }, 800);
    }

    function onPressEnd(e) {
        e.preventDefault();
        if (pressHandled) { pressTimer = null; return; }
        clearTimeout(pressTimer);
        pressTimer = null;

        if (!isTracking) {
            startTracking();
            // Wait for first position, then fly
            var waitCount = 0;
            var waitInterval = setInterval(function() {
                waitCount++;
                if (lastLat !== null) {
                    flyToGPS();
                    clearInterval(waitInterval);
                }
                if (waitCount > 50) clearInterval(waitInterval); // 10s timeout
            }, 200);
        } else {
            flyToGPS();
        }
    }

    // Mouse events (desktop)
    gpsBtn.addEventListener('mousedown', onPressStart);
    gpsBtn.addEventListener('mouseup', onPressEnd);
    gpsBtn.addEventListener('mouseleave', function() {
        if (pressTimer && pressTimer !== 'long') clearTimeout(pressTimer);
    });

    // Touch events (mobile)
    gpsBtn.addEventListener('touchstart', onPressStart, { passive: false });
    gpsBtn.addEventListener('touchend', onPressEnd, { passive: false });
    gpsBtn.addEventListener('touchcancel', function() {
        if (pressTimer) clearTimeout(pressTimer);
    });
})();
