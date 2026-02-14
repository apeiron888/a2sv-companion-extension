/* New embedded widget flow; legacy widget is bypassed below. */
(async function () {
  if (window.__A2SV_COMPANION_LC__) {
    return;
  }
  window.__A2SV_COMPANION_LC__ = true;

  const widget = createA2SVWidget({ platformName: "LeetCode", collapsed: true });
  
  // Start floating to ensure visibility
  widget.classList.remove("a2sv-inline");
  widget.style.position = "fixed";
  widget.style.bottom = "20px";
  widget.style.right = "20px";
  widget.style.zIndex = "2147483647"; // Max z-index
  document.body.appendChild(widget);

  const mount = await waitForMount();
  if (mount) {
    console.log("A2SV: Moving to mount", mount);
    widget.classList.add("a2sv-inline");
    widget.style.position = "";
    widget.style.bottom = "";
    widget.style.right = "";
    widget.style.zIndex = "";
    mount.prepend(widget);
  }
  
  startMountObserver(widget);
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
    // 1. Description content (left panel usually)
    const descContent = document.querySelector("[data-track-load='description_content']");
    if (descContent) return descContent;

    // 2. Right panel (solutions/submissions area) - good fallback
    const rightPane = document.querySelector(".flex.h-full.w-full.flex-col.overflow-hidden");
    if (rightPane) return rightPane;

    // 3. New layout dynamic container
    const qdContent = document.querySelector("#qd-content");
    if (qdContent) return qdContent;

    return null;
  }

  async function waitForMount(attempts = 12) {
    for (let i = 0; i < attempts; i += 1) {
      const mount = findLeetCodeMount();
      if (mount) return mount;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  }

  function startMountObserver(widgetEl) {
    const maxChecks = 20;
    let checks = 0;
    const intervalId = setInterval(() => {
      checks += 1;
      const mount = findLeetCodeMount();
      if (mount && !mount.contains(widgetEl)) {
        widgetEl.classList.add("a2sv-inline");
        mount.appendChild(widgetEl);
      }
      if (checks >= maxChecks) {
        clearInterval(intervalId);
      }
    }, 1000);
  }
})();
