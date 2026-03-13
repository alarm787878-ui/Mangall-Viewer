document.getElementById("open_btn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "DCMV_OPEN" }, () => {
    void chrome.runtime.lastError;
    window.close();
  });
});
