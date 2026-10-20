// Service worker: opens the ChordCue panel when the toolbar icon is clicked,
// and is the only part of the extension that talks to the local server.

const DEFAULT_SERVER = "http://127.0.0.1:8765";

// Clicking the icon (or Alt+Shift+C) opens the side panel. Browsers without a
// side panel get the same page in a small window that follows the clicked tab.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} else {
  chrome.action.onClicked.addListener((tab) => {
    chrome.windows.create({
      url: chrome.runtime.getURL(`panel/panel.html?tab=${tab.id}`),
      type: "popup", width: 400, height: 780,
    });
  });
}

async function serverUrl() {
  const { serverUrl: url } = await chrome.storage.local.get("serverUrl");
  return (url || DEFAULT_SERVER).replace(/\/+$/, "");
}

async function api(method, path, body) {
  const base = await serverUrl();
  try {
    const res = await fetch(base + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty or non-JSON body */
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, offline: true, error: String(e), server: base };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "api") {
    api(msg.method, msg.path, msg.body).then(reply);
    return true; // async reply
  }
  return false;
});
