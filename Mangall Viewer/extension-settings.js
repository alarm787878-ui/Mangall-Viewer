const siteNameInput = document.getElementById("site_name");
const sitePatternInput = document.getElementById("site_pattern");
const addSiteBtn = document.getElementById("add_site_btn");
const refreshBtn = document.getElementById("refresh_btn");
const clearSitesBtn = document.getElementById("clear_sites_btn");
const customSitesList = document.getElementById("custom_sites_list");
const statusMessage = document.getElementById("status_message");
const openShortcutsBtn = document.getElementById("open_shortcuts_btn");
const openShortcutsButtons = document.querySelectorAll("[data-open-shortcuts]");
const useWasdToggle = document.getElementById("use_wasd_toggle");
const shortcutStatus = document.getElementById("shortcut_status");
const fullscreenShortcutBtn = document.getElementById("fullscreen_shortcut_btn");
const spreadShortcutBtn = document.getElementById("spread_shortcut_btn");
const resetPairingShortcutBtn = document.getElementById("reset_pairing_shortcut_btn");
const nextArrowShortcut = document.getElementById("next_arrow_shortcut");
const prevArrowShortcut = document.getElementById("prev_arrow_shortcut");
const wasdConflictNote = document.getElementById("wasd_conflict_note");
const tabButtons = document.querySelectorAll("[data-tab-target]");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const RELOAD_CUSTOM_SITES_MESSAGE = "DCMV_RELOAD_CUSTOM_SITES";
const SHORTCUT_DEFAULTS = {
  useWasd: true,
  fullscreenShortcut: "f",
  spreadShortcut: "",
  resetPairingShortcut: "r"
};
const SHORTCUT_DISPLAY_DEFAULTS = {
  readingDirectionRTL: true,
  ...SHORTCUT_DEFAULTS
};
const BASIC_VIEWER_SHORTCUTS = [
  "escape",
  "space",
  "shift+space",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "enter"
];
const WASD_VIEWER_SHORTCUTS = ["w", "a", "s", "d"];

const universalSiteSettings = globalThis.__dcmvModules?.universalSiteSettings;
let shortcutSettings = { ...SHORTCUT_DISPLAY_DEFAULTS };
let recordingShortcutField = "";

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

function setShortcutStatus(message, type = "") {
  if (!shortcutStatus) return;

  shortcutStatus.textContent = message || "";
  shortcutStatus.classList.toggle("is_error", type === "error");
  shortcutStatus.classList.toggle("is_success", type === "success");
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

function getStorageArea() {
  return chrome.storage?.local || null;
}

function loadShortcutSettings() {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      resolve({ ...SHORTCUT_DISPLAY_DEFAULTS });
      return;
    }

    storageArea.get(Object.keys(SHORTCUT_DISPLAY_DEFAULTS), (result) => {
      resolve({
        useWasd:
          result?.useWasd === undefined ? SHORTCUT_DEFAULTS.useWasd : !!result.useWasd,
        readingDirectionRTL:
          result?.readingDirectionRTL === undefined
            ? SHORTCUT_DISPLAY_DEFAULTS.readingDirectionRTL
            : !!result.readingDirectionRTL,
        fullscreenShortcut:
          typeof result?.fullscreenShortcut === "string"
            ? result.fullscreenShortcut
            : SHORTCUT_DEFAULTS.fullscreenShortcut,
        spreadShortcut:
          typeof result?.spreadShortcut === "string"
            ? result.spreadShortcut
            : SHORTCUT_DEFAULTS.spreadShortcut,
        resetPairingShortcut:
          typeof result?.resetPairingShortcut === "string"
            ? result.resetPairingShortcut
            : SHORTCUT_DEFAULTS.resetPairingShortcut
      });
    });
  });
}

