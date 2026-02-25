const config = window.__APP_CONFIG || {};

const els = {
  status: document.getElementById("driverStatus"),
  centerBtn: document.getElementById("driverCenterBtn"),
  serviceLabel: document.getElementById("driverServiceLabel"),
  startShare: document.getElementById("startShare"),
  stopShare: document.getElementById("stopShare"),
  coords: document.getElementById("driverCoords"),
  last: document.getElementById("driverLast"),
  note: document.getElementById("driverNote"),
  selectedPointText: document.getElementById("selectedPointText"),
  listSummary: document.getElementById("listSummary"),
  employeeNameInput: document.getElementById("employeeNameInput"),
  employeePhoneInput: document.getElementById("employeePhoneInput"),
  employeeNoteInput: document.getElementById("employeeNoteInput"),
  useMyLocationAsStop: document.getElementById("useMyLocationAsStop"),
  saveEmployeeStop: document.getElementById("saveEmployeeStop"),
  clearFormBtn: document.getElementById("clearFormBtn"),
  dailyNoteInput: document.getElementById("dailyNoteInput"),
  employeeList: document.getElementById("employeeList"),
  tabMap: document.getElementById("driverTabMap"),
  tabSettings: document.getElementById("driverTabSettings"),
  mapView: document.getElementById("driverMapView"),
  settingsView: document.getElementById("driverSettingsView"),
  mapTypeBtn: document.getElementById("driverMapTypeBtn"),
  followBtn: document.getElementById("driverFollowBtn")
};

const defaultCenter = config.defaultCenter || { lat: 39.93, lng: 32.85 };
const defaultZoom = config.defaultZoom || 12;
const serviceId = String(config.singleServiceId || "ana-servis").trim() || "ana-servis";

const state = {
  watchId: null,
  livePosition: null,
  selectedPoint: null,
  editingEmployeeId: "",
  employees: {},
  attendance: {},
  firebaseApp: null,
  firebaseDb: null,
  firebaseFns: null,
  liveUnsub: null,
  employeesUnsub: null,
  attendanceUnsub: null,
  activeView: "map",
  mapType: "street",
  followMode: false
};

if (els.serviceLabel) {
  els.serviceLabel.textContent = `${serviceId} (otomatik)`;
}

const map = L.map("driverMap", { zoomControl: false }).setView([defaultCenter.lat, defaultCenter.lng], defaultZoom);
L.control.zoom({ position: "bottomright" }).addTo(map);
const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap"
});
const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  attribution: "Tiles &copy; Esri"
});

const liveIcon = L.divIcon({ className: "marker bus" });
const selectedIcon = L.divIcon({ className: "marker stop own" });
const liveMarker = L.marker([defaultCenter.lat, defaultCenter.lng], { icon: liveIcon });
const selectedMarker = L.marker([defaultCenter.lat, defaultCenter.lng], { icon: selectedIcon });
const employeeLayer = L.layerGroup().addTo(map);

els.centerBtn.addEventListener("click", () => {
  setDriverView("map");
  if (state.followMode && state.livePosition) {
    followLivePosition(true);
  } else {
    centerMap();
  }
});
els.startShare.addEventListener("click", startSharing);
els.stopShare.addEventListener("click", stopSharing);
els.useMyLocationAsStop.addEventListener("click", useLiveLocationAsStop);
els.saveEmployeeStop.addEventListener("click", saveEmployeeStop);
els.clearFormBtn.addEventListener("click", clearEmployeeForm);
els.employeeList.addEventListener("click", onEmployeeListClick);
if (els.mapTypeBtn) {
  els.mapTypeBtn.addEventListener("click", toggleMapType);
}
if (els.followBtn) {
  els.followBtn.addEventListener("click", toggleFollowMode);
}
if (els.tabMap && els.tabSettings) {
  els.tabMap.addEventListener("click", () => setDriverView("map"));
  els.tabSettings.addEventListener("click", () => setDriverView("settings"));
}

map.on("click", (event) => {
  setSelectedPoint(event.latlng);
});

setStatus("BOS");
updateSummary();
renderEmployeeList();
setDriverView(loadPreferredView());
setMapType(loadMapTypePreference());
setFollowMode(loadFollowModePreference());

