/* New embedded widget flow; legacy widget is bypassed below. */
(async function () {
  if (window.__A2SV_COMPANION_LC__) {
    return;
  }
  window.__A2SV_COMPANION_LC__ = true;

  const widget = createA2SVWidget({ platformName: "LeetCode", collapsed: true, inline: true });
  const mount = await waitForMount();
  (mount || document.body).appendChild(widget);
  await updateAuthInfo();

  const submitBtn = widget.querySelector("#a2sv-submit");
  submitBtn.addEventListener("click", handleSubmit);

  function getQuestionKey() {
    const parts = window.location.pathname.split("/problems/");
    if (parts.length < 2) return "";
    return parts[1].split("/")[0];
  }

  function getTitle() {
    const titleEl = document.querySelector("div[data-cy='question-title']");
    return titleEl?.textContent?.trim() || document.title.replace(" - LeetCode", "");
  }

  function isAccepted() {
    const resultEl = document.querySelector(
      "[data-cy='submission-result'], [data-e2e-locator='submission-result']"
    );
    if (resultEl?.textContent?.includes("Accepted")) {
      return true;
    }
    const acceptedText = document.body.innerText || "";
    if (!acceptedText.includes("Accepted")) return false;
    const blocked = [
      "Wrong Answer",
      "Time Limit Exceeded",
      "Runtime Error",
      "Memory Limit Exceeded",
      "Compilation Error"
    ];
    return !blocked.some((label) => acceptedText.includes(label));
  }

  function normalizeLanguage(label) {
    const value = (label || "").toLowerCase();
    if (value.includes("python")) return "python";
    if (value.includes("c++") || value.includes("cpp")) return "cpp";
    if (value.includes("javascript")) return "javascript";
    if (value.includes("typescript")) return "typescript";
    if (value.includes("java")) return "java";
    return "python";
  }

  function requestEditorSnapshot() {
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.data?.source !== "a2sv-companion" || event.data?.type !== "leetcode-editor") {
          return;
        }
        window.removeEventListener("message", handler);
        clearTimeout(timeoutId);
        resolve(event.data.payload || {});
      };

      const timeoutId = setTimeout(() => {
        window.removeEventListener("message", handler);
        resolve({});
      }, 1000);

      window.addEventListener("message", handler);

      const script = document.createElement("script");
      script.textContent = `(() => {
        try {
          const getMonacoModel = () => {
            const monaco = window.monaco;
            if (!monaco?.editor?.getModels) return null;
            const models = monaco.editor.getModels();
            return models && models[0] ? models[0] : null;
          };

          const model = getMonacoModel();
          const code = model?.getValue ? model.getValue() : null;
          const languageId = model?.getLanguageId ? model.getLanguageId() : null;

          const langSelect = document.querySelector('[data-cy="lang-select"]');
          const langText = langSelect?.textContent?.trim();

          window.postMessage({
            source: "a2sv-companion",
            type: "leetcode-editor",
            payload: {
              code,
              language: langText || languageId || ""
            }
          }, "*");
        } catch (error) {
          window.postMessage({
            source: "a2sv-companion",
            type: "leetcode-editor",
            payload: {}
          }, "*");
        }
      })();`;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    });
  }

  async function handleSubmit() {
    submitBtn.disabled = true;
    const steps = [
      { label: "Submitting", status: "loading" },
      { label: "Pushing to GitHub", status: "pending" },
      { label: "Updating sheet", status: "pending" }
    ];
    updateWidgetProgress(steps);

    try {
      const auth = await getStoredAuth();
      if (!auth.token) {
        updateWidgetProgress([{ label: "Not logged in", status: "error" }]);
        return;
      }

      if (!isAccepted()) {
        updateWidgetProgress([{ label: "Submission not accepted yet", status: "error" }]);
        return;
      }

      const trials = Number(widget.querySelector("#a2sv-trials").value || 1);
      const time = Number(widget.querySelector("#a2sv-time").value || 0);
      let language = "";
      let code = "";

      const snapshot = await requestEditorSnapshot();
      if (snapshot?.code) {
        code = snapshot.code.trim();
      }
      if (snapshot?.language) {
        language = normalizeLanguage(snapshot.language);
      }

      if (!code) {
        updateWidgetProgress([{ label: "No code detected", status: "error" }]);
        return;
      }

      const payload = {
        question_url: window.location.href,
        question_key: getQuestionKey(),
        title: getTitle(),
        code,
        language: language || "python",
        trial_count: trials,
        time_minutes: time
      };

      const result = await submitSolution("leetcode", payload);
      steps[0] = { label: "Submitted", status: "done" };
      steps[1] = { label: "Pushing to GitHub", status: "loading" };
      updateWidgetProgress(steps);

      const submissionId = getSubmissionId(result);
      if (!submissionId) {
        updateWidgetProgress([{ label: "Submission queued", status: "done" }]);
        return;
      }

      const finalStatus = await pollSubmissionStatus(submissionId, (data) => {
        if (data.githubCommitUrl) {
          steps[1] = { label: "Pushed to GitHub ✓", status: "done" };
        }
        if (data.sheetUpdated) {
          steps[2] = { label: "Sheet updated ✓", status: "done" };
        }
        updateWidgetProgress(steps);
      });

      if (finalStatus.status === "completed") {
        steps[2] = { label: "Sheet updated ✓", status: "done" };
      } else if (finalStatus.status === "failed") {
        steps[2] = { label: "Update failed", status: "error" };
      } else {
        steps[2] = { label: "Timed out", status: "error" };
      }
      updateWidgetProgress(steps);
    } catch (error) {
      updateWidgetProgress([{ label: error?.message || "Submission failed", status: "error" }]);
    } finally {
      submitBtn.disabled = false;
    }
  }

  function getSubmissionId(result) {
    return result?.submissionId || result?.submission_id || result?.id || "";
  }

  function findLeetCodeMount() {
    const editor = document.querySelector(".monaco-editor");
    if (editor) {
      const container = editor.closest("div");
      if (container?.parentElement) return container.parentElement;
    }

    const sidebar = document.querySelector("[data-cy='question-detail']");
    if (sidebar?.parentElement) return sidebar.parentElement;

    const layout = document.querySelector("#app");
    return layout || null;
  }

  async function waitForMount(attempts = 12) {
    for (let i = 0; i < attempts; i += 1) {
      const mount = findLeetCodeMount();
      if (mount) return mount;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  }
})();

