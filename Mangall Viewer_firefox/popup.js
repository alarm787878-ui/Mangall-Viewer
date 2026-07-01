const openButton = document.getElementById("open_btn");
const siteNameInput = document.getElementById("site_name");
const sitePatternInput = document.getElementById("site_pattern");
const addSiteBtn = document.getElementById("add_site_btn");
const customSitesList = document.getElementById("custom_sites_list");
const POPUP_BUTTON_LABEL = "만갤 뷰어";
const RELOAD_CUSTOM_SITES_MESSAGE = "DCMV_RELOAD_CUSTOM_SITES";
const browserApi = globalThis.__dcmvBrowserApi;
const extensionApi =
  browserApi?.raw ||
  (typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null);

const universalSiteSettings = globalThis.__dcmvModules?.universalSiteSettings;

function getCurrentAdapter(url) {
  return globalThis.__dcmvSiteRegistry?.getSiteAdapterForUrl?.(url) || null;
}

async function loadAndDisplayCustomSites() {
  if (!universalSiteSettings || !customSitesList) return;

  const sites = await universalSiteSettings.loadCustomSites();
  customSitesList.replaceChildren();

  if (sites.length === 0) {
    const emptyMessage = document.createElement("div");
    emptyMessage.className = "empty_message";
    emptyMessage.textContent = "등록된 커스텀 사이트가 없습니다";
    customSitesList.appendChild(emptyMessage);
    return;
  }

  for (const site of sites) {
    const item = document.createElement("div");
    item.className = "custom_site_item";
    item.dataset.id = site.id;

    const meta = document.createElement("div");

    const name = document.createElement("div");
    name.className = "site_name";
    name.textContent = site.name || "";

    const pattern = document.createElement("div");
    pattern.className = "site_pattern";
    pattern.textContent = site.urlPattern || "";

    const deleteButton = document.createElement("button");
    deleteButton.className = "popup_btn danger delete-btn";
    deleteButton.dataset.id = site.id;
    deleteButton.type = "button";
    deleteButton.textContent = "삭제";
    deleteButton.addEventListener("click", async () => {
      const id = deleteButton.dataset.id;
      await universalSiteSettings.removeCustomSite(id);
      await notifyCustomSiteChange();
      await loadAndDisplayCustomSites();
    });

    meta.append(name, pattern);
    item.append(meta, deleteButton);
    customSitesList.appendChild(item);
  }
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
  if (!origins.length || !extensionApi?.permissions?.request) {
    return true;
  }

  return await extensionApi.permissions.request({ origins });
}

async function notifyCustomSiteChange() {
  if (!browserApi?.sendRuntimeMessage) return;

  try {
    await browserApi.sendRuntimeMessage({ type: RELOAD_CUSTOM_SITES_MESSAGE });
  } catch (_) {
  }
}

function getSiteScriptFiles(adapter) {
  if (!adapter?.id) return [];
  if (String(adapter.id).startsWith("custom_")) return [];

  return [`sites/${adapter.id}.js`];
}

async function ensureViewerInjected(tabId, adapter) {
  await browserApi.insertCss(tabId, ["style.css"]);

  const siteScriptFiles = getSiteScriptFiles(adapter);
  await browserApi.executeScript(tabId, [
      "browser-api.js",
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
    ]);
}

async function syncPopupLabel() {
  openButton.textContent = POPUP_BUTTON_LABEL;
}

openButton.addEventListener("click", async () => {
  const tab = await browserApi.queryActiveTab();

  await universalSiteSettings?.loadAndRegisterCustomAdapters?.();

  const adapter = getCurrentAdapter(tab?.url);
  if (!tab?.id || !adapter) {
    window.close();
    return;
  }

  try {
    openButton.textContent = POPUP_BUTTON_LABEL;
    await ensureViewerInjected(tab.id, adapter);
    await browserApi.sendMessage(tab.id, { type: "DCMV_OPEN" });
  } catch (_) {
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
  }

  await loadAndDisplayCustomSites();
})().catch(() => {});

