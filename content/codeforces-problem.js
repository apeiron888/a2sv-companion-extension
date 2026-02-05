(async function () {
  if (window.__A2SV_COMPANION_CF_PROBLEM__) {
    return;
  }
  window.__A2SV_COMPANION_CF_PROBLEM__ = true;

  const DEFAULT_API_BASE = "https://a2sv-companion-backend.onrender.com";
  const storage = await chrome.storage.local.get([
    "apiBase",
    "token",
    "refreshToken",
    "extensionKey",
    "installId"
  ]);
  const apiBase = storage.apiBase || DEFAULT_API_BASE;
  if (!storage.apiBase) {
    chrome.storage.local.set({ apiBase });
  }
  let token = storage.token;
  let refreshToken = storage.refreshToken;
  let extensionKey = storage.extensionKey;
  async function ensureExtensionKey() {
    if (extensionKey) return extensionKey;
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

    extensionKey = data.extension_key;
    await chrome.storage.local.set({
      extensionKey: data.extension_key,
      installId: data.install_id
    });
    return extensionKey;
  }

  const widget = document.createElement("div");
  widget.className = "a2sv-widget";
  widget.innerHTML = `
    <h3>A2SV Submit</h3>
    <label>Trials<input id="a2sv-trials" type="number" min="1" value="1" /></label>
    <label>Time (minutes)<input id="a2sv-time" type="number" min="0" value="0" /></label>
    <label>Language
      <select id="a2sv-language">
        <option value="cpp">C++</option>
        <option value="python">Python</option>
        <option value="javascript">JavaScript</option>
        <option value="java">Java</option>
      </select>
    </label>
    <label>Code
      <textarea id="a2sv-code" rows="6" placeholder="Paste your accepted solution here"></textarea>
    </label>
    <button id="a2sv-submit">Submit to A2SV</button>
    <div id="a2sv-status" class="a2sv-status"></div>
  `;

  document.body.appendChild(widget);

  function normalizeLanguage(label) {
    const value = (label || "").toLowerCase();
    if (value.includes("c++") || value.includes("gnu c++")) return "cpp";
    if (value.includes("python")) return "python";
    if (value.includes("javascript")) return "javascript";
    if (value.includes("java")) return "java";
    return "cpp";
  }

  function parseCodeforcesKeyFromUrl(rawUrl) {
    if (!rawUrl) return "";
    const url = rawUrl.replace("https://codeforces.com", "");
    const patterns = [
      /\/problemset\/problem\/(\d+)\/([^/]+)/,
      /\/contest\/(\d+)\/problem\/([^/]+)/,
      /\/gym\/(\d+)\/problem\/([^/]+)/,
      /\/problem\/(\d+)\/([^/]+)/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return `${match[1]}${match[2]}`;
      }
    }
    return "";
  }

  function extractQuestionKey() {
    return parseCodeforcesKeyFromUrl(window.location.pathname);
  }

  function extractTitle() {
    const title = document.querySelector(".problem-statement .title");
    return title?.textContent?.trim() || document.title;
  }

  function extractLanguage() {
    const select = document.querySelector("select[name='programTypeId']");
    const selected = select?.querySelector("option:checked");
    return normalizeLanguage(selected?.textContent || "");
  }

  function extractCode() {
    const textarea = document.querySelector("textarea[name='source']");
    return textarea?.value?.trim() || "";
  }

  function hasAcceptedOnPage() {
    const verdict = document.querySelector(".verdict-accepted");
    return Boolean(verdict);
  }

  const statusEl = widget.querySelector("#a2sv-status");
  const submitBtn = widget.querySelector("#a2sv-submit");

  async function tryRefreshToken() {
    if (!refreshToken) return null;
    const key = await ensureExtensionKey();
    const response = await fetch(`${apiBase}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-extension-key": key },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    const data = await response.json();
    if (!response.ok) {
      return null;
    }
    token = data.token;
    refreshToken = data.refresh_token;
    await chrome.storage.local.set({ token, refreshToken });
    return token;
  }

  submitBtn.addEventListener("click", async () => {
    statusEl.textContent = "";
    if (!token) {
      statusEl.textContent = "Please register/login in the extension.";
      return;
    }

    if (!hasAcceptedOnPage()) {
      statusEl.textContent = "Accepted submission not detected. Submit from the accepted submission page.";
      return;
    }

    const trials = Number(widget.querySelector("#a2sv-trials").value || 1);
    const time = Number(widget.querySelector("#a2sv-time").value || 0);
    let language = widget.querySelector("#a2sv-language").value;
    let code = widget.querySelector("#a2sv-code").value.trim();

    if (!code) {
      const extracted = extractCode();
      if (extracted) {
        code = extracted;
        widget.querySelector("#a2sv-code").value = code;
      }
    }

    if (!language) {
      language = extractLanguage();
      widget.querySelector("#a2sv-language").value = language;
    }

    if (!code) {
      statusEl.textContent = "Code is required.";
      return;
    }

    const payload = {
      question_url: window.location.href,
      question_key: extractQuestionKey(),
      title: extractTitle(),
      code,
      language,
      trial_count: trials,
      time_minutes: time
    };

    statusEl.textContent = "Submitting...";

    try {
      const key = await ensureExtensionKey();
      let response = await fetch(`${apiBase}/api/submissions/codeforces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-extension-key": key
        },
        body: JSON.stringify(payload)
      });

      if (response.status === 401) {
        const newToken = await tryRefreshToken();
        if (newToken) {
          response = await fetch(`${apiBase}/api/submissions/codeforces`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${newToken}`,
              "x-extension-key": key
            },
            body: JSON.stringify(payload)
          });
        }
      }

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        statusEl.textContent = data?.message || "Submission failed";
        return;
      }

      statusEl.textContent = `Submitted. Status: ${data.status}`;
    } catch (error) {
      statusEl.textContent = error?.message || "Submission failed";
    }
  });
})();
