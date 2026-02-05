const DEFAULT_API_BASE = "https://a2sv-companion-backend.onrender.com";

async function registerExtensionInstall() {
  const { apiBase, extensionKey } = await chrome.storage.local.get(["apiBase", "extensionKey"]);
  if (extensionKey) return;
  const base = apiBase || DEFAULT_API_BASE;
  if (!apiBase) {
    await chrome.storage.local.set({ apiBase: base });
  }
  const version = chrome.runtime?.getManifest?.().version;
  const response = await fetch(`${base}/api/extension/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extension_version: version })
  });
  const data = await response.json();
  if (response.ok && data?.extension_key) {
    await chrome.storage.local.set({
      extensionKey: data.extension_key,
      installId: data.install_id
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("A2SV Companion installed");
  registerExtensionInstall();
});

chrome.action.onClicked.addListener(() => {
  const url = chrome.runtime.getURL("register.html");
  chrome.tabs.create({ url });
});