function saveShortcutSettings(nextSettings) {
  return new Promise((resolve) => {
    const storageArea = getStorageArea();
    if (!storageArea) {
      resolve();
      return;
    }

    const shortcutPatch = {};
    for (const [field, value] of Object.entries(nextSettings)) {
      if (field in SHORTCUT_DEFAULTS) {
        shortcutPatch[field] = value;
      }
    }

    if (!Object.keys(shortcutPatch).length) {
      resolve();
      return;
    }

    storageArea.set(shortcutPatch, () => resolve());
  });
}

async function notifyViewerShortcutSettings() {
  if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) return;

  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) => {
        if (!tab.id) return Promise.resolve();
        return chrome.tabs
          .sendMessage(tab.id, {
            type: "DCMV_UPDATE_SETTINGS",
          useWasd: shortcutSettings.useWasd,
          fullscreenShortcut: shortcutSettings.fullscreenShortcut,
          spreadShortcut: shortcutSettings.spreadShortcut,
          resetPairingShortcut: shortcutSettings.resetPairingShortcut
          })
          .catch(() => {});
      })
    );
  } catch (_) {
    void chrome.runtime?.lastError;
  }
}

function formatShortcutKey(shortcut) {
  if (!shortcut) return "사용 안 함";
  return shortcut.split("+").map(formatShortcutPart).join(" + ");
}

function formatShortcutPart(part) {
  if (part === "ctrl") return "Ctrl";
  if (part === "alt") return "Alt";
  if (part === "shift") return "Shift";
  if (part === "meta") return "Meta";
  if (part === "space") return "Space";
  if (part === "arrowleft") return "←";
  if (part === "arrowright") return "→";
  if (part === "arrowup") return "↑";
  if (part === "arrowdown") return "↓";
  if (part.length === 1) return part.toUpperCase();
  return part
    .split("")
    .map((char, index) => (index === 0 ? char.toUpperCase() : char))
    .join("");
}

function normalizeShortcutEvent(event) {
  const key = String(event.key || "");
  if (!key) return "";
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return "";

  const parts = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (event.metaKey) parts.push("meta");

  if (key.length === 1) parts.push(key.toLowerCase());
  else if (key === " " || key === "Spacebar") parts.push("space");
  else parts.push(key.toLowerCase());

  return parts.join("+");
}

function isBasicViewerShortcut(shortcut) {
  if (BASIC_VIEWER_SHORTCUTS.includes(shortcut)) return true;

  // 방향키는 Shift와 같이 눌러도 현재 뷰어 이동 단축키로 동작한다.
  if (shortcut.startsWith("shift+")) {
    return BASIC_VIEWER_SHORTCUTS.includes(shortcut.replace(/^shift\+/, ""));
  }

  return false;
}

function isWasdViewerShortcut(shortcut) {
  if (WASD_VIEWER_SHORTCUTS.includes(shortcut)) return true;

  // Shift+W/A/S/D도 현재 뷰어에서는 WASD 이동처럼 처리된다.
  if (shortcut.startsWith("shift+")) {
    return WASD_VIEWER_SHORTCUTS.includes(shortcut.replace(/^shift\+/, ""));
  }

  return false;
}

function renderShortcutSettings() {
  if (useWasdToggle) {
    useWasdToggle.setAttribute("aria-pressed", shortcutSettings.useWasd ? "true" : "false");
  }

  const fullscreenLabel = formatShortcutKey(shortcutSettings.fullscreenShortcut);
  const spreadLabel = formatShortcutKey(shortcutSettings.spreadShortcut);
  const resetPairingLabel = formatShortcutKey(shortcutSettings.resetPairingShortcut);

  if (fullscreenShortcutBtn) fullscreenShortcutBtn.textContent = fullscreenLabel;
  if (spreadShortcutBtn) spreadShortcutBtn.textContent = spreadLabel;
  if (resetPairingShortcutBtn) resetPairingShortcutBtn.textContent = resetPairingLabel;

  if (wasdConflictNote) {
    wasdConflictNote.hidden = !(
      shortcutSettings.useWasd &&
      (
        isWasdViewerShortcut(shortcutSettings.fullscreenShortcut) ||
        isWasdViewerShortcut(shortcutSettings.spreadShortcut) ||
        isWasdViewerShortcut(shortcutSettings.resetPairingShortcut)
      )
    );
  }

  if (nextArrowShortcut) {
    nextArrowShortcut.textContent = shortcutSettings.readingDirectionRTL ? "←" : "→";
  }
  if (prevArrowShortcut) {
    prevArrowShortcut.textContent = shortcutSettings.readingDirectionRTL ? "→" : "←";
  }
}

