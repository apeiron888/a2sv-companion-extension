chrome.runtime.onInstalled.addListener(() => {
  console.log("A2SV Companion installed");
});

chrome.action.onClicked.addListener(() => {
  const url = chrome.runtime.getURL("register.html");
  chrome.tabs.create({ url });
});
