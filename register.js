const DEFAULT_API_BASE = "https://a2sv-companion-backend.onrender.com";

const fullNameInput = document.getElementById("fullName");
const emailInput = document.getElementById("email");
const groupInput = document.getElementById("group");
const repoInput = document.getElementById("repo");
const registerBtn = document.getElementById("registerBtn");
const registerStatus = document.getElementById("registerStatus");
const connectGithubBtn = document.getElementById("connectGithubBtn");
const githubStatus = document.getElementById("githubStatus");
const tokenStatus = document.getElementById("tokenStatus");
const logoutBtn = document.getElementById("logoutBtn");
const loginEmailInput = document.getElementById("loginEmail");
const loginBtn = document.getElementById("loginBtn");
const loginStatus = document.getElementById("loginStatus");
const apiBaseInput = document.getElementById("apiBase");
const saveApiBaseBtn = document.getElementById("saveApiBase");
const apiBaseStatus = document.getElementById("apiBaseStatus");

async function ensureApiBase() {
  const { apiBase } = await chrome.storage.local.get(["apiBase"]);
  if (!apiBase) {
    await chrome.storage.local.set({ apiBase: DEFAULT_API_BASE });
  }
  return apiBase || DEFAULT_API_BASE;
}

async function loadApiBase() {
  const current = await ensureApiBase();
  apiBaseInput.value = current;
}

async function saveApiBase() {
  apiBaseStatus.textContent = "";
  const value = apiBaseInput.value.trim();
  if (!value) {
    apiBaseStatus.textContent = "API base is required";
    return;
  }
  await chrome.storage.local.set({ apiBase: value });
  apiBaseStatus.textContent = "API base saved";
}

async function loadSession() {
  const { token, refreshToken } = await chrome.storage.local.get(["token", "refreshToken"]);
  tokenStatus.textContent = token && refreshToken ? "Authenticated" : "Not authenticated";
}

async function loadTempToken() {
  const { tempToken } = await chrome.storage.local.get(["tempToken"]);
  if (tempToken) {
    connectGithubBtn.disabled = false;
    githubStatus.textContent = "Ready to connect GitHub.";
  } else {
    connectGithubBtn.disabled = true;
    githubStatus.textContent = "Register first to get a GitHub connect token.";
  }
}

async function registerUser() {
  registerStatus.textContent = "";
  const apiBase = await ensureApiBase();

  const payload = {
    full_name: fullNameInput.value.trim(),
    email: emailInput.value.trim(),
    group_name: groupInput.value.trim(),
    github_repo: repoInput.value.trim()
  };

  if (!payload.full_name || !payload.email || !payload.group_name || !payload.github_repo) {
    registerStatus.textContent = "All fields are required";
    return;
  }

  registerStatus.textContent = "Registering...";

  const response = await fetch(`${apiBase}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    registerStatus.textContent = data?.message || "Registration failed";
    return;
  }

  await chrome.storage.local.set({ tempToken: data.temp_token });
  registerStatus.textContent = "Registered. Now click Connect GitHub.";
  await loadTempToken();
}

async function connectGithub() {
  githubStatus.textContent = "";
  const apiBase = await ensureApiBase();
  const { tempToken } = await chrome.storage.local.get(["tempToken"]);
  if (!tempToken) {
    githubStatus.textContent = "Register first to get a GitHub connect token.";
    return;
  }
  githubStatus.textContent = "Opening GitHub OAuth...";
  const oauthUrl = `${apiBase}/api/auth/github/oauth?state=${encodeURIComponent(tempToken)}`;
  chrome.tabs.create({ url: oauthUrl });
}

async function logout() {
  await chrome.storage.local.remove(["token", "refreshToken", "tempToken"]);
  tokenStatus.textContent = "Not authenticated";
  await loadTempToken();
}

async function loginUser() {
  loginStatus.textContent = "";
  const apiBase = await ensureApiBase();
  const email = loginEmailInput.value.trim();
  if (!email) {
    loginStatus.textContent = "Email is required";
    return;
  }

  loginStatus.textContent = "Starting login...";
  const response = await fetch(`${apiBase}/api/auth/login/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });

  const data = await response.json();
  if (!response.ok) {
    loginStatus.textContent = data?.message || "Login failed";
    return;
  }

  const tempToken = data.temp_token;
  if (!tempToken) {
    loginStatus.textContent = "Login failed";
    return;
  }

  loginStatus.textContent = "Opening GitHub OAuth...";
  const oauthUrl = `${apiBase}/api/auth/github/oauth?state=${encodeURIComponent(tempToken)}`;
  chrome.tabs.create({ url: oauthUrl });
}

registerBtn.addEventListener("click", registerUser);
connectGithubBtn.addEventListener("click", connectGithub);
logoutBtn.addEventListener("click", logout);
loginBtn.addEventListener("click", loginUser);
saveApiBaseBtn.addEventListener("click", saveApiBase);

ensureApiBase().then(async () => {
  await loadSession();
  await loadTempToken();
  await loadApiBase();
});
