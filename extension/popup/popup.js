const $ = (id) => document.getElementById(id);
const DEFAULT_SERVER = "http://127.0.0.1:8765";

$("logo").innerHTML = CC.ui.logo;

const api = (method, path, body) => chrome.runtime.sendMessage({ type: "api", method, path, body });

async function checkServer() {
  const el = $("server");
  const res = await api("GET", "/api/health");
  if (res.ok) {
    el.className = "pp-server is-up";
    el.lastElementChild.textContent = res.data.device === "cuda" ? "Server on · GPU" : "Server on · CPU";
    $("offline").hidden = true;
    return true;
  }
  el.className = "pp-server is-down";
  el.lastElementChild.textContent = "Server off";
  $("offline").hidden = false;
  return false;
}

async function checkTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  let status = null;
  try {
    status = await chrome.tabs.sendMessage(tab.id, { type: "panel-status" });
  } catch {
    return; // not a supported page
  }
  const btn = $("toggle");
  if (status.song) {
    $("tab-info").textContent = `${status.site}: ${status.song.title}${status.song.artist ? " · " + status.song.artist : ""}`;
    $("tab-info").classList.remove("pp-dim");
  } else {
    $("tab-info").textContent = `${status.site}: play a song and its chords appear here.`;
  }
  btn.hidden = !status.song;
  btn.textContent = status.visible ? "Hide chords panel" : "Show chords panel";
  btn.onclick = async () => {
    const r = await chrome.tabs.sendMessage(tab.id, { type: "toggle-panel" });
    btn.textContent = r.visible ? "Hide chords panel" : "Show chords panel";
  };
}

async function checkDesktop() {
  const res = await api("GET", "/api/now-playing");
  if (!res.ok) return;
  const np = res.data;
  if (np.title) {
    $("desktop-info").textContent = `${np.playing ? "Playing" : "Paused"}: ${np.title}${np.artist ? " · " + np.artist : ""}`;
    $("desktop-info").classList.remove("pp-dim");
  }
}

$("companion").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "open-companion" });
  window.close();
};

async function loadSettings() {
  const got = await chrome.storage.local.get(["autoAnalyze", "serverUrl"]);
  $("auto").value = got.autoAnalyze || "music";
  $("server-url").value = got.serverUrl || DEFAULT_SERVER;
}

$("auto").onchange = () => chrome.storage.local.set({ autoAnalyze: $("auto").value });

$("save-url").onclick = async () => {
  const note = $("url-note");
  let url;
  try {
    url = new URL($("server-url").value.trim());
  } catch {
    note.textContent = "That isn't a valid address.";
    return;
  }
  const origin = `${url.protocol}//${url.host}/*`;
  // Addresses other than the default need the user to grant access.
  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted && url.origin !== new URL(DEFAULT_SERVER).origin) {
    note.textContent = "Permission to reach that address was not granted.";
    return;
  }
  await chrome.storage.local.set({ serverUrl: url.origin });
  note.textContent = "Saved.";
  checkServer();
};

loadSettings();
checkServer().then((up) => up && checkDesktop());
checkTab();