window.__A2SV_COMPANION__ = true;

(async function () {
  if (window.__A2SV_COMPANION__) {
    return;
  }
  window.__A2SV_COMPANION__ = true;

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
        <option value="python">Python</option>
        <option value="cpp">C++</option>
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

  function getQuestionKey() {
    const parts = window.location.pathname.split("/problems/");
    if (parts.length < 2) return "";
    return parts[1].split("/")[0];
  }

  function getTitle() {
    const titleEl = document.querySelector("div[data-cy='question-title']");
    return titleEl?.textContent?.trim() || document.title.replace(" - LeetCode", "");
  }

  function isAccepted() {
    const resultEl = document.querySelector(
      "[data-cy='submission-result'], [data-e2e-locator='submission-result']"
    );
    if (resultEl?.textContent?.includes("Accepted")) {
      return true;
    }
    const acceptedText = document.body.innerText || "";
    if (!acceptedText.includes("Accepted")) return false;
    const blocked = [
      "Wrong Answer",
      "Time Limit Exceeded",
      "Runtime Error",
      "Memory Limit Exceeded",
      "Compilation Error"
    ];
    return !blocked.some((label) => acceptedText.includes(label));
  }

  function normalizeLanguage(label) {
    const value = (label || "").toLowerCase();
    if (value.includes("python")) return "python";
    if (value.includes("c++") || value.includes("cpp")) return "cpp";
    if (value.includes("javascript")) return "javascript";
    if (value.includes("typescript")) return "typescript";
    if (value.includes("java")) return "java";
    return "python";
  }

  function requestEditorSnapshot() {
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.data?.source !== "a2sv-companion" || event.data?.type !== "leetcode-editor") {
          return;
        }
        window.removeEventListener("message", handler);
        clearTimeout(timeoutId);
        resolve(event.data.payload || {});
      };

      const timeoutId = setTimeout(() => {
        window.removeEventListener("message", handler);
        resolve({});
      }, 1000);

      window.addEventListener("message", handler);

      const script = document.createElement("script");
      script.textContent = `(() => {
        try {
          const getMonacoModel = () => {
            const monaco = window.monaco;
            if (!monaco?.editor?.getModels) return null;
            const models = monaco.editor.getModels();
            return models && models[0] ? models[0] : null;
          };

          const model = getMonacoModel();
          const code = model?.getValue ? model.getValue() : null;
          const languageId = model?.getLanguageId ? model.getLanguageId() : null;

          const langSelect = document.querySelector('[data-cy="lang-select"]');
          const langText = langSelect?.textContent?.trim();

          window.postMessage({
            source: "a2sv-companion",
            type: "leetcode-editor",
            payload: {
              code,
              language: langText || languageId || ""
            }
          }, "*");
        } catch (error) {
          window.postMessage({
            source: "a2sv-companion",
            type: "leetcode-editor",
            payload: {}
          }, "*");
        }
      })();`;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    });
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
    if (!isAccepted()) {
      statusEl.textContent = "Submission not accepted yet.";
      return;
    }

    const trials = Number(widget.querySelector("#a2sv-trials").value || 1);
    const time = Number(widget.querySelector("#a2sv-time").value || 0);
    let language = widget.querySelector("#a2sv-language").value;
    let code = widget.querySelector("#a2sv-code").value.trim();

    if (!code) {
      statusEl.textContent = "Fetching code from editor...";
      const snapshot = await requestEditorSnapshot();
      if (snapshot?.code) {
        code = snapshot.code.trim();
        widget.querySelector("#a2sv-code").value = code;
      }
      if (snapshot?.language) {
        language = normalizeLanguage(snapshot.language);
        widget.querySelector("#a2sv-language").value = language;
      }
    }

    if (!code) {
      statusEl.textContent = "Code is required.";
      return;
    }

    const payload = {
      question_url: window.location.href,
      question_key: getQuestionKey(),
      title: getTitle(),
      code,
      language,
      trial_count: trials,
      time_minutes: time
    };

    statusEl.textContent = "Submitting...";

    try {
      const key = await ensureExtensionKey();
      let response = await fetch(`${apiBase}/api/submissions/leetcode`, {
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
          response = await fetch(`${apiBase}/api/submissions/leetcode`, {
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
