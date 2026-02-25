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

const state = {
  mode: "idle",
  bus: null,
  user: null,
  busSpeedKmh: null,
  employees: {},
  attendance: {},
  announceAt: 0,
  announced: false,
  lastAnnouncedTargetKey: null,
  driverOfflineReason: "",
  driverOfflineAnnounced: false,
  driverSharingActive: null,
  userWatchId: null,
  firebaseApp: null,
  firebaseDb: null,
  firebaseFns: null,
  liveUnsub: null,
  employeesUnsub: null,
  attendanceUnsub: null,
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
const stopLayer = L.layerGroup().addTo(map);

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
if (els.testVoice) {
  els.testVoice.addEventListener("click", () => speak("Servis yaklaştı. Hazır ol."));
}
if (els.tabMap && els.tabSettings) {
  els.tabMap.addEventListener("click", () => setHomeView("map"));
  els.tabSettings.addEventListener("click", () => setHomeView("settings"));
}
setMapType(loadMapTypePreference());
setHomeView(loadHomeViewPreference());

renderStops();
updateMetrics();

if (config.firebase && config.firebase.enabled) {
  connectFirebaseAuto();
} else {
  setMode("idle");
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setSystemNote(message) {
  if (els.systemNote) {
    els.systemNote.textContent = message;
  }
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

function normalizeEmployees(raw) {
  const normalized = {};
  if (!raw || typeof raw !== "object") {
    return normalized;
  }
  for (const [id, value] of Object.entries(raw)) {
    if (!value || !Number.isFinite(Number(value.lat)) || !Number.isFinite(Number(value.lng))) {
      continue;
    }
    const name = String(value.name || "").trim();
    if (!name) {
      continue;
    }
    normalized[id] = {
      id,
      name,
      lat: Number(value.lat),
      lng: Number(value.lng),
      phone: String(value.phone || ""),
      note: String(value.note || ""),
      createdAt: Number(value.createdAt || 0),
      routeOrder: Number(value.routeOrder || 0)
    };
  }
  return normalized;
}

function normalizeAttendance(raw) {
  const normalized = {};
  if (!raw || typeof raw !== "object") {
    return normalized;
  }
  for (const [employeeId, value] of Object.entries(raw)) {
    normalized[employeeId] = {
      willRide: value && value.willRide !== false,
      note: String((value && value.note) || ""),
      updatedAt: Number((value && value.updatedAt) || 0)
    };
  }
  return normalized;
}

function sortedEmployees() {
  return Object.values(state.employees).sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

function getAttendance(employeeId) {
  return state.attendance[employeeId] || null;
}

function isEmployeeActiveToday(employeeId) {
  const record = getAttendance(employeeId);
  return !record || record.willRide !== false;
}

function renderStops() {
  stopLayer.clearLayers();
  const employees = sortedEmployees();
  for (const employee of employees) {
    const activeToday = isEmployeeActiveToday(employee.id);
    const extraClass = activeToday ? "active" : "passive";
    const icon = L.divIcon({ className: `marker stop ${extraClass}` });
    const marker = L.marker([employee.lat, employee.lng], { icon }).addTo(stopLayer);
    const statusText = activeToday ? "gelecek" : "gelmeyecek";
    marker.bindTooltip(`${employee.name} (${statusText})`, { direction: "top", offset: [0, -8] });
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
        lng: position.coords.longitude
      };
      userMarker.addTo(map).setLatLng([state.user.lat, state.user.lng]);
      updateMetrics();
    },
    (error) => {
      setSystemNote(`Konum alinamadi: ${error.message}`);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
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

function getNearestActiveStop() {
  if (!state.bus) {
    return null;
  }
  let nearest = null;
  for (const employee of sortedEmployees()) {
    if (!isEmployeeActiveToday(employee.id)) {
      continue;
    }
    const distance = distanceMeters(state.bus, employee);
    if (!nearest || distance < nearest.distance) {
      nearest = { employee, distance };
    }
  }
  return nearest;
}

function getTarget() {
  const nearest = getNearestActiveStop();
  if (!nearest) {
    return {
      kind: "none",
      key: null,
      name: null,
      stop: null,
      distance: null
    };
  }

  return {
    kind: "nearest",
    key: nearest.employee.id,
    name: nearest.employee.name,
    stop: nearest.employee,
    distance: nearest.distance
  };
}

function updateMetrics() {
  const target = getTarget();
  const radius = Number(els.radiusInput ? els.radiusInput.value : announceRadius);

  if (els.targetStopText && target.stop) {
    els.targetStopText.textContent = `Hedef durak: ${target.name}`;
  } else if (els.targetStopText && state.user) {
    els.targetStopText.textContent = "Hedef durak: Konumum";
  } else if (els.targetStopText) {
    els.targetStopText.textContent = "Hedef durak: --";
  }

  if (state.driverOfflineReason) {
    if (els.distanceValue) els.distanceValue.textContent = "--";
    if (els.etaValue) els.etaValue.textContent = "Tahmini Varış: --";
    if (els.alertStatus) els.alertStatus.textContent = "Şoför konum paylaşmıyor";
    return;
  }

  if (!state.bus) {
    if (els.distanceValue) els.distanceValue.textContent = "--";
    if (els.etaValue) els.etaValue.textContent = "Tahmini Varış: --";
    if (els.alertStatus) els.alertStatus.textContent = "Beklemede";
    return;
  }

  let distance = target.distance;
  if (!target.stop && state.user) {
    distance = distanceMeters(state.bus, state.user);
  }

  if (!Number.isFinite(distance)) {
    if (els.distanceValue) els.distanceValue.textContent = "--";
    if (els.etaValue) els.etaValue.textContent = "Tahmini Varış: --";
    if (els.alertStatus) els.alertStatus.textContent = "Durak bekleniyor";
    state.announced = false;
    state.lastAnnouncedTargetKey = null;
    return;
  }

  if (els.distanceValue) els.distanceValue.textContent = formatDistance(distance);
  if (els.etaValue) els.etaValue.textContent = `Tahmini Varış: ${formatEta(distance)}`;

  if (distance <= radius) {
    if (els.alertStatus) els.alertStatus.textContent = "Yakın";
    maybeAnnounceStop(target.key, target.name || "durak");
  } else {
    if (els.alertStatus) els.alertStatus.textContent = "Beklemede";
    state.announced = false;
    state.lastAnnouncedTargetKey = null;
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

function maybeAnnounceStop(targetKey, targetName) {
  if (!els.voiceToggle || !els.voiceToggle.checked) return;
  const now = Date.now();
  const isNewTarget = targetKey && targetKey !== state.lastAnnouncedTargetKey;
  if (!state.announced || isNewTarget || now - state.announceAt > 120000) {
    speak(`${targetName} duragina yaklasiliyor.`);
    state.announced = true;
    state.announceAt = now;
    state.lastAnnouncedTargetKey = targetKey;
  }
}

function maybeAnnounceDriverOffline() {
  if (!els.voiceToggle || !els.voiceToggle.checked) return;
  if (state.driverOfflineAnnounced) return;
  speak("Uyarı! Şoför konum paylaşmıyor.");
  state.driverOfflineAnnounced = true;
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    setSystemNote("Tarayici ses destegi yok.");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "tr-TR";
  const voices = speechSynthesis.getVoices();
  const trVoice = voices.find((voice) => voice.lang && voice.lang.startsWith("tr"));
  if (trVoice) {
    utterance.voice = trVoice;
  }
  speechSynthesis.speak(utterance);
}

function centerMap() {
  const points = [];
  if (state.bus) points.push([state.bus.lat, state.bus.lng]);
  if (state.user) points.push([state.user.lat, state.user.lng]);
  for (const employee of sortedEmployees()) {
    points.push([employee.lat, employee.lng]);
  }
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
  if (state.employeesUnsub) {
    state.employeesUnsub();
    state.employeesUnsub = null;
  }
  if (state.attendanceUnsub) {
    state.attendanceUnsub();
    state.attendanceUnsub = null;
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

    state.employees = {};
    state.attendance = {};
    state.driverSharingActive = null;
    state.lastLiveTs = 0;
    renderStops();
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

    state.employeesUnsub = firebase.onValue(
      firebase.ref(state.firebaseDb, `${basePath}/employees`),
      (snapshot) => {
        state.employees = normalizeEmployees(snapshot.val());
        renderStops();
        updateMetrics();
      },
      (error) => {
        setSystemNote(`Eleman verisi hatasi: ${error.message}`);
      }
    );

    state.attendanceUnsub = firebase.onValue(
      firebase.ref(state.firebaseDb, `${basePath}/attendance/${todayKey()}`),
      (snapshot) => {
        state.attendance = normalizeAttendance(snapshot.val());
        renderStops();
        updateMetrics();
      },
      (error) => {
        setSystemNote(`Durum verisi hatası: ${error.message}`);
      }
    );

    setMode("live");
    setSystemNote("Tek servis canlı verisi izleniyor.");
    startShareMonitor();
    evaluateDriverSharing();
  } catch (error) {
    setMode("offline");
    setSystemNote(`Firebase bağlantısı başarısız: ${error.message}`);
  }
}
