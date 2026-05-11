const openButton = document.getElementById("open_btn");
const siteNameInput = document.getElementById("site_name");
const sitePatternInput = document.getElementById("site_pattern");
const addSiteBtn = document.getElementById("add_site_btn");
const customSitesList = document.getElementById("custom_sites_list");
const POPUP_BUTTON_LABEL = "만갤 뷰어";
const RELOAD_CUSTOM_SITES_MESSAGE = "DCMV_RELOAD_CUSTOM_SITES";

const universalSiteSettings = globalThis.__dcmvModules?.universalSiteSettings;

function getCurrentAdapter(url) {
  return globalThis.__dcmvSiteRegistry?.getSiteAdapterForUrl?.(url) || null;
}

async function loadAndDisplayCustomSites() {
  if (!universalSiteSettings || !customSitesList) return;

  const sites = await universalSiteSettings.loadCustomSites();

  if (sites.length === 0) {
    customSitesList.innerHTML = '<div class="empty_message">등록된 커스텀 사이트가 없습니다</div>';
    return;
  }

  customSitesList.innerHTML = sites.map(site => `
    <div class="custom_site_item" data-id="${site.id}">
      <div>
        <div class="site_name">${escapeHtml(site.name)}</div>
        <div class="site_pattern">${escapeHtml(site.urlPattern)}</div>
      </div>
      <button class="popup_btn danger delete-btn" data-id="${site.id}" type="button">삭제</button>
    </div>
  `).join('');

  // 삭제 버튼은 목록을 다시 그릴 때마다 새로 연결한다.
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      await universalSiteSettings.removeCustomSite(id);
      await notifyCustomSiteChange();
      await loadAndDisplayCustomSites();
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

  if (normalizedPattern.startsWith("http://") || normalizedPattern.startsWith("https://")) {
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
  if (!chrome.runtime?.sendMessage) return;

  try {
    await chrome.runtime.sendMessage({ type: RELOAD_CUSTOM_SITES_MESSAGE });
  } catch (_) {
    void chrome.runtime.lastError;
  }
}

function getSiteScriptFiles(adapter) {
  if (!adapter?.id) return [];
  if (String(adapter.id).startsWith("custom_")) return [];

  const files = [`sites/${adapter.id}.js`];
  if (adapter.id === "dcinside") {
    files.push("sites/dcinside-comments.js");
  }

  return files;
}

async function ensureViewerInjected(tabId, adapter) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["style.css"]
  });

  const siteScriptFiles = getSiteScriptFiles(adapter);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "site-registry.js",
      "sites/universal-site-settings.js",
      ...siteScriptFiles,
      "viewer-common.js",
      "viewer-ui.js",
      "viewer-layout.js",
      "viewer-hud.js",
      "viewer-settings.js",
      "viewer-navigation.js",
      "viewer-page-loading.js",
      "content.js"
    ]
  });
}

async function syncPopupLabel() {
  openButton.textContent = POPUP_BUTTON_LABEL;
}

openButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  await universalSiteSettings?.loadAndRegisterCustomAdapters?.();

  const adapter = getCurrentAdapter(tab?.url);
  if (!tab?.id || !adapter) {
    window.close();
    return;
  }

  try {
    openButton.textContent = POPUP_BUTTON_LABEL;
    await ensureViewerInjected(tab.id, adapter);
    await chrome.tabs.sendMessage(tab.id, { type: "DCMV_OPEN" });
  } catch (_) {
    void chrome.runtime.lastError;
  } finally {
    window.close();
  }
});

syncPopupLabel().catch(() => {
  openButton.textContent = POPUP_BUTTON_LABEL;
});

// 커스텀 사이트 추가 버튼 이벤트
addSiteBtn?.addEventListener("click", async () => {
  const name = siteNameInput?.value?.trim() || "커스텀 사이트";
  const pattern = sitePatternInput?.value?.trim();

  if (!pattern) {
    alert("URL 패턴을 입력해주세요.");
    return;
  }

  if (!isValidUrlPattern(pattern)) {
    alert("올바른 URL 패턴 형식이 아닙니다.\n예: *://*.example.com/* 또는 https://site.com/*");
    return;
  }

  if (!universalSiteSettings) {
    alert("설정을 로드할 수 없습니다.");
    return;
  }

  const permissionGranted = await requestSitePermissions(pattern);
  if (!permissionGranted) {
    alert("사이트 접근 권한이 허용되지 않았습니다.");
    return;
  }

  const result = await universalSiteSettings.addCustomSite({
    name,
    urlPattern: pattern
  });

  if (result.success) {
    siteNameInput.value = "";
    sitePatternInput.value = "";
    await notifyCustomSiteChange();
    await loadAndDisplayCustomSites();
  } else {
    alert("사이트 추가에 실패했습니다: " + (result.error || ""));
  }
});

// 팝업을 열었을 때 저장된 커스텀 사이트를 보여준다.
(async () => {
  try {
    await universalSiteSettings?.loadAndRegisterCustomAdapters?.();
  } catch (_) {
    void chrome.runtime?.lastError;
  }

  await loadAndDisplayCustomSites();
})().catch(() => {});

