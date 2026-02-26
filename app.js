const config = window.__APP_CONFIG || {};

const els = {
  statusPill: document.getElementById("statusPill"),
  centerBtn: document.getElementById("centerBtn"),
  locateBtn: document.getElementById("locateBtn"),
  distanceValue: document.getElementById("distanceValue"),
  etaValue: document.getElementById("etaValue"),
  targetStopText: document.getElementById("targetStopText"),
  alertStatus: document.getElementById("alertStatus"),
  radiusInput: document.getElementById("radiusInput"),
  radiusText: document.getElementById("radiusText"),
  voiceToggle: document.getElementById("voiceToggle"),
  testVoice: document.getElementById("testVoice"),
  mapTypeBtn: document.getElementById("mapTypeBtn"),
  logoSwitch: document.getElementById("indexLogoSwitch"),
  tabMap: document.getElementById("indexTabMap"),
  tabSettings: document.getElementById("indexTabSettings"),
  mapView: document.getElementById("indexMapView"),
  settingsView: document.getElementById("indexSettingsView")
};

const storage = {
  getNumber(key, fallback) {
    const raw = localStorage.getItem(key);
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  },
  getJSON(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  setJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const serviceId = String(config.singleServiceId || "ana-servis").trim() || "ana-servis";
const defaultCenter = config.defaultCenter || { lat: 39.93, lng: 32.85 };
const defaultZoom = config.defaultZoom || 12;
const announceRadius = config.announceRadiusMeters || 600;
const driverOfflineTimeoutMs = Math.max(15000, Number(config.driverOfflineTimeoutMs) || 90000);
const liveAccuracyMaxMeters = Math.max(10, Number(config.liveAccuracyMaxMeters) || 50);

const state = {
  mode: "idle",
  bus: null,
  user: null,
  busSpeedKmh: null,
  driverOfflineReason: "",
  driverOfflineAnnounced: false,
  driverSharingActive: null,
  userWatchId: null,
  firebaseApp: null,
  firebaseDb: null,
  firebaseFns: null,
  liveUnsub: null,
  approachAlertActive: false,
  shareMonitorTimer: null,
  lastBusPoint: null,
  lastLiveTs: 0,
  mapType: "street",
  activeView: "map"
};

const map = L.map("map", { zoomControl: false }).setView([defaultCenter.lat, defaultCenter.lng], defaultZoom);
L.control.zoom({ position: "bottomright" }).addTo(map);
const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap"
});
const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  attribution: "Tiles &copy; Esri"
});

const busIcon = L.divIcon({ className: "marker bus" });
const userIcon = L.divIcon({ className: "marker user" });
const busMarker = L.marker([defaultCenter.lat, defaultCenter.lng], { icon: busIcon });
const userMarker = L.marker([defaultCenter.lat, defaultCenter.lng], { icon: userIcon });

const initialRadius = storage.getNumber("ak.radius", announceRadius);
if (els.radiusInput) {
  els.radiusInput.value = initialRadius;
}
if (els.radiusText) {
  els.radiusText.textContent = `${initialRadius} m`;
}

if (els.centerBtn) {
  els.centerBtn.addEventListener("click", centerMap);
}
if (els.locateBtn) {
  els.locateBtn.addEventListener("click", startUserTracking);
}
if (els.mapTypeBtn) {
  els.mapTypeBtn.addEventListener("click", toggleMapType);
}
if (els.radiusInput) {
  els.radiusInput.addEventListener("input", () => {
    const radius = Number(els.radiusInput.value);
    storage.setJSON("ak.radius", radius);
    if (els.radiusText) {
      els.radiusText.textContent = `${radius} m`;
    }
    updateMetrics();
  });
}
if (els.voiceToggle) {
  els.voiceToggle.addEventListener("change", () => {
    if (!els.voiceToggle.checked) {
      stopApproachAlertLoop();
    }
    updateMetrics();
  });
}
if (els.testVoice) {
  els.testVoice.addEventListener("click", () => speak("Servis yaklaştı. Hazır ol."));
}
if (els.tabMap && els.tabSettings) {
  els.tabMap.addEventListener("click", () => setHomeView("map"));
  els.tabSettings.addEventListener("click", () => setHomeView("settings"));
}
setupLogoSwitch("driver.html");
setMapType(loadMapTypePreference());
setHomeView(loadHomeViewPreference());

