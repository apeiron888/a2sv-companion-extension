/* ═══════════════════════════════════════════════════════════════════
   A2SV Companion Extension — HackerRank Content Script
   ═══════════════════════════════════════════════════════════════════ */

(async function () {
  "use strict";

  // Wait for the page to stabilize
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Only run on problem pages
  const url = window.location.href;
  const problemMatch = url.match(/hackerrank\.com\/challenges\/([^/]+)/);
  if (!problemMatch) return;

  const questionKey = problemMatch[1];

  // Inject widget
  const widget = createA2SVWidget({ platformName: "HackerRank", collapsed: true, inline: true });
  const mount = await waitForMount();
  (mount || document.body).appendChild(widget);
  await updateAuthInfo();

  // Submit handler
  const submitBtn = document.getElementById("a2sv-submit");
  submitBtn.addEventListener("click", handleSubmit);

  async function handleSubmit() {
    submitBtn.disabled = true;

    const steps = [
      { label: "Extracting code", status: "loading" },
      { label: "Pushing to GitHub", status: "pending" },
      { label: "Updating sheet", status: "pending" }
    ];
    updateWidgetProgress(steps);

    try {
      const auth = await getStoredAuth();
      if (!auth.token) {
        updateWidgetProgress([{ label: "Not logged in", status: "error" }]);
        submitBtn.disabled = false;
        return;
      }

      if (!isAccepted()) {
        updateWidgetProgress([{ label: "Submission not accepted yet", status: "error" }]);
        submitBtn.disabled = false;
        return;
      }

      // Extract code from the editor
      const code = extractCode();
      if (!code) {
        steps[0] = { label: "Extracting code", status: "error" };
        updateWidgetProgress(steps);
        submitBtn.disabled = false;
        return;
      }

      const language = detectLanguage();
      const trials = parseInt(document.getElementById("a2sv-trials").value, 10) || 1;
      const timeMinutes = parseInt(document.getElementById("a2sv-time").value, 10) || 0;

      steps[0] = { label: "Extracting code", status: "done" };
      steps[1] = { label: "Pushing to GitHub", status: "loading" };
      updateWidgetProgress(steps);

      // Submit to backend
      const title = document.querySelector(".challenge-name-title, .hr-challenge-name, h2")?.textContent?.trim() || questionKey;

      const result = await submitSolution("hackerrank", {
        question_url: url,
        question_key: questionKey,
        title: title,
        code: code,
        language: language,
        trial_count: trials,
        time_minutes: timeMinutes
      });

      steps[1] = { label: "Pushing to GitHub", status: "done" };
      steps[2] = { label: "Updating sheet", status: "loading" };
      updateWidgetProgress(steps);

      // Poll for completion
      const finalStatus = await pollSubmissionStatus(result.submissionId, (data) => {
        if (data.githubCommitUrl) {
          steps[1] = { label: "Pushed to GitHub ✓", status: "done" };
          updateWidgetProgress(steps);
        }
        if (data.sheetUpdated) {
          steps[2] = { label: "Sheet updated ✓", status: "done" };
          updateWidgetProgress(steps);
        }
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
      const failedStep = steps.findIndex((s) => s.status === "loading");
      if (failedStep >= 0) {
        steps[failedStep] = { ...steps[failedStep], status: "error" };
      }
      updateWidgetProgress(steps);
      console.error("A2SV submission error:", error);
    } finally {
      submitBtn.disabled = false;
    }
  }

  function extractCode() {
    // Try Monaco editor
    const monacoEditor = document.querySelector(".monaco-editor");
    if (monacoEditor) {
      const lines = monacoEditor.querySelectorAll(".view-line");
      if (lines.length) {
        return Array.from(lines)
          .map((line) => line.textContent)
          .join("\n");
      }
    }

    // Try CodeMirror
    const cmEditor = document.querySelector(".CodeMirror");
    if (cmEditor && cmEditor.CodeMirror) {
      return cmEditor.CodeMirror.getValue();
    }

    // Try ACE editor
    const aceEditor = document.querySelector(".ace_editor");
    if (aceEditor && window.ace) {
      const editor = window.ace.edit(aceEditor);
      return editor.getValue();
    }

    // Try textarea fallback
    const textarea = document.querySelector(".custom-input textarea, .hackdown-editor textarea");
    if (textarea) {
      return textarea.value;
    }

    return null;
  }

  function isAccepted() {
    const text = document.body.innerText || "";
    if (text.includes("Congratulations")) return true;
    if (text.includes("All test cases passed")) return true;
    const successBanner = document.querySelector(".congrats-wrapper, .challenge-success");
    return Boolean(successBanner);
  }

  function findHackerRankMount() {
    const sidebar = document.querySelector(".challenge-view .challenge-sidebar");
    if (sidebar) return sidebar;
    const editor = document.querySelector(".monaco-editor, .CodeMirror, .ace_editor");
    if (editor?.parentElement) return editor.parentElement;
    const content = document.querySelector(".challenge-body-html, .problem-statement");
    return content?.parentElement || null;
  }

  async function waitForMount(attempts = 12) {
    for (let i = 0; i < attempts; i += 1) {
      const mount = findHackerRankMount();
      if (mount) return mount;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  }

  function detectLanguage() {
    // Try selector buttons/dropdowns
    const langSelector = document.querySelector(
      "#select-lang .select-text, .editor-language .dropdown-text, select[name='language'] option:checked"
    );
    if (langSelector) {
      const lang = langSelector.textContent.trim().toLowerCase();
      return normalizeLanguage(lang);
    }

    // Try from URL params
    const params = new URLSearchParams(window.location.search);
    const langParam = params.get("language");
    if (langParam) return normalizeLanguage(langParam);

    return "python3";
  }

  function normalizeLanguage(lang) {
    const lowerLang = lang.toLowerCase();
    const map = {
      python3: "python3",
      python: "python3",
      pypy3: "python3",
      pypy: "python3",
      java: "java",
      "java 8": "java",
      "java 15": "java",
      javascript: "javascript",
      "c++": "cpp",
      "c++14": "cpp",
      "c++17": "cpp",
      c: "c",
      ruby: "ruby",
      kotlin: "kotlin",
      scala: "scala",
      swift: "swift",
      typescript: "typescript",
      go: "go",
      rust: "rust"
    };

    for (const [key, value] of Object.entries(map)) {
      if (lowerLang.includes(key)) return value;
    }
    return lowerLang;
  }
})();