if (config.firebase && config.firebase.enabled) {
  connectBusDataAuto();
} else {
  setNote("Firebase kapali. config.js icinden firebase.enabled=true yap.");
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function basePath() {
  return `${config.firebase.busPath || "buses"}/${serviceId}`;
}

function setStatus(text) {
  els.status.textContent = text;
  els.status.style.background = text === "LIVE"
    ? "rgba(43, 179, 163, 0.2)"
    : text === "BAGLI"
      ? "rgba(244, 163, 0, 0.25)"
      : "rgba(17, 24, 39, 0.08)";
}

function setNote(text) {
  if (els.note) {
    els.note.textContent = text;
  }
}

function loadFollowModePreference() {
  try {
    return String(localStorage.getItem("ak.driverFollowMode") || "").trim() === "1";
  } catch {
    return false;
  }
}

function setFollowMode(enabled) {
  state.followMode = !!enabled;
  try {
    localStorage.setItem("ak.driverFollowMode", state.followMode ? "1" : "0");
  } catch {
    // ignore storage errors in strict browser modes
  }
  if (els.followBtn) {
    els.followBtn.textContent = state.followMode ? "Navigasyon Kapat" : "Navigasyon Ac";
    els.followBtn.classList.toggle("primary", state.followMode);
    els.followBtn.classList.toggle("ghost", !state.followMode);
  }
  if (state.followMode) {
    followLivePosition(true);
  }
}

function toggleFollowMode() {
  setFollowMode(!state.followMode);
}

function followLivePosition(force = false) {
  if (!state.followMode || !state.livePosition || state.activeView !== "map") {
    return;
  }
  const target = [state.livePosition.lat, state.livePosition.lng];
  if (force) {
    map.setView(target, Math.max(map.getZoom(), 16), { animate: true });
    return;
  }
  map.panTo(target, { animate: true, duration: 0.5 });
}

function loadMapTypePreference() {
  try {
    const value = String(localStorage.getItem("ak.driverMapType") || "").trim();
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
    localStorage.setItem("ak.driverMapType", mapType);
  } catch {
    // ignore storage errors in strict browser modes
  }
  if (els.mapTypeBtn) {
    els.mapTypeBtn.textContent = mapType === "satellite" ? "Normal Harita" : "Uydu Ac";
  }
}

function toggleMapType() {
  setMapType(state.mapType === "satellite" ? "street" : "satellite");
}

function loadPreferredView() {
  try {
    const value = String(localStorage.getItem("ak.driverView") || "").trim();
    return value === "settings" ? "settings" : "map";
  } catch {
    return "map";
  }
}

function setDriverView(view) {
  const nextView = view === "settings" ? "settings" : "map";
  state.activeView = nextView;
  try {
    localStorage.setItem("ak.driverView", nextView);
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
      if (state.followMode && state.livePosition) {
        followLivePosition(true);
      } else {
        centerMap();
      }
    }, 60);
  }
}