updateMetrics();

if (config.firebase && config.firebase.enabled) {
  connectFirebaseAuto();
} else {
  setMode("idle");
}

function setSystemNote(message) {
  if (els.systemNote) {
    els.systemNote.textContent = message;
  }
}

function setupLogoSwitch(targetUrl) {
  if (!els.logoSwitch) {
    return;
  }
  let tapCount = 0;
  let tapTimer = null;
  els.logoSwitch.addEventListener("click", () => {
    tapCount += 1;
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = null;
    }
    if (tapCount >= 3) {
      window.location.href = targetUrl;
      return;
    }
    tapTimer = setTimeout(() => {
      tapCount = 0;
      tapTimer = null;
    }, 900);
  });
}

function loadHomeViewPreference() {
  try {
    const value = String(localStorage.getItem("ak.indexView") || "").trim();
    return value === "settings" ? "settings" : "map";
  } catch {
    return "map";
  }
}

function setHomeView(view) {
  const nextView = view === "settings" ? "settings" : "map";
  state.activeView = nextView;
  try {
    localStorage.setItem("ak.indexView", nextView);
  } catch {
    // ignore storage errors in strict browser modes
  }

  const isMap = nextView === "map";
  if (els.mapView) {
    els.mapView.classList.toggle("active", isMap);
  }
  if (els.settingsView) {
    els.settingsView.classList.toggle("active", !isMap);
  }
  if (els.tabMap) {
    els.tabMap.classList.toggle("active", isMap);
    els.tabMap.setAttribute("aria-selected", isMap ? "true" : "false");
  }
  if (els.tabSettings) {
    els.tabSettings.classList.toggle("active", !isMap);
    els.tabSettings.setAttribute("aria-selected", !isMap ? "true" : "false");
  }

  if (isMap) {
    window.setTimeout(() => {
      map.invalidateSize();
      centerMap();
    }, 60);
  }
}

function loadMapTypePreference() {
  try {
    const value = String(localStorage.getItem("ak.mapType") || "").trim();
    return value === "satellite" ? "satellite" : "street";
  } catch {
    return "street";
  }
}

function setMapType(nextType) {
  const mapType = nextType === "satellite" ? "satellite" : "street";
  if (map.hasLayer(streetLayer)) {
    map.removeLayer(streetLayer);
  }
  if (map.hasLayer(satelliteLayer)) {
    map.removeLayer(satelliteLayer);
  }
  if (mapType === "satellite") {
    satelliteLayer.addTo(map);
  } else {
    streetLayer.addTo(map);
  }
  state.mapType = mapType;
  try {
    localStorage.setItem("ak.mapType", mapType);
  } catch {
    // ignore storage errors in strict browser modes
  }
  if (els.mapTypeBtn) {
    els.mapTypeBtn.textContent = mapType === "satellite" ? "Normal Harita" : "Uydu Aç";
  }
}

function toggleMapType() {
  setMapType(state.mapType === "satellite" ? "street" : "satellite");
}

function setMode(mode) {
  state.mode = mode;
  const pillText = mode === "live"
    ? "LIVE"
    : mode === "offline"
        ? "UYARI"
        : "BOS";
  const pillBg = mode === "live"
    ? "rgba(43, 179, 163, 0.2)"
    : mode === "offline"
        ? "rgba(239, 68, 68, 0.2)"
        : "rgba(120, 130, 150, 0.18)";

  if (els.statusPill) {
    els.statusPill.textContent = pillText;
    els.statusPill.style.background = pillBg;
  }
}