async function updateShortcutSettings(patch) {
  shortcutSettings = { ...shortcutSettings, ...patch };
  await saveShortcutSettings(patch);
  renderShortcutSettings();
  await notifyViewerShortcutSettings();
  setShortcutStatus("단축키 설정을 저장했습니다.", "success");
}

function startShortcutRecording(field) {
  recordingShortcutField = field;
  document.querySelectorAll("[data-shortcut-target]").forEach((button) => {
    button.classList.toggle("is_recording", button.dataset.shortcutTarget === field);
    if (button.dataset.shortcutTarget === field) {
      button.textContent = "입력 중";
    }
  });
  setShortcutStatus("변경할 키를 누르세요. Esc를 누르면 취소됩니다.");
}

function stopShortcutRecording() {
  recordingShortcutField = "";
  document.querySelectorAll("[data-shortcut-target]").forEach((button) => {
    button.classList.remove("is_recording");
  });
  renderShortcutSettings();
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

useWasdToggle?.addEventListener("click", async () => {
  await updateShortcutSettings({ useWasd: !shortcutSettings.useWasd });
});

document.querySelectorAll("[data-shortcut-target]").forEach((button) => {
  button.addEventListener("click", () => {
    startShortcutRecording(button.dataset.shortcutTarget || "");
  });
});

document.querySelectorAll("[data-reset-shortcut]").forEach((button) => {
  button.addEventListener("click", async () => {
    const field = button.dataset.resetShortcut || "";
    if (!field || !(field in SHORTCUT_DEFAULTS)) return;
    await updateShortcutSettings({ [field]: SHORTCUT_DEFAULTS[field] });
  });
});

document.querySelectorAll("[data-clear-shortcut]").forEach((button) => {
  button.addEventListener("click", async () => {
    const field = button.dataset.clearShortcut || "";
    if (!field || !(field in SHORTCUT_DEFAULTS)) return;
    await updateShortcutSettings({ [field]: "" });
  });
});

document.addEventListener("keydown", async (event) => {
  if (!recordingShortcutField) return;

  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
    stopShortcutRecording();
    setShortcutStatus("단축키 변경을 취소했습니다.");
    return;
  }

  const shortcut = normalizeShortcutEvent(event);
  if (!shortcut) {
    setShortcutStatus("기능키만 단독으로는 사용할 수 없습니다.", "error");
    return;
  }

  const otherField =
    recordingShortcutField === "fullscreenShortcut"
      ? ["spreadShortcut", "resetPairingShortcut"]
      : recordingShortcutField === "spreadShortcut"
        ? ["fullscreenShortcut", "resetPairingShortcut"]
        : ["fullscreenShortcut", "spreadShortcut"];

  if (otherField.some((field) => shortcutSettings[field] === shortcut)) {
    setShortcutStatus("이미 다른 기능에서 사용 중인 키입니다.", "error");
    return;
  }

  if (isBasicViewerShortcut(shortcut)) {
    setShortcutStatus("기본 단축키와 겹쳐서 사용할 수 없습니다.", "error");
    return;
  }

  const field = recordingShortcutField;
  stopShortcutRecording();
  await updateShortcutSettings({ [field]: shortcut });
});

activateTab(getInitialTabName());

(async () => {
  shortcutSettings = await loadShortcutSettings();
  renderShortcutSettings();

  if (!universalSiteSettings) {
    setStatus("설정을 불러오지 못했습니다.", "error");
    return;
  }

  await renderCustomSites();
})();
