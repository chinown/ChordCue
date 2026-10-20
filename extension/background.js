// Service worker: the only part of the extension that talks to the local
// server. Content scripts run with the page's origin, so the browser would
// block them from calling localhost; this worker has host permission for it.

const DEFAULT_SERVER = "http://127.0.0.1:8765";

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

async function openCompanion() {
  const url = chrome.runtime.getURL("companion/companion.html");
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    await chrome.windows.update(existing[0].windowId, { focused: true });
    return;
  }
  await chrome.windows.create({ url, type: "popup", width: 420, height: 760 });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "api") {
    api(msg.method, msg.path, msg.body).then(reply);
    return true; // async reply
  }
  if (msg.type === "open-companion") {
    openCompanion().then(() => reply({ ok: true }));
    return true;
  }
  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-panel") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle-panel" });
  } catch {
    // Not a supported site; open the desktop window instead.
    openCompanion();
  }
});
