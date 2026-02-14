/* ═══════════════════════════════════════════════════════════════════
   A2SV Companion Extension — Shared Utilities
   ═══════════════════════════════════════════════════════════════════ */

const DEFAULT_API_BASE = "https://a2sv-companion-backend.onrender.com";

async function getApiBase() {
  const stored = await chrome.storage.local.get(["apiBase"]);
  if (!stored.apiBase) {
    await chrome.storage.local.set({ apiBase: DEFAULT_API_BASE });
  }
  return stored.apiBase || DEFAULT_API_BASE;
}

/**
 * Get stored authentication data from chrome.storage.local.
 */
function getStoredAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        "token",
        "refreshToken",
        "extensionKey",
        "installId",
        "a2svToken",
        "a2svRefreshToken",
        "a2svExtensionKey"
      ],
      (result) => {
        resolve({
          token: result.token || result.a2svToken || "",
          refreshToken: result.refreshToken || result.a2svRefreshToken || "",
          extensionKey: result.extensionKey || result.a2svExtensionKey || "",
          installId: result.installId || ""
        });
      }
    );
  });
}

async function ensureExtensionKey() {
  const auth = await getStoredAuth();
  if (auth.extensionKey) return auth.extensionKey;

  const apiBase = await getApiBase();
  const version = chrome.runtime?.getManifest?.().version;
  const response = await fetch(`${apiBase}/api/extension/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extension_version: version })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Extension registration failed");
  }

  await chrome.storage.local.set({
    extensionKey: data.extension_key,
    installId: data.install_id
  });

  return data.extension_key;
}

/**
 * Make an authenticated API call. If the token is expired, attempt a refresh.
 */
async function a2svApiCall(path, options = {}, retried = false) {
  const auth = await getStoredAuth();
  if (!auth.token) {
    throw new Error("NOT_AUTHENTICATED");
  }

  const apiBase = await getApiBase();
  const extensionKey = auth.extensionKey || (await ensureExtensionKey());
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.token}`,
    ...(extensionKey ? { "x-extension-key": extensionKey } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers
  });

  if (response.status === 401 && !retried) {
    const refreshed = await refreshToken();
    if (refreshed) {
      return a2svApiCall(path, options, true);
    }
    throw new Error("NOT_AUTHENTICATED");
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || `Request failed: ${response.status}`);
  }
  return data;
}

/**
 * Attempt to refresh the JWT token using the refresh token.
 */
async function refreshToken() {
  const auth = await getStoredAuth();
  if (!auth.refreshToken) return false;

  try {
    const apiBase = await getApiBase();
    const extensionKey = auth.extensionKey || (await ensureExtensionKey());
    const response = await fetch(`${apiBase}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(extensionKey ? { "x-extension-key": extensionKey } : {})
      },
      body: JSON.stringify({ refresh_token: auth.refreshToken })
    });

    if (!response.ok) return false;

    const data = await response.json();
    await new Promise((resolve) => {
      chrome.storage.local.set(
        {
          token: data.token,
          ...(data.refresh_token ? { refreshToken: data.refresh_token } : {})
        },
        resolve
      );
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Submit a solution to the A2SV backend.
 */
async function submitSolution(platform, payload) {
  return a2svApiCall(`/api/submissions/${platform}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Poll submission status until completed or failed.
 */
async function pollSubmissionStatus(submissionId, onUpdate, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const data = await a2svApiCall(`/api/submissions/${submissionId}/status`, {
        method: "GET"
      });

      if (onUpdate) onUpdate(data);

      if (data.status === "completed" || data.status === "failed") {
        return data;
      }
    } catch {
      // continue polling
    }
  }
  return { status: "timeout" };
}

/**
 * Detect if the current page uses a dark theme.
 */
function detectDarkMode() {
  const bg = window.getComputedStyle(document.body).backgroundColor;
  const match = bg.match(/\d+/g);
  if (!match) return true;
  const [r, g, b] = match.map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

/**
 * Create the A2SV widget panel element.
 */
function createA2SVWidget(options = {}) {
  const { platformName = "Platform", collapsed = true, inline = false } = options;
  const isDark = detectDarkMode();

  const widget = document.createElement("div");
  widget.id = "a2sv-widget";
  widget.className = `a2sv-widget ${isDark ? "a2sv-dark" : "a2sv-light"} ${inline ? "a2sv-inline" : ""}`;

  widget.innerHTML = `
    <div class="a2sv-toggle" id="a2sv-toggle" title="A2SV Tracker">
      <span class="a2sv-toggle-icon">🎓</span>
      <span class="a2sv-toggle-text">A2SV</span>
    </div>
    <div class="a2sv-panel ${collapsed ? "a2sv-collapsed" : ""}" id="a2sv-panel">
      <div class="a2sv-panel-header">
        <span class="a2sv-panel-title">A2SV Tracker • ${platformName}</span>
        <span class="a2sv-close" id="a2sv-close">✕</span>
      </div>
      <div class="a2sv-panel-body">
        <div class="a2sv-auth-info" id="a2sv-auth-info"></div>
        <div class="a2sv-fields">
          <div class="a2sv-field">
            <label>Trials</label>
            <input type="number" id="a2sv-trials" value="1" min="1" max="99" />
          </div>
          <div class="a2sv-field">
            <label>Time (min)</label>
            <input type="number" id="a2sv-time" value="15" min="0" max="999" />
          </div>
        </div>
        <button class="a2sv-submit-btn" id="a2sv-submit">Submit to A2SV</button>
        <div class="a2sv-progress" id="a2sv-progress"></div>
      </div>
    </div>
  `;

  // Toggle panel
  widget.querySelector("#a2sv-toggle").addEventListener("click", () => {
    const panel = widget.querySelector("#a2sv-panel");
    panel.classList.toggle("a2sv-collapsed");
  });

  widget.querySelector("#a2sv-close").addEventListener("click", () => {
    const panel = widget.querySelector("#a2sv-panel");
    panel.classList.add("a2sv-collapsed");
  });

  return widget;
}

/**
 * Update the progress display in the widget.
 */
function updateWidgetProgress(steps) {
  const progressEl = document.getElementById("a2sv-progress");
  if (!progressEl) return;

  progressEl.innerHTML = steps
    .map((step) => {
      const icon =
        step.status === "done" ? "✓" : step.status === "loading" ? "⟳" : step.status === "error" ? "✕" : "○";
      const cls =
        step.status === "done"
          ? "a2sv-step-done"
          : step.status === "loading"
          ? "a2sv-step-loading"
          : step.status === "error"
          ? "a2sv-step-error"
          : "a2sv-step-pending";
      return `<div class="a2sv-step ${cls}"><span>${icon}</span> ${step.label}</div>`;
    })
    .join("");
}

/**
 * Show auth status in the widget.
 */
async function updateAuthInfo() {
  const authInfo = document.getElementById("a2sv-auth-info");
  if (!authInfo) return;

  const auth = await getStoredAuth();
  if (auth.token) {
    authInfo.innerHTML = '<span class="a2sv-auth-connected">● Connected</span>';
  } else {
    authInfo.innerHTML = '<span class="a2sv-auth-disconnected">○ Not logged in — <a href="#" id="a2sv-login-link">Login</a></span>';
    const loginLink = document.getElementById("a2sv-login-link");
    if (loginLink) {
      loginLink.addEventListener("click", (e) => {
        e.preventDefault();
        const url = chrome.runtime.getURL("register.html");
        window.open(url, "_blank", "noopener,noreferrer");
      });
    }
  }
}
