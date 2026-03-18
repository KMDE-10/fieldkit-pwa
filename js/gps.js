// --- GPS Module ---
// Uses Geolocation API to show device position on the map.
// GPS button: tap to start tracking + fly to position, tap again to re-center.
// Long press (>800ms) to stop tracking and remove marker.

(function() {
    var gpsMarker = null;
    var gpsCircle = null;
    var gpsWatchId = null;
    var gpsBtn = document.getElementById('gps-btn');
    var gpsStatus = document.getElementById('gps-status');
    var isTracking = false;
    var lastLat = null, lastLng = null;
    var usedTouch = false; // prevent mouse events after touch

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

        // iOS Safari: call getCurrentPosition first (must be in direct user gesture)
        // then start watchPosition for continuous updates
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
                flyToGPS();

                // Now start continuous watching
                gpsWatchId = navigator.geolocation.watchPosition(
                    function(pos) {
                        updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
                    },
                    function(err) {
                        console.warn('GPS watch error:', err.message);
                    },
                    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
                );
            },
            function(err) {
                console.warn('GPS error:', err.code, err.message);
                if (err.code === 1) {
                    alert('GPS-Zugriff verweigert.\n\niPhone: Einstellungen \u2192 Datenschutz \u2192 Ortungsdienste \u2192 Safari \u2192 \"Beim Verwenden der App\"\n\nDann Seite neu laden.');
                } else if (err.code === 2) {
                    alert('GPS nicht verf\u00FCgbar. Bitte Ortungsdienste aktivieren.');
                } else {
                    alert('GPS Zeitüberschreitung. Bitte erneut versuchen.');
                }
                stopTracking();
            },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
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

    // --- Button interaction ---
    var pressTimer = null;
    var pressHandled = false;

    function handlePress() {
        pressHandled = false;
        pressTimer = setTimeout(function() {
            pressHandled = true;
            stopTracking();
            removeMarker();
        }, 800);
    }

    function handleRelease() {
        if (pressHandled) { pressTimer = null; return; }
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = null;

        if (!isTracking) {
            startTracking();
        } else {
            flyToGPS();
        }
    }

    // Touch events (mobile) — these fire first on touch devices
    gpsBtn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        usedTouch = true;
        handlePress();
    }, { passive: false });

    gpsBtn.addEventListener('touchend', function(e) {
        e.preventDefault();
        handleRelease();
    }, { passive: false });

    gpsBtn.addEventListener('touchcancel', function() {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = null;
    });

    // Mouse events (desktop only — skip if touch was used)
    gpsBtn.addEventListener('mousedown', function(e) {
        if (usedTouch) { usedTouch = false; return; }
        e.preventDefault();
        handlePress();
    });

    gpsBtn.addEventListener('mouseup', function(e) {
        if (usedTouch) return;
        e.preventDefault();
        handleRelease();
    });

    gpsBtn.addEventListener('mouseleave', function() {
        if (pressTimer) clearTimeout(pressTimer);
    });
})();
