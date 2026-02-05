const openRegister = document.getElementById("openRegister");

openRegister.addEventListener("click", () => {
  const url = chrome.runtime.getURL("register.html");
  chrome.tabs.create({ url });
});