function startUserTracking() {
  if (!navigator.geolocation) {
    setSystemNote("Tarayici konum destegi yok.");
    return;
  }
  if (state.userWatchId !== null) {
    setSystemNote("Konum takibi zaten acik.");
    return;
  }
  state.userWatchId = navigator.geolocation.watchPosition(
    (position) => {
      state.user = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: Number(position.coords.accuracy || 0)
      };
      userMarker.addTo(map).setLatLng([state.user.lat, state.user.lng]);
      if (Number.isFinite(state.user.accuracy) && state.user.accuracy > 80) {
        setSystemNote(`Konum dogrulugu dusuk (±${Math.round(state.user.accuracy)} m).`);
      }
      updateMetrics();
    },
    (error) => {
      setSystemNote(`Konum alinamadi: ${error.message}`);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
  setSystemNote("Konum takibi acildi.");
}

function clearBusLocation() {
  state.bus = null;
  state.busSpeedKmh = null;
  state.lastBusPoint = null;
  if (els.lastUpdate) {
    els.lastUpdate.textContent = "--";
  }
  if (els.speedValue) {
    els.speedValue.textContent = "--";
  }
  if (map.hasLayer(busMarker)) {
    map.removeLayer(busMarker);
  }
}

function setBusLocation(latlng, sourceTs) {
  const now = Date.now();
  if (state.lastBusPoint) {
    const dist = distanceMeters(state.lastBusPoint, latlng);
    const elapsedSeconds = (now - state.lastBusPoint.ts) / 1000;
    if (elapsedSeconds > 2) {
      const speed = (dist / elapsedSeconds) * 3.6;
      if (Number.isFinite(speed)) {
        state.busSpeedKmh = speed;
      }
    }
  }

  state.bus = {
    lat: Number(latlng.lat),
    lng: Number(latlng.lng),
    ts: Number(sourceTs || now)
  };
  state.lastBusPoint = { lat: state.bus.lat, lng: state.bus.lng, ts: now };

  if (!map.hasLayer(busMarker)) {
    busMarker.addTo(map);
  }
  busMarker.setLatLng([state.bus.lat, state.bus.lng]);

  if (els.lastUpdate) {
    els.lastUpdate.textContent = formatTime(state.bus.ts);
  }
  if (Number.isFinite(state.busSpeedKmh) && els.speedValue) {
    els.speedValue.textContent = `${state.busSpeedKmh.toFixed(1)} km/h`;
  }

  updateMetrics();
}

function updateMetrics() {
  const radius = Number(els.radiusInput ? els.radiusInput.value : announceRadius);

  if (els.targetStopText && state.user) {
    els.targetStopText.textContent = "Hedef konum: Konumum";
  } else if (els.targetStopText) {
    els.targetStopText.textContent = "Hedef konum: Konumu ac";
  }

  if (state.driverOfflineReason) {
    stopApproachAlertLoop();
    if (els.distanceValue) els.distanceValue.textContent = "--";
    if (els.etaValue) els.etaValue.textContent = "Tahmini Varış: --";
    if (els.alertStatus) els.alertStatus.textContent = "Şoför konum paylaşmıyor";
    return;
  }

  if (!state.user) {
    stopApproachAlertLoop();
    if (els.distanceValue) els.distanceValue.textContent = "--";
    if (els.etaValue) els.etaValue.textContent = "Tahmini Varış: --";
    if (els.alertStatus) els.alertStatus.textContent = "Konumunu ac";
    return;
  }

  if (!state.bus) {
    stopApproachAlertLoop();
    if (els.distanceValue) els.distanceValue.textContent = "--";
    if (els.etaValue) els.etaValue.textContent = "Tahmini Varış: --";
    if (els.alertStatus) els.alertStatus.textContent = "Servis bekleniyor";
    return;
  }

  const distance = distanceMeters(state.bus, state.user);
  if (els.distanceValue) els.distanceValue.textContent = formatDistance(distance);
  if (els.etaValue) els.etaValue.textContent = `Tahmini Varış: ${formatEta(distance)}`;

  if (distance <= radius) {
    if (els.alertStatus) els.alertStatus.textContent = "Yakın";
    startApproachAlertLoop();
  } else {
    stopApproachAlertLoop();
    if (els.alertStatus) els.alertStatus.textContent = "Beklemede";
  }
}

function formatDistance(distance) {
  if (!Number.isFinite(distance)) return "--";
  if (distance < 1000) return `${Math.round(distance)} m`;
  return `${(distance / 1000).toFixed(2)} km`;
}

function formatEta(distance) {
  if (!Number.isFinite(distance) || !Number.isFinite(state.busSpeedKmh) || state.busSpeedKmh < 5) {
    return "--";
  }
  const hours = distance / 1000 / state.busSpeedKmh;
  const minutes = Math.round(hours * 60);
  return `${minutes} dk`;
}

function formatTime(ts) {
  if (!ts) return "--";
  return new Date(ts).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function distanceMeters(a, b) {
  const R = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function startApproachAlertLoop() {
  if (!els.voiceToggle || !els.voiceToggle.checked) return;
  if (state.approachAlertActive) return;
  state.approachAlertActive = true;
  speakApproachLoop();
}

function stopApproachAlertLoop() {
  if (!state.approachAlertActive) return;
  state.approachAlertActive = false;
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }
}

function speakApproachLoop() {
  if (!state.approachAlertActive || !els.voiceToggle || !els.voiceToggle.checked) {
    return;
  }
  const utterance = createUtterance("Şoför yaklaştı.");
  if (!utterance) {
    state.approachAlertActive = false;
    return;
  }
  utterance.onend = () => {
    speakApproachLoop();
  };
  utterance.onerror = () => {
    if (!state.approachAlertActive) {
      return;
    }
    setTimeout(() => speakApproachLoop(), 80);
  };
  speechSynthesis.speak(utterance);
}

function maybeAnnounceDriverOffline() {
  if (!els.voiceToggle || !els.voiceToggle.checked) return;
  if (state.driverOfflineAnnounced) return;
  speak("Uyarı! Şoför konum paylaşmıyor.");
  state.driverOfflineAnnounced = true;
}

function speak(text, options = {}) {
  const skipIfBusy = !!options.skipIfBusy;
  const utterance = createUtterance(text);
  if (!utterance) {
    return;
  }
  if (skipIfBusy && (speechSynthesis.speaking || speechSynthesis.pending)) {
    return;
  }
  speechSynthesis.speak(utterance);
}

function createUtterance(text) {
  if (!("speechSynthesis" in window)) {
    setSystemNote("Tarayici ses destegi yok.");
    return null;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "tr-TR";
  const voices = speechSynthesis.getVoices();
  const trVoice = voices.find((voice) => voice.lang && voice.lang.startsWith("tr"));
  if (trVoice) {
    utterance.voice = trVoice;
  }
  return utterance;
}

function centerMap() {
  const points = [];
  if (state.bus) points.push([state.bus.lat, state.bus.lng]);
  if (state.user) points.push([state.user.lat, state.user.lng]);
  if (!points.length) {
    map.setView([defaultCenter.lat, defaultCenter.lng], defaultZoom);
    return;
  }
  const bounds = L.latLngBounds(points);
  map.fitBounds(bounds.pad(0.25));
}

function getFirebaseConfigIssue() {
  const firebaseRoot = config.firebase;
  if (!firebaseRoot || !firebaseRoot.config) {
    return "Firebase config bulunamadi.";
  }
  const cfg = firebaseRoot.config;
  const required = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"];
  for (const key of required) {
    const value = String(cfg[key] || "").trim();
    if (!value || value.includes("REPLACE_ME")) {
      return `${key} ayari eksik. config.js icini Firebase bilgileri ile doldur.`;
    }
  }
  const dbUrl = String(cfg.databaseURL || "").trim();
  if (!/^https:\/\/.+/i.test(dbUrl)) {
    return "databaseURL hatali. Ornek: https://<db-adi>.firebaseio.com";
  }
  return "";
}

function getNormalizedFirebaseConfig() {
  const cfg = config.firebase.config;
  return {
    ...cfg,
    databaseURL: String(cfg.databaseURL || "").trim().replace(/\/+$/, "")
  };
}

async function ensureFirebase() {
  if (!config.firebase || !config.firebase.enabled) {
    throw new Error("Firebase kapali");
  }
  const issue = getFirebaseConfigIssue();
  if (issue) {
    throw new Error(issue);
  }
  if (!state.firebaseFns) {
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js");
    const { getDatabase, ref, onValue } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js");
    state.firebaseApp = getApps().length ? getApps()[0] : initializeApp(getNormalizedFirebaseConfig());
    state.firebaseDb = getDatabase(state.firebaseApp);
    state.firebaseFns = { ref, onValue };
  }
  return state.firebaseFns;
}

function stopFirebaseSubscriptions() {
  if (state.liveUnsub) {
    state.liveUnsub();
    state.liveUnsub = null;
  }
}

function stopShareMonitor() {
  if (state.shareMonitorTimer) {
    clearInterval(state.shareMonitorTimer);
    state.shareMonitorTimer = null;
  }
}

function startShareMonitor() {
  stopShareMonitor();
  state.shareMonitorTimer = setInterval(evaluateDriverSharing, 10000);
}

function setDriverOffline(reason) {
  const reasonChanged = state.driverOfflineReason !== reason;
  state.driverOfflineReason = reason;
  if (reasonChanged) {
    state.driverOfflineAnnounced = false;
  }
  stopApproachAlertLoop();
  clearBusLocation();
  setMode("offline");
  if (reasonChanged) {
    setSystemNote(reason);
  }
  maybeAnnounceDriverOffline();
  updateMetrics();
}

function clearDriverOffline() {
  if (!state.driverOfflineReason) {
    return;
  }
  state.driverOfflineReason = "";
  state.driverOfflineAnnounced = false;
  setMode("live");
  setSystemNote("Canli konum aliniyor.");
  updateMetrics();
}

function evaluateDriverSharing() {
  if (!(config.firebase && config.firebase.enabled)) {
    return;
  }
  if (state.driverSharingActive === false) {
    setDriverOffline("Şoför konum paylaşmıyor.");
    return;
  }
  if (state.driverSharingActive !== true || !state.lastLiveTs) {
    setDriverOffline("Şoför henuz konum paylaşmadı.");
    return;
  }
  if (Date.now() - state.lastLiveTs > driverOfflineTimeoutMs) {
    setDriverOffline("Şoför konum paylaşmıyor.");
    return;
  }
  clearDriverOffline();
}

async function connectFirebaseAuto() {
  try {
    const firebase = await ensureFirebase();

    state.driverSharingActive = null;
    state.lastLiveTs = 0;
    updateMetrics();

    const basePath = `${config.firebase.busPath || "buses"}/${serviceId}`;
    stopFirebaseSubscriptions();

    state.liveUnsub = firebase.onValue(
      firebase.ref(state.firebaseDb, `${basePath}/live`),
      (snapshot) => {
        const data = snapshot.val();

        if (!data) {
          state.driverSharingActive = null;
          state.lastLiveTs = 0;
          setDriverOffline("Şoför henuz konum paylaşmadı.");
          return;
        }

        if (data.isSharing === false) {
          state.driverSharingActive = false;
          state.lastLiveTs = Number(data.ts || 0);
          setDriverOffline("Şoför konum paylaşmıyor.");
          return;
        }

        if (Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng))) {
          const accuracy = Number(data.accuracy || 0);
          if (Number.isFinite(accuracy) && accuracy > liveAccuracyMaxMeters) {
            setSystemNote(`Sofor GPS dogrulugu dusuk (±${Math.round(accuracy)} m), daha iyi konum bekleniyor.`);
            return;
          }
          state.driverSharingActive = true;
          state.lastLiveTs = Number(data.ts || Date.now());
          if (Number.isFinite(Number(data.speedKmh))) {
            state.busSpeedKmh = Number(data.speedKmh);
            if (els.speedValue) {
              els.speedValue.textContent = `${state.busSpeedKmh.toFixed(1)} km/h`;
            }
          }
          clearDriverOffline();
          setBusLocation({ lat: Number(data.lat), lng: Number(data.lng) }, data.ts);
          return;
        }

        state.driverSharingActive = null;
        state.lastLiveTs = 0;
        setDriverOffline("Şoför henuz konum paylaşmadı.");
      },
      (error) => {
        setDriverOffline(`Canlı veri hatası: ${error.message}`);
      }
    );

    setMode("live");
    setSystemNote("Canli servis verisi izleniyor.");
    startShareMonitor();
    evaluateDriverSharing();
  } catch (error) {
    setMode("offline");
    setSystemNote(`Firebase bağlantısı başarısız: ${error.message}`);
  }
}