function formatTime(ts) {
  if (!ts) return "--";
  return new Date(ts).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatCoord(lat, lng) {
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
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
      phone: String(value.phone || ""),
      note: String(value.note || ""),
      lat: Number(value.lat),
      lng: Number(value.lng),
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

function sortedEmployeesByRoute() {
  return Object.values(state.employees).sort((a, b) => {
    const aOrder = Number.isFinite(Number(a.routeOrder)) && Number(a.routeOrder) > 0 ? Number(a.routeOrder) : null;
    const bOrder = Number.isFinite(Number(b.routeOrder)) && Number(b.routeOrder) > 0 ? Number(b.routeOrder) : null;

    if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if ((aOrder !== null) !== (bOrder !== null)) {
      return aOrder !== null ? -1 : 1;
    }

    const aCreatedAt = Number(a.createdAt || 0);
    const bCreatedAt = Number(b.createdAt || 0);
    const aHasCreatedAt = aCreatedAt > 0;
    const bHasCreatedAt = bCreatedAt > 0;
    if (aHasCreatedAt && bHasCreatedAt && aCreatedAt !== bCreatedAt) {
      return aCreatedAt - bCreatedAt;
    }
    if (aHasCreatedAt !== bHasCreatedAt) {
      return aHasCreatedAt ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "tr");
  });
}

function isEmployeeActiveToday(employeeId) {
  const record = state.attendance[employeeId];
  return !record || record.willRide !== false;
}

function updateSummary() {
  const employees = sortedEmployees();
  const total = employees.length;
  const active = employees.filter((item) => isEmployeeActiveToday(item.id)).length;
  const absent = total - active;
  els.listSummary.textContent = `Toplam: ${total} | Gelecek: ${active} | Gelmeyecek: ${absent}`;
}

function getNextRouteOrder() {
  const orders = Object.values(state.employees)
    .map((employee) => Number(employee.routeOrder || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!orders.length) {
    return 1;
  }
  return Math.max(...orders) + 1;
}

function setSelectedPoint(latlng) {
  state.selectedPoint = { lat: Number(latlng.lat), lng: Number(latlng.lng) };
  selectedMarker.setLatLng([state.selectedPoint.lat, state.selectedPoint.lng]);
  selectedMarker.addTo(map);
  els.selectedPointText.textContent = formatCoord(state.selectedPoint.lat, state.selectedPoint.lng);
}

function fillLiveInfo(payload) {
  els.coords.textContent = formatCoord(payload.lat, payload.lng);
  els.last.textContent = `Son gonderim: ${formatTime(payload.ts)}`;
}

function clearLiveInfo() {
  els.coords.textContent = "--";
  els.last.textContent = "Son gonderim: --";
  if (map.hasLayer(liveMarker)) {
    map.removeLayer(liveMarker);
  }
}

function renderEmployeeMarkers() {
  employeeLayer.clearLayers();
  for (const employee of sortedEmployees()) {
    const activeToday = isEmployeeActiveToday(employee.id);
    const isEditing = employee.id === state.editingEmployeeId;
    const extraClass = isEditing ? "own" : activeToday ? "active" : "passive";
    const icon = L.divIcon({ className: `marker stop ${extraClass}` });
    const marker = L.marker([employee.lat, employee.lng], { icon }).addTo(employeeLayer);
    const statusText = activeToday ? "gelecek" : "gelmeyecek";
    marker.bindTooltip(`${employee.name} (${statusText})`, { direction: "top", offset: [0, -8] });
    marker.on("click", () => {
      loadEmployeeIntoForm(employee.id);
    });
  }
}

function renderEmployeeList() {
  const employees = sortedEmployeesByRoute();
  els.employeeList.innerHTML = "";

  if (!employees.length) {
    els.employeeList.textContent = "Eleman kaydi yok.";
    updateSummary();
    renderEmployeeMarkers();
    return;
  }

  for (let index = 0; index < employees.length; index += 1) {
    const employee = employees[index];
    const attendance = state.attendance[employee.id] || null;
    const activeToday = !attendance || attendance.willRide !== false;
    const row = document.createElement("div");
    row.className = "employee-row";

    const head = document.createElement("div");
    head.className = "employee-head";

    const name = document.createElement("div");
    name.className = "employee-name";
    name.textContent = employee.name;

    const badge = document.createElement("div");
    badge.className = `badge ${activeToday ? "coming" : "absent"}`;
    badge.textContent = activeToday ? "Gelecek" : "Gelmeyecek";

    head.appendChild(name);
    head.appendChild(badge);

    const meta = document.createElement("div");
    meta.className = "employee-meta";
    const noteParts = [`Sira: ${index + 1}`, formatCoord(employee.lat, employee.lng)];
    if (employee.phone) noteParts.push(`Tel: ${employee.phone}`);
    if (employee.note) noteParts.push(`Durak notu: ${employee.note}`);
    if (attendance && attendance.note) noteParts.push(`Bugun notu: ${attendance.note}`);
    meta.textContent = noteParts.join(" | ");

    const actions = document.createElement("div");
    actions.className = "employee-actions";

    const upButton = buildActionButton("Yukari", "ghost", "route-up", employee.id);
    upButton.disabled = index === 0;
    actions.appendChild(upButton);

    const downButton = buildActionButton("Asagi", "ghost", "route-down", employee.id);
    downButton.disabled = index === employees.length - 1;
    actions.appendChild(downButton);

    actions.appendChild(buildActionButton("Duzenle", "ghost", "edit", employee.id));
    actions.appendChild(buildActionButton("Gelecek", "primary", "coming", employee.id));
    actions.appendChild(buildActionButton("Gelmeyecek", "ghost", "absent", employee.id));
    actions.appendChild(buildActionButton("Sil", "ghost", "remove", employee.id));

    row.appendChild(head);
    row.appendChild(meta);
    row.appendChild(actions);
    els.employeeList.appendChild(row);
  }

  updateSummary();
  renderEmployeeMarkers();
}

function buildActionButton(label, type, action, employeeId) {
  const button = document.createElement("button");
  button.className = `btn ${type} tiny`;
  button.type = "button";
  button.dataset.action = action;
  button.dataset.employeeId = employeeId;
  button.textContent = label;
  return button;
}

async function moveRouteOrder(employeeId, direction) {
  if (!config.firebase || !config.firebase.enabled) {
    setNote("Sira guncellemek icin Firebase gerekli.");
    return;
  }

  let firebase;
  try {
    firebase = await ensureFirebase();
  } catch (error) {
    setNote(`Sira guncelleme acilamadi: ${error.message}`);
    return;
  }

  const ordered = sortedEmployeesByRoute();
  const fromIndex = ordered.findIndex((employee) => employee.id === employeeId);
  if (fromIndex < 0) {
    return;
  }

  const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
  if (toIndex < 0 || toIndex >= ordered.length) {
    return;
  }

  const nextOrder = [...ordered];
  const movingEmployee = nextOrder[fromIndex];
  nextOrder[fromIndex] = nextOrder[toIndex];
  nextOrder[toIndex] = movingEmployee;

  try {
    await Promise.all(
      nextOrder.map((employee, index) =>
        firebase.set(firebase.ref(state.firebaseDb, `${basePath()}/employees/${employee.id}/routeOrder`), index + 1)
      )
    );
    setNote("Guzergah sirasi guncellendi.");
  } catch (error) {
    setNote(`Sira guncelleme hatasi: ${error.message}`);
  }
}

function clearEmployeeForm() {
  state.editingEmployeeId = "";
  els.employeeNameInput.value = "";
  els.employeePhoneInput.value = "";
  els.employeeNoteInput.value = "";
  renderEmployeeMarkers();
}

function loadEmployeeIntoForm(employeeId) {
  const employee = state.employees[employeeId];
  if (!employee) return;
  state.editingEmployeeId = employeeId;
  els.employeeNameInput.value = employee.name;
  els.employeePhoneInput.value = employee.phone || "";
  els.employeeNoteInput.value = employee.note || "";
  setSelectedPoint({ lat: employee.lat, lng: employee.lng });
  renderEmployeeMarkers();
  setNote(`${employee.name} duzenleme moduna alindi.`);
}

function centerMap() {
  const points = [];
  if (state.livePosition) {
    points.push([state.livePosition.lat, state.livePosition.lng]);
  }
  if (state.selectedPoint) {
    points.push([state.selectedPoint.lat, state.selectedPoint.lng]);
  }
  for (const employee of sortedEmployees()) {
    points.push([employee.lat, employee.lng]);
  }
  if (!points.length) {
    map.setView([defaultCenter.lat, defaultCenter.lng], defaultZoom);
    return;
  }
  map.fitBounds(L.latLngBounds(points).pad(0.25));
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
    const { getDatabase, ref, onValue, set, remove } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js");
    state.firebaseApp = getApps().length ? getApps()[0] : initializeApp(getNormalizedFirebaseConfig());
    state.firebaseDb = getDatabase(state.firebaseApp);
    state.firebaseFns = { ref, onValue, set, remove };
  }
  return state.firebaseFns;
}

function stopSubscriptions() {
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

async function connectBusDataAuto() {
  if (!config.firebase || !config.firebase.enabled) {
    setStatus("BOS");
    setNote("Firebase kapali. config.js icinde firebase.enabled=true yap.");
    return;
  }

  try {
    const firebase = await ensureFirebase();
    state.employees = {};
    state.attendance = {};
    renderEmployeeList();

    const base = basePath();
    stopSubscriptions();

    state.liveUnsub = firebase.onValue(
      firebase.ref(state.firebaseDb, `${base}/live`),
      (snapshot) => {
        const data = snapshot.val();
        if (!data || data.isSharing === false) {
          state.livePosition = null;
          clearLiveInfo();
          setStatus("BAGLI");
          return;
        }
        if (Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng))) {
          const payload = {
            lat: Number(data.lat),
            lng: Number(data.lng),
            ts: Number(data.ts || Date.now())
          };
          state.livePosition = payload;
          liveMarker.setLatLng([payload.lat, payload.lng]).addTo(map);
          fillLiveInfo(payload);
          followLivePosition();
        }
      },
      (error) => {
        setNote(`Canli konum verisi hatasi: ${error.message}`);
      }
    );

    state.employeesUnsub = firebase.onValue(
      firebase.ref(state.firebaseDb, `${base}/employees`),
      (snapshot) => {
        state.employees = normalizeEmployees(snapshot.val());
        renderEmployeeList();
      },
      (error) => {
        setNote(`Eleman verisi hatasi: ${error.message}`);
      }
    );

    state.attendanceUnsub = firebase.onValue(
      firebase.ref(state.firebaseDb, `${base}/attendance/${todayKey()}`),
      (snapshot) => {
        state.attendance = normalizeAttendance(snapshot.val());
        renderEmployeeList();
      },
      (error) => {
        setNote(`Gunluk durum hatasi: ${error.message}`);
      }
    );

    setStatus(state.watchId !== null ? "LIVE" : "BAGLI");
    setNote("Tek servis otomatik bagli.");
  } catch (error) {
    setStatus("BOS");
    setNote(`Baglanti basarisiz: ${error.message}`);
  }
}

async function startSharing() {
  if (!navigator.geolocation) {
    setNote("Tarayici konum destegi yok.");
    return;
  }
  if (!config.firebase || !config.firebase.enabled) {
    setNote("Canli gonderim icin Firebase gerekli.");
    return;
  }

  if (state.watchId !== null) {
    setNote("Canli konum zaten acik.");
    return;
  }

  let firebase;
  try {
    firebase = await ensureFirebase();
  } catch (error) {
    setNote(`Canli gonderim acilamadi: ${error.message}`);
    return;
  }

  await connectBusDataAuto();

  const livePath = `${basePath()}/live`;
  state.watchId = navigator.geolocation.watchPosition(
    async (position) => {
      const payload = {
        isSharing: true,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        speedKmh: position.coords.speed ? position.coords.speed * 3.6 : null,
        heading: position.coords.heading ?? null,
        ts: Date.now()
      };
      state.livePosition = { lat: payload.lat, lng: payload.lng, ts: payload.ts };
      liveMarker.setLatLng([payload.lat, payload.lng]).addTo(map);
      fillLiveInfo(payload);
      followLivePosition();
      try {
        await firebase.set(firebase.ref(state.firebaseDb, livePath), payload);
        setStatus("LIVE");
        setNote("Canli konum gonderiliyor.");
      } catch (error) {
        setNote(`Konum yazma hatasi: ${error.message}`);
      }
    },
    (error) => {
      setNote(`Konum hatasi: ${error.message}`);
      setStatus("BAGLI");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
  );
}

async function stopSharing() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  if (config.firebase && config.firebase.enabled && state.firebaseFns) {
    try {
      await state.firebaseFns.set(
        state.firebaseFns.ref(state.firebaseDb, `${basePath()}/live`),
        { isSharing: false, ts: Date.now() }
      );
    } catch (error) {
      setNote(`Paylasim durdurma kaydi yazilamadi: ${error.message}`);
    }
  }

  setStatus("BAGLI");
  setNote("Canli konum gonderimi durduruldu.");
}

function useLiveLocationAsStop() {
  if (state.livePosition) {
    setSelectedPoint({ lat: state.livePosition.lat, lng: state.livePosition.lng });
    return;
  }
  if (!navigator.geolocation) {
    setNote("Tarayici konum destegi yok.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setSelectedPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
    },
    (error) => {
      setNote(`Anlik konum alinamadi: ${error.message}`);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
  );
}

function createEmployeeId(name) {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suffix = Date.now().toString(36).slice(-6);
  return `${safe || "eleman"}-${suffix}`;
}

async function saveEmployeeStop() {
  const name = (els.employeeNameInput.value || "").trim();
  if (!name) {
    setNote("Eleman adi zorunlu.");
    return;
  }
  if (!state.selectedPoint) {
    setNote("Haritadan bir durak noktasi secmelisin.");
    return;
  }
  if (!config.firebase || !config.firebase.enabled) {
    setNote("Kayit icin Firebase gerekli.");
    return;
  }

  let firebase;
  try {
    firebase = await ensureFirebase();
  } catch (error) {
    setNote(`Kayit icin Firebase gerekli: ${error.message}`);
    return;
  }

  const employeeId = state.editingEmployeeId || createEmployeeId(name);
  const previous = state.employees[employeeId] || {};
  const payload = {
    name,
    phone: (els.employeePhoneInput.value || "").trim(),
    note: (els.employeeNoteInput.value || "").trim(),
    lat: Number(state.selectedPoint.lat),
    lng: Number(state.selectedPoint.lng),
    createdAt: previous.createdAt || Date.now(),
    routeOrder: previous.routeOrder || getNextRouteOrder(),
    updatedAt: Date.now()
  };

  try {
    await firebase.set(firebase.ref(state.firebaseDb, `${basePath()}/employees/${employeeId}`), payload);
    setNote(`${name} kaydedildi.`);
    clearEmployeeForm();
  } catch (error) {
    setNote(`Kayit hatasi: ${error.message}`);
  }
}

async function updateAttendance(employeeId, willRide) {
  if (!config.firebase || !config.firebase.enabled) {
    setNote("Durum kaydi icin Firebase gerekli.");
    return;
  }

  let firebase;
  try {
    firebase = await ensureFirebase();
  } catch (error) {
    setNote(`Durum icin Firebase gerekli: ${error.message}`);
    return;
  }

  const employee = state.employees[employeeId];
  if (!employee) {
    setNote("Eleman bulunamadi.");
    return;
  }

  const note = (els.dailyNoteInput.value || "").trim();
  const path = `${basePath()}/attendance/${todayKey()}/${employeeId}`;
  try {
    await firebase.set(firebase.ref(state.firebaseDb, path), {
      willRide,
      note,
      employeeName: employee.name,
      updatedAt: Date.now(),
      updatedBy: "driver"
    });
    setNote(`${employee.name} icin bugun durumu guncellendi.`);
  } catch (error) {
    setNote(`Durum kaydi hatasi: ${error.message}`);
  }
}

async function removeEmployee(employeeId) {
  if (!config.firebase || !config.firebase.enabled) {
    setNote("Silme icin Firebase gerekli.");
    return;
  }

  let firebase;
  try {
    firebase = await ensureFirebase();
  } catch (error) {
    setNote(`Silme icin Firebase gerekli: ${error.message}`);
    return;
  }

  const employee = state.employees[employeeId];
  if (!employee) {
    return;
  }

  try {
    await Promise.all([
      firebase.remove(firebase.ref(state.firebaseDb, `${basePath()}/employees/${employeeId}`)),
      firebase.remove(firebase.ref(state.firebaseDb, `${basePath()}/attendance/${todayKey()}/${employeeId}`))
    ]);
    if (state.editingEmployeeId === employeeId) {
      clearEmployeeForm();
    }
    setNote(`${employee.name} silindi.`);
  } catch (error) {
    setNote(`Silme hatasi: ${error.message}`);
  }
}

function onEmployeeListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const employeeId = button.dataset.employeeId;
  const action = button.dataset.action;

  if (action === "edit") {
    loadEmployeeIntoForm(employeeId);
    return;
  }
  if (action === "route-up") {
    moveRouteOrder(employeeId, "up");
    return;
  }
  if (action === "route-down") {
    moveRouteOrder(employeeId, "down");
    return;
  }
  if (action === "coming") {
    updateAttendance(employeeId, true);
    return;
  }
  if (action === "absent") {
    updateAttendance(employeeId, false);
    return;
  }
  if (action === "remove") {
    removeEmployee(employeeId);
  }
}
