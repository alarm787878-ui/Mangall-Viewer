const siteNameInput = document.getElementById("site_name");
const sitePatternInput = document.getElementById("site_pattern");
const addSiteBtn = document.getElementById("add_site_btn");
const refreshBtn = document.getElementById("refresh_btn");
const clearSitesBtn = document.getElementById("clear_sites_btn");
const customSitesList = document.getElementById("custom_sites_list");
const statusMessage = document.getElementById("status_message");
const openShortcutsBtn = document.getElementById("open_shortcuts_btn");
const openShortcutsButtons = document.querySelectorAll("[data-open-shortcuts]");
const tabButtons = document.querySelectorAll("[data-tab-target]");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const RELOAD_CUSTOM_SITES_MESSAGE = "DCMV_RELOAD_CUSTOM_SITES";

const universalSiteSettings = globalThis.__dcmvModules?.universalSiteSettings;

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function setStatus(message, type = "") {
  if (!statusMessage) return;

  statusMessage.textContent = message || "";
  statusMessage.classList.toggle("is_error", type === "error");
  statusMessage.classList.toggle("is_success", type === "success");
}

function activateTab(tabName) {
  tabButtons.forEach((button) => {
    button.classList.toggle("is_active", button.dataset.tabTarget === tabName);
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle("is_active", panel.dataset.tabPanel === tabName);
  });
}

function getInitialTabName() {
  const tabName = window.location.hash.replace(/^#/, "");
  const hasMatchingPanel = Array.from(tabPanels).some(
    (panel) => panel.dataset.tabPanel === tabName
  );

  return hasMatchingPanel ? tabName : "site-access";
}

function isValidUrlPattern(pattern) {
  return !!universalSiteSettings?.normalizeUrlPatternInput?.(pattern || "");
}

function getPermissionOriginsForPattern(pattern) {
  const normalizedPattern =
    universalSiteSettings?.normalizeUrlPatternInput?.(pattern || "") || "";
  if (!normalizedPattern || normalizedPattern.startsWith("file://")) return [];

  if (normalizedPattern.startsWith("*://")) {
    return [
      normalizedPattern.replace(/^\*:\/\//, "http://"),
      normalizedPattern.replace(/^\*:\/\//, "https://")
    ];
  }

  if (
    normalizedPattern.startsWith("http://") ||
    normalizedPattern.startsWith("https://")
  ) {
    return [normalizedPattern];
  }

  return [];
}

async function requestSitePermissions(pattern) {
  const origins = getPermissionOriginsForPattern(pattern);
  if (!origins.length || !chrome.permissions?.request) {
    return true;
  }

  return await chrome.permissions.request({ origins });
}

async function notifyCustomSiteChange() {
  if (!chrome.runtime?.sendMessage) return true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: RELOAD_CUSTOM_SITES_MESSAGE
    });
    return response?.success !== false;
  } catch (_) {
    void chrome.runtime.lastError;
    return false;
  }
}

async function renderCustomSites() {
  if (!universalSiteSettings || !customSitesList) return;

  const sites = await universalSiteSettings.loadCustomSites();
  if (!sites.length) {
    customSitesList.innerHTML =
      '<div class="empty_message">등록된 커스텀 사이트가 없습니다.</div>';
    return;
  }

  customSitesList.innerHTML = sites
    .map(
      (site) => `
        <article class="custom_site_item" data-id="${site.id}">
          <div class="site_meta">
            <div class="site_name">${escapeHtml(site.name)}</div>
            <div class="site_pattern">${escapeHtml(site.urlPattern)}</div>
          </div>
          <button class="danger_btn delete-btn" data-id="${site.id}" type="button">삭제</button>
        </article>
      `
    )
    .join("");

  document.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const id = event.currentTarget.dataset.id;
      if (!id) return;

      await universalSiteSettings.removeCustomSite(id);
      await notifyCustomSiteChange();
      await renderCustomSites();
      setStatus("사이트를 삭제했습니다.", "success");
    });
  });
}

addSiteBtn?.addEventListener("click", async () => {
  const name = siteNameInput?.value?.trim() || "커스텀 사이트";
  const rawPattern = sitePatternInput?.value?.trim() || "";
  const normalizedPattern =
    universalSiteSettings?.normalizeUrlPatternInput?.(rawPattern) || "";

  if (!rawPattern) {
    setStatus("주소나 URL 패턴을 입력해주세요.", "error");
    return;
  }

  if (!isValidUrlPattern(rawPattern)) {
    setStatus("입력을 사이트 패턴으로 해석하지 못했습니다. 예: https://example.com/123 또는 *.example.com", "error");
    return;
  }

  if (!universalSiteSettings) {
    setStatus("설정을 불러오지 못했습니다.", "error");
    return;
  }

  const permissionGranted = await requestSitePermissions(normalizedPattern);
  if (!permissionGranted) {
    setStatus("사이트 접근 권한이 허용되지 않았습니다.", "error");
    return;
  }

  const result = await universalSiteSettings.addCustomSite({
    name,
    urlPattern: normalizedPattern
  });

  if (!result.success) {
    setStatus(`사이트 추가에 실패했습니다. ${result.error || ""}`.trim(), "error");
    return;
  }

  siteNameInput.value = "";
  sitePatternInput.value = "";
  await notifyCustomSiteChange();
  await renderCustomSites();
  setStatus(`사이트를 추가했습니다. ${normalizedPattern}`, "success");
});

refreshBtn?.addEventListener("click", async () => {
  const success = await notifyCustomSiteChange();
  await renderCustomSites();
  setStatus(
    success
      ? "설정을 다시 적용했습니다."
      : "설정 재적용 요청은 보냈지만 일부 반영이 실패했을 수 있습니다.",
    success ? "success" : "error"
  );
});

clearSitesBtn?.addEventListener("click", async () => {
  if (!universalSiteSettings) {
    setStatus("설정을 불러오지 못했습니다.", "error");
    return;
  }

  const sites = await universalSiteSettings.loadCustomSites();
  if (!sites.length) {
    setStatus("삭제할 커스텀 사이트가 없습니다.", "error");
    return;
  }

  const confirmed = window.confirm("등록된 커스텀 사이트를 모두 삭제할까요?");
  if (!confirmed) return;

  const saved = await universalSiteSettings.saveCustomSites([]);
  if (!saved) {
    setStatus("전체 삭제에 실패했습니다.", "error");
    return;
  }

  await notifyCustomSiteChange();
  await renderCustomSites();
  setStatus("등록된 커스텀 사이트를 모두 삭제했습니다.", "success");
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tabName = button.dataset.tabTarget || "site-access";
    activateTab(tabName);
    window.history.replaceState(null, "", `#${tabName}`);
  });
});

function openShortcutSettings() {
  const shortcutUrl = "chrome://extensions/shortcuts";
  if (chrome.tabs?.create) {
    chrome.tabs.create({ url: shortcutUrl });
    return;
  }

  window.open(shortcutUrl, "_blank", "noopener");
}

openShortcutsBtn?.addEventListener("click", openShortcutSettings);
openShortcutsButtons.forEach((button) => {
  button.addEventListener("click", openShortcutSettings);
});

activateTab(getInitialTabName());

(async () => {
  if (!universalSiteSettings) {
    setStatus("설정을 불러오지 못했습니다.", "error");
    return;
  }

  await renderCustomSites();
})();

