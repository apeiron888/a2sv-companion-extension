const params = new URLSearchParams(window.location.search);
const reason = params.get("reason");
const reasonEl = document.getElementById("reason");

if (reason) {
  reasonEl.textContent = `Reason: ${reason}`;
}
