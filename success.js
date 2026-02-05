const params = new URLSearchParams(window.location.search);
const token = params.get("token");
const refreshToken = params.get("refresh");

if (token) {
  chrome.storage.local.set({ token });
}

if (refreshToken) {
  chrome.storage.local.set({ refreshToken });
}

document.getElementById("closeBtn").addEventListener("click", () => {
  window.close();
});
