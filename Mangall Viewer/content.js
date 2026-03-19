(() => {
  if (window.__dcmvContentScriptLoaded) {
    return;
  }

  // 중복 주입 시 메시지 리스너와 UI가 여러 번 붙는 것을 방지한다.
  window.__dcmvContentScriptLoaded = true;

  const OVERLAY_ID = "dcmv-overlay";
  const LOCK_CLASS = "dcmv-lock-scroll";
  const HUD_VISIBLE_CLASS = "dcmv-hud-visible";
  const TOGGLE_ACTIVE_CLASS = "dcmv-toggle-active";
  const CURSOR_HIDDEN_CLASS = "dcmv-cursor-hidden";

  const STORAGE_KEYS = {
    readingDirectionRTL: "readingDirectionRTL",
    spreadEnabled: "spreadEnabled",
    firstPageSingle: "firstPageSingle",
    useWasd: "useWasd",
    autoFirstPageAdjust: "autoFirstPageAdjust"
  };

  const HUD_HIDE_DELAY = 180;
  const HUD_INITIAL_SHOW_DELAY = 500;
  const NAV_THROTTLE_MS = 220;
  const HUD_TRIGGER_MARGIN_X = 28;
  const HUD_TRIGGER_MARGIN_Y = 20;
  const IMAGE_METADATA_TIMEOUT_MS = 3000;
  const IMAGE_METADATA_BATCH_SIZE = 100;
  const REPAIR_INITIAL_DELAY_MS = 1000;
  const REPAIR_INTERVAL_MS = 2000;
  const REPAIR_MAX_ROUNDS = 4;
  const LAZY_WAKE_SCROLL_STEP = 800;
  const LAZY_WAKE_SCROLL_DELAY_MS = 20;
  const VIEWER_IMAGE_RETRY_LIMIT = 2;
  const PAGE_SESSION_KEY = "dcmv-last-position";
  const FIRST_PAGE_AUTO_SESSION_KEY = "dcmv-first-page-auto";
  const REOPENED_VIEWER_PAGE_SESSION_KEY = "dcmv-reopened-viewer-page";
  const MANUAL_PAIRING_RESET_SESSION_KEY = "dcmv-manual-pairing-reset";
  const INITIAL_AUTO_EVAL_PAGE_LIMIT = 30;
  const INITIAL_AUTO_REQUIRED_KNOWN_PAGES = 10;
  const EARLY_STRIP_MIN_SAMPLE_PORTRAITS = 6;
  const EARLY_STRIP_CLUSTER_TOLERANCE = 0.08;
  const EARLY_STRIP_REQUIRED_CLUSTER_SHARE = 0.85;
  const EARLY_STRIP_RATIO_LOWER_THRESHOLD = 0.78;
  const EARLY_STRIP_RATIO_UPPER_THRESHOLD = 1.28;
  const EARLY_STRIP_MIN_DIMENSION = 400;
  const CLICK_DEAD_ZONE_RATIO = 0.12;
  const CLICK_DEAD_ZONE_MIN_PX = 120;
  const CLICK_DEAD_ZONE_MAX_PX = 220;
  const SINGLE_PORTRAIT_DEAD_ZONE_SCALE = 1 / 2;
  const CURSOR_HIDE_DELAY_MS = 2000;
  const CURSOR_MOVE_THRESHOLD_PX = 4;
  const EDGE_TOAST_DURATION_MS = 1000;
  const EDGE_TOAST_COOLDOWN_ATTEMPTS = 3;

  let state = null;
  let reopenedViewerPageKey = "";
  let hasAutoLazyWakeRunInThisTabPage = false;

  function isDcPlaceholderSize(item) {
    return !!item && item.width === 200 && item.height === 200;
  }

  function hasUsableImageMetadata(item) {
    if (!item) return false;
    if (!item.width || !item.height) return false;
    if (isDcPlaceholderSize(item)) return false;
    return true;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;

    if (message.type === "DCMV_UPDATE_SETTINGS") {
      if (state) {
        state.useWasd = !!message.useWasd;
        state.autoFirstPageAdjust =
          message.autoFirstPageAdjust === undefined
            ? state.autoFirstPageAdjust
            : !!message.autoFirstPageAdjust;
        syncToggleVisuals();
      }
      return;
    }

    if (message.type !== "DCMV_OPEN") return;

    openViewer(message).catch((err) => {
      console.error("[Mangall Viewer]", err);
      alert("만갤 뷰어 실행 중 오류가 발생했습니다.");
    });
  });

  async function openViewer(message = {}) {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      closeViewer();
      return;
    }

    const root = findContentRoot();
    const sourceItems = collectSourceItems(root);
    const shouldWaitForInitialMetadata = !!loadLastReadPosition();
    if (!sourceItems.length) {
      alert("본문 영역에서 이미지를 찾지 못했습니다.");
      return;
    }

    const settings = await loadSettings();
    const overlay = buildOverlay();
    document.body.appendChild(overlay);

    document.documentElement.classList.add(LOCK_CLASS);
    document.body.classList.add(LOCK_CLASS);

    state = {
      root,
      overlay,
      stage: overlay.querySelector(".dcmv-stage"),
      imageLoadingBar: overlay.querySelector(".dcmv-image-loading-bar"),
      imageLoadingBarFill: overlay.querySelector(".dcmv-image-loading-bar-fill"),
      hud: overlay.querySelector(".dcmv-hud"),
      hudTrigger: overlay.querySelector(".dcmv-hud-trigger"),
      pageCounter: overlay.querySelector(".dcmv-page-counter"),
      pageCounterLabel: overlay.querySelector(".dcmv-page-counter-label"),
      pagePicker: overlay.querySelector(".dcmv-page-picker"),
      pagePickerList: overlay.querySelector(".dcmv-page-picker-list"),
      settingsMenu: overlay.querySelector(".dcmv-settings-menu"),
      settingsButton: overlay.querySelector(".dcmv-settings-btn"),
      settingsUseWasdButton: overlay.querySelector(".dcmv-settings-use-wasd"),
      settingsUseWasdSwitch: overlay.querySelector(
        ".dcmv-settings-use-wasd-switch"
      ),
      settingsRtlButton: overlay.querySelector(".dcmv-settings-rtl"),
      settingsRtlValue: overlay.querySelector(".dcmv-settings-rtl-value"),
      settingsAutoFirstPageButton: overlay.querySelector(
        ".dcmv-settings-auto-first-page"
      ),
      settingsAutoFirstPageSwitch: overlay.querySelector(
        ".dcmv-settings-auto-first-page-switch"
      ),
      settingsManualResetClearButton: overlay.querySelector(
        ".dcmv-settings-manual-reset-clear"
      ),
      edgeToast: overlay.querySelector(".dcmv-edge-toast"),
      refreshButton: overlay.querySelector("[data-dcmv-action=\"refresh\"]"),
      prevButton: overlay.querySelector("[data-dcmv-action=\"prev\"]"),
      nextButton: overlay.querySelector("[data-dcmv-action=\"next\"]"),

      firstSingleCheckbox: overlay.querySelector(".dcmv-first-single-checkbox"),

      spreadToggle: overlay.querySelector(".dcmv-toggle-spread"),
      firstSingleToggle: overlay.querySelector(".dcmv-toggle-first-single"),

      sourceItems,
      totalCount: sourceItems.length,

      spreadEnabled:
        settings.spreadEnabled === undefined ? true : !!settings.spreadEnabled,
      firstPageSingle:
        settings.firstPageSingle === undefined ? true : !!settings.firstPageSingle,
      readingDirectionRTL:
        settings.readingDirectionRTL === undefined
          ? true
          : !!settings.readingDirectionRTL,
      useWasd: settings.useWasd === undefined ? true : !!settings.useWasd,
      autoFirstPageAdjust:
        settings.autoFirstPageAdjust === undefined
          ? false
          : !!settings.autoFirstPageAdjust,
      manualPairingResetIndices: [],
      shouldReuseSavedAutoFirstPageSingle: false,
      hasLoggedFirstViewerImageLoad: false,
      hasRunInitialAutoAfterFirstImageLoad: false,
      initialAutoMetadataPromise: null,
      hasPresentedInitialViewer: false,
      imageLoadingBarHideTimer: null,

      steps: [],
      stepIndex: 0,
      currentStep: null,

      navLockedUntil: 0,
      hudHideTimer: null,
      cursorHideTimer: null,
      edgeToastTimer: null,
      edgeToastCooldownRemaining: EDGE_TOAST_COOLDOWN_ATTEMPTS,
      didAutoAdjustFirstPageSingle: false,
      hasUserAdjustedFirstPageSingle: false,
      isPointerOverHudZone: false,
      isPagePickerOpen: false,
      isSettingsMenuOpen: false,
      pagePickerSelectedIndex: 0,
      isCursorHidden: false,
      lastPointerX: null,
      lastPointerY: null,
      repairTimers: [],
      isRepairRunning: false,
      handlers: {},
      requestedTargetUrl: normalizeComparableUrl(message.targetImageUrl || "")
    };

    state.firstSingleCheckbox.checked = state.firstPageSingle;

    syncToggleVisuals();
    bindEvents();


    const savedAutoFirstPageSingle = loadSavedAutoFirstPageSingleValue();
    if (savedAutoFirstPageSingle !== null) {
      state.firstPageSingle = savedAutoFirstPageSingle;
      state.shouldReuseSavedAutoFirstPageSingle = shouldWaitForInitialMetadata;
    }

    if (shouldWaitForInitialMetadata) {
      await hydrateImageMetadata(state.sourceItems);
    }

    const savedManualPairingResetIndices = loadSavedManualPairingResetIndices();
    if (savedManualPairingResetIndices) {
      state.manualPairingResetIndices = savedManualPairingResetIndices;
    }

    state.firstSingleCheckbox.checked = state.firstPageSingle;
    syncToggleVisuals();
    rebuildStepsKeepingAnchor(resolveInitialAnchorIndex());
    state.stage.style.visibility = state.shouldReuseSavedAutoFirstPageSingle
      ? ""
      : "hidden";
    if (state.shouldReuseSavedAutoFirstPageSingle) {
      state.hasRunInitialAutoAfterFirstImageLoad = true;
      state.hasPresentedInitialViewer = true;
      showHudTemporarily();
    }
    renderCurrentStep();
    syncHudTrigger();
    scheduleInitialPostLazyRefresh();
    rememberPointerPosition(window.innerWidth / 2, window.innerHeight / 2);
    scheduleCursorHide();
  }

  function closeViewer() {
    if (!state) return;

    const prevState = state;
    saveLastReadPosition(prevState);
    clearTimeout(prevState.hudHideTimer);
    clearTimeout(prevState.cursorHideTimer);
    clearTimeout(prevState.edgeToastTimer);
    clearRepairTimers(prevState);

    document.removeEventListener("keydown", prevState.handlers.keydown, true);
    document.removeEventListener("keyup", prevState.handlers.keyup, true);
    window.removeEventListener("keydown", prevState.handlers.winKeydown, true);
    document.removeEventListener("mousemove", prevState.handlers.mousemove, true);
    document.removeEventListener(
      "mouseleave",
      prevState.handlers.docMouseleave,
      true
    );
    window.removeEventListener("resize", prevState.handlers.resize, true);

    prevState.overlay.removeEventListener("wheel", prevState.handlers.wheel);
    prevState.overlay.removeEventListener("click", prevState.handlers.click, true);
    prevState.overlay.removeEventListener(
      "click",
      prevState.handlers.imageClick,
      true
    );
    prevState.hud.removeEventListener("mouseenter", prevState.handlers.hudMouseenter);
    prevState.hud.removeEventListener("mouseleave", prevState.handlers.hudMouseleave);

    if (prevState.overlay?.parentNode) {
      prevState.overlay.remove();
    }

    document.documentElement.classList.remove(LOCK_CLASS);
    document.body.classList.remove(LOCK_CLASS);

    state = null;

    requestAnimationFrame(() => {
      const root = prevState.root || document.body;

      const anchorIndex =
        prevState.currentStep?.images?.length
          ? prevState.currentStep.images[
              prevState.currentStep.images.length - 1
            ].index
          : 0;

      const item = prevState.sourceItems?.[anchorIndex];
      if (!item) return;

      let el = item.element;

      if (!el || !document.contains(el)) {
        el = findElementForSourceItem(root, item);
      }

      if (el && document.contains(el)) {
        el.scrollIntoView({
          behavior: "auto",
          block: "center",
          inline: "nearest"
        });
        return;
      }

      const estimatedTop = estimateScrollTopForImageIndex(
        root,
        prevState.sourceItems,
        anchorIndex
      );

      if (estimatedTop == null) return;

      window.scrollTo({
        top: Math.max(0, estimatedTop - Math.round(window.innerHeight * 0.35)),
        behavior: "auto"
      });
    });
  }

  function bindEvents() {
    const escHandler = (e) => {
      if (!state) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeViewer();
      }
    };

    const keydown = (e) => {
      if (!state) return;
      if (shouldIgnoreKeydown(e)) return;

      if (state.isPagePickerOpen) {
        if (handlePagePickerKeydown(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      const logicalNav = getLogicalNavigationForKey(e);
      if (!logicalNav) return;

      e.preventDefault();

      if (logicalNav === "next") {
        goNext();
        return;
      }

      goPrev();
    };

    const keyup = (e) => {
      if (!state) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const wheel = (e) => {
      if (!state) return;

      if (state.isPagePickerOpen) {
        if (state.pagePicker.contains(e.target)) {
          e.stopPropagation();
          return;
        }

        e.preventDefault();
        return;
      }

      const insideHudZone = isPointerInsideHudTrigger(e.clientX, e.clientY);
      updateHudHoverState(insideHudZone);

      if (insideHudZone) {
        clearTimeout(state.cursorHideTimer);
        showCursor();
      }

      e.preventDefault();

      if (Math.abs(e.deltaY) < 4) return;

      if (e.deltaY > 0) goNext();
      else goPrev();
    };

    const mousemove = (e) => {
      if (!state) return;

      const movedSignificantly = hasPointerMovedSignificantly(
        e.clientX,
        e.clientY
      );

      if (movedSignificantly) {
        showCursor();
      }

      rememberPointerPosition(e.clientX, e.clientY);
      scheduleCursorHide();

      const inside = isPointerInsideHudTrigger(e.clientX, e.clientY);
      updateHudHoverState(inside);
    };

    const docMouseleave = () => {
      if (!state) return;
      updateHudHoverState(false);
    };

    const resize = () => {
      if (!state) return;
      syncHudTrigger();
      syncImageLoadingBarPosition();
    };

    const hudMouseenter = (e) => {
      if (!state) return;
      rememberPointerPosition(e.clientX, e.clientY);
      updateHudHoverState(isPointerInsideHudTrigger(e.clientX, e.clientY));
      clearTimeout(state.cursorHideTimer);
      showCursor();
    };

    const hudMouseleave = (e) => {
      if (!state) return;
      rememberPointerPosition(e.clientX, e.clientY);
      updateHudHoverState(isPointerInsideHudTrigger(e.clientX, e.clientY));
      scheduleCursorHide();
    };

    const click = (e) => {
      if (!state) return;
      if (!(e.target instanceof Element)) return;

      if (
        state.isPagePickerOpen &&
        !e.target.closest(".dcmv-page-picker-wrap")
      ) {
        togglePagePicker(false);
      }

      if (
        state.isSettingsMenuOpen &&
        !e.target.closest(".dcmv-settings-wrap")
      ) {
        toggleSettingsMenu(false);
      }

      const actionEl = e.target.closest("[data-dcmv-action]");
      if (!actionEl) return;

      const action = actionEl.getAttribute("data-dcmv-action");

      if (action === "prev" || action === "next") {
        const direction = getLogicalNavigationForOverlayButton(action);
        if (direction === "next") {
          goNext(true);
        } else {
          goPrev(true);
        }
      } else if (action === "refresh") {
        runManualRefresh().catch((err) => {
          console.error("[Mangall Viewer] manual refresh failed", err);
        });
      } else if (action === "toggle-spread") {
        const anchor = getCurrentAnchorIndex();
        state.spreadEnabled = !state.spreadEnabled;
        actionEl.blur();
        syncToggleVisuals();

        saveSettings({
          readingDirectionRTL: state.readingDirectionRTL,
          spreadEnabled: state.spreadEnabled,
          firstPageSingle: state.firstPageSingle,
          useWasd: state.useWasd,
          autoFirstPageAdjust: state.autoFirstPageAdjust
        }).then(() => {
          if (!state) return;
          rebuildStepsKeepingAnchor(anchor);
          renderCurrentStep();
          syncHudTrigger();
        });
      } else if (action === "toggle-rtl") {
        state.readingDirectionRTL = !state.readingDirectionRTL;
        actionEl.blur();
        syncToggleVisuals();

        saveSettings({
          readingDirectionRTL: state.readingDirectionRTL,
          spreadEnabled: state.spreadEnabled,
          firstPageSingle: state.firstPageSingle,
          useWasd: state.useWasd,
          autoFirstPageAdjust: state.autoFirstPageAdjust
        }).then(() => {
          if (!state) return;
          renderCurrentStep();
          syncHudTrigger();
        });
      } else if (action === "toggle-first-single") {
        const anchor = getCurrentAnchorIndex();
        state.firstPageSingle = !state.firstPageSingle;
        state.hasUserAdjustedFirstPageSingle = true;
        actionEl.blur();
        syncToggleVisuals();

        saveSettings({
          readingDirectionRTL: state.readingDirectionRTL,
          spreadEnabled: state.spreadEnabled,
          firstPageSingle: state.firstPageSingle,
          useWasd: state.useWasd,
          autoFirstPageAdjust: state.autoFirstPageAdjust
        }).then(() => {
          if (!state) return;
          rebuildStepsKeepingAnchor(anchor);
          renderCurrentStep();
          syncHudTrigger();
        });
      } else if (action === "toggle-page-picker") {
        togglePagePicker();
      } else if (action === "toggle-settings-menu") {
        toggleSettingsMenu();
      } else if (action === "toggle-use-wasd") {
        state.useWasd = !state.useWasd;
        actionEl.blur();
        syncToggleVisuals();

        saveSettings({
          readingDirectionRTL: state.readingDirectionRTL,
          spreadEnabled: state.spreadEnabled,
          firstPageSingle: state.firstPageSingle,
          useWasd: state.useWasd,
          autoFirstPageAdjust: state.autoFirstPageAdjust
        });
      } else if (action === "toggle-auto-first-page-adjust") {
        state.autoFirstPageAdjust = !state.autoFirstPageAdjust;
        actionEl.blur();
        syncToggleVisuals();

        saveSettings({
          readingDirectionRTL: state.readingDirectionRTL,
          spreadEnabled: state.spreadEnabled,
          firstPageSingle: state.firstPageSingle,
          useWasd: state.useWasd,
          autoFirstPageAdjust: state.autoFirstPageAdjust
        });
      } else if (action === "reset-pairing-from-current") {
        const anchor = getCurrentAnchorIndex();
        const resetIndex = Math.max(0, anchor);
        const resetIndices = Array.isArray(state.manualPairingResetIndices)
          ? [...state.manualPairingResetIndices]
          : [];
        const existingIndex = resetIndices.indexOf(resetIndex);
        const isSameResetPoint = existingIndex >= 0;

        if (isSameResetPoint) {
          resetIndices.splice(existingIndex, 1);
        } else {
          resetIndices.push(resetIndex);
          resetIndices.sort((a, b) => a - b);
        }

        state.manualPairingResetIndices = resetIndices;
        saveManualPairingResetIndices(resetIndices);
        syncManualResetClearVisibility();
        actionEl.blur();
        toggleSettingsMenu(false);
        rebuildStepsKeepingAnchor(anchor);
        renderCurrentStep();
        syncHudTrigger();
        showEdgeToast(
          isSameResetPoint
            ? "현재 페이지부터 단면 재설정을 해제했습니다."
            : "현재 페이지부터 단면 재설정을 적용했습니다.",
          2000
        );
      } else if (action === "reset-pairing-from-current-clear") {
        const anchor = getCurrentAnchorIndex();
        const hadManualPairingReset =
          Array.isArray(state.manualPairingResetIndices) &&
          state.manualPairingResetIndices.length > 0;
        state.manualPairingResetIndices = [];
        clearSavedManualPairingResetIndices();
        syncManualResetClearVisibility();
        actionEl.blur();
        toggleSettingsMenu(false);
        rebuildStepsKeepingAnchor(anchor);
        renderCurrentStep();
        syncHudTrigger();
        if (hadManualPairingReset) {
          showEdgeToast("단면 재설정을 모두 초기화했습니다.", 2000);
        }
      } else if (action === "close") {
        closeViewer();
      } else if (action === "go-to-page") {
        const pageIndex = Number(actionEl.getAttribute("data-dcmv-page-index"));
        if (!Number.isInteger(pageIndex)) return;
        goToPageIndex(pageIndex);
      }

      return;
    };

    const imageClick = (e) => {
      if (!state) return;
      if (!(e.target instanceof Element)) return;

      if (!e.target.closest(".dcmv-image")) return;

      const direction = getLogicalNavigationForViewportSide(e.clientX, {
        ignoreDeadZone: true
      });
      if (!direction) return;

      scheduleCursorHide();
      if (direction === "next") {
        goNext(true);
        return;
      }

      goPrev(true);
    };

    state.handlers = {
      keydown,
      keyup,
      winKeydown: escHandler,
      wheel,
      mousemove,
      docMouseleave,
      resize,
      hudMouseenter,
      hudMouseleave,
      click,
      imageClick
    };

    document.addEventListener("keydown", keydown, true);
    document.addEventListener("keyup", keyup, true);
    window.addEventListener("keydown", escHandler, true);
    document.addEventListener("mousemove", mousemove, true);
    document.addEventListener("mouseleave", docMouseleave, true);
    window.addEventListener("resize", resize, true);

    state.overlay.addEventListener("wheel", wheel, { passive: false });
    state.overlay.addEventListener("click", click, true);
    state.overlay.addEventListener("click", imageClick, true);
    state.hud.addEventListener("mouseenter", hudMouseenter);
    state.hud.addEventListener("mouseleave", hudMouseleave);

  }

  function buildOverlay() {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "dcmv-overlay";

    const svgNs = "http://www.w3.org/2000/svg";

    function el(tagName, className, textContent) {
      const node = document.createElement(tagName);
      if (className) node.className = className;
      if (textContent !== undefined) node.textContent = textContent;
      return node;
    }

    function button(className, action, textContent) {
      const node = el("button", className, textContent);
      node.type = "button";
      node.dataset.dcmvAction = action;
      return node;
    }

    function arrowIcon(pathData) {
      const wrapper = el("span", "dcmv-nav-btn-arrow");
      wrapper.setAttribute("aria-hidden", "true");

      const svg = document.createElementNS(svgNs, "svg");
      svg.setAttribute("viewBox", "0 0 12 12");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("aria-hidden", "true");

      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", pathData);
      svg.appendChild(path);
      wrapper.appendChild(svg);
      return wrapper;
    }

    function settingsGearIcon() {
      const wrapper = el("span", "dcmv-settings-gear");
      wrapper.setAttribute("aria-hidden", "true");

      const svg = document.createElementNS(svgNs, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("aria-hidden", "true");

      const path = document.createElementNS(svgNs, "path");
      path.setAttribute(
        "d",
        "M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.58.22-1.12.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.84a.5.5 0 0 0 .49-.42l.36-2.54c.58-.22 1.12-.53 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
      );
      svg.appendChild(path);
      wrapper.appendChild(svg);
      return wrapper;
    }

    function manualResetClearIcon() {
      const wrapper = el("span", "dcmv-settings-subaction-icon");
      wrapper.setAttribute("aria-hidden", "true");

      const svg = document.createElementNS(svgNs, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("aria-hidden", "true");

      const path = document.createElementNS(svgNs, "path");
      path.setAttribute(
        "d",
        "M12 4V1L7 6l5 5V7a5 5 0 1 1-4.89 6.06H5.05A7 7 0 1 0 12 4Z"
      );
      svg.appendChild(path);
      wrapper.appendChild(svg);
      return wrapper;
    }

    const stage = el("div", "dcmv-stage");
    const imageLoadingBar = el("div", "dcmv-image-loading-bar");
    const imageLoadingBarFill = el("div", "dcmv-image-loading-bar-fill");
    imageLoadingBar.appendChild(imageLoadingBarFill);
    const edgeToast = el("div", "dcmv-edge-toast");
    edgeToast.setAttribute("aria-live", "polite");
    const hudTrigger = el("div", "dcmv-hud-trigger");
    const hud = el("div", "dcmv-hud");

    const prevButton = button("dcmv-btn dcmv-nav-btn", "prev");
    prevButton.append(
      arrowIcon("M7.75 2.25 4 6l3.75 3.75"),
      el("span", "dcmv-nav-btn-label", "이전")
    );

    const spreadButton = button(
      "dcmv-toggle dcmv-toggle-spread",
      "toggle-spread"
    );
    spreadButton.appendChild(el("span", "dcmv-toggle-label", "양면으로 보기"));

    const firstSingleButton = button(
      "dcmv-toggle dcmv-toggle-first-single",
      "toggle-first-single"
    );
    firstSingleButton.appendChild(el("span", "", "첫 페이지가 단면"));
    const firstSingleCheckbox = el("input", "dcmv-first-single-checkbox");
    firstSingleCheckbox.type = "checkbox";
    firstSingleCheckbox.tabIndex = -1;
    firstSingleCheckbox.setAttribute("aria-hidden", "true");
    firstSingleButton.appendChild(firstSingleCheckbox);

    const pagePickerWrap = el("div", "dcmv-page-picker-wrap");
    const pageCounter = button(
      "dcmv-page-counter dcmv-btn",
      "toggle-page-picker"
    );
    pageCounter.append(
      el("span", "dcmv-page-counter-label", "0 / 0"),
      el("span", "dcmv-page-counter-caret")
    );
    pageCounter.lastChild.setAttribute("aria-hidden", "true");
    const pagePicker = el("div", "dcmv-page-picker");
    pagePicker.appendChild(el("div", "dcmv-page-picker-list"));
    pagePickerWrap.append(pageCounter, pagePicker);

    const refreshButton = button("dcmv-btn", "refresh", "새로고침");

    const settingsWrap = el("div", "dcmv-settings-wrap");
    const settingsButton = button(
      "dcmv-btn dcmv-settings-btn",
      "toggle-settings-menu"
    );
    settingsButton.setAttribute("aria-label", "설정");
    settingsButton.appendChild(settingsGearIcon());

    const settingsMenu = el("div", "dcmv-settings-menu");
    const rtlButton = button(
      "dcmv-settings-item dcmv-settings-rtl",
      "toggle-rtl"
    );
    rtlButton.append(
      el("span", "dcmv-settings-item-label", "페이지 읽는 순서"),
      el("span", "dcmv-settings-item-value dcmv-settings-rtl-value", "우→좌")
    );

    const wasdButton = button(
      "dcmv-settings-item dcmv-settings-use-wasd",
      "toggle-use-wasd"
    );
    const wasdSwitch = el(
      "span",
      "dcmv-settings-switch dcmv-settings-use-wasd-switch"
    );
    wasdSwitch.setAttribute("aria-hidden", "true");
    wasdButton.append(
      el("span", "dcmv-settings-item-label", "wasd로 이동"),
      wasdSwitch
    );

    const autoFirstPageButton = button(
      "dcmv-settings-item dcmv-settings-auto-first-page",
      "toggle-auto-first-page-adjust"
    );
    const autoFirstPageSwitch = el(
      "span",
      "dcmv-settings-switch dcmv-settings-auto-first-page-switch"
    );
    autoFirstPageSwitch.setAttribute("aria-hidden", "true");
    autoFirstPageButton.append(
      el("span", "dcmv-settings-item-label", "첫 페이지가 단면 자동 조정"),
      autoFirstPageSwitch
    );
    const manualResetDivider = el(
      "div",
      "dcmv-settings-divider dcmv-settings-divider-manual"
    );
    const manualPairingResetButton = el(
      "div",
      "dcmv-settings-item dcmv-settings-item-split dcmv-settings-manual-reset-wrap"
    );
    const manualPairingResetMainButton = button(
      "dcmv-settings-item-main dcmv-settings-manual-reset",
      "reset-pairing-from-current"
    );
    manualPairingResetMainButton.appendChild(
      el("span", "dcmv-settings-item-label", "현재 페이지부터 단면 재설정")
    );
    const manualPairingResetClearButton = button(
      "dcmv-settings-item-subaction dcmv-settings-manual-reset-clear",
      "reset-pairing-from-current-clear"
    );
    manualPairingResetClearButton.setAttribute("aria-label", "현재 페이지부터 단면 재설정 초기화");
    manualPairingResetClearButton.title = "초기화";
    manualPairingResetClearButton.hidden = true;
    manualPairingResetClearButton.appendChild(manualResetClearIcon());
    manualPairingResetButton.append(
      manualPairingResetMainButton,
      manualPairingResetClearButton
    );
    settingsMenu.append(
      rtlButton,
      wasdButton,
      autoFirstPageButton,
      manualResetDivider,
      manualPairingResetButton
    );
    settingsWrap.append(settingsButton, settingsMenu);

    const closeButton = button("dcmv-btn", "close", "닫기");

    const nextButton = button("dcmv-btn dcmv-nav-btn", "next");
    nextButton.append(
      el("span", "dcmv-nav-btn-label", "다음"),
      arrowIcon("M4.25 2.25 8 6l-3.75 3.75")
    );

    hud.append(
      prevButton,
      spreadButton,
      firstSingleButton,
      pagePickerWrap,
      refreshButton,
      settingsWrap,
      closeButton,
      nextButton
    );
    overlay.append(
      stage,
      imageLoadingBar,
      edgeToast,
      hudTrigger,
      hud
    );

    return overlay;
  }

  function setRefreshButtonState(isRunning) {
    if (!state || !state.refreshButton) return;

    state.refreshButton.disabled = !!isRunning;
    state.refreshButton.textContent = isRunning ? "갱신 중..." : "새로고침";
  }

  function syncToggleVisuals() {
    if (!state) return;

    state.spreadToggle.classList.toggle(TOGGLE_ACTIVE_CLASS, state.spreadEnabled);
    state.spreadToggle.querySelector(".dcmv-toggle-label").textContent = state.spreadEnabled
      ? "양면으로 보기"
      : "단면으로 보기";
    state.firstSingleCheckbox.checked = state.firstPageSingle;
    state.firstSingleToggle.classList.toggle(TOGGLE_ACTIVE_CLASS, state.firstPageSingle);
    state.settingsRtlValue.textContent = state.readingDirectionRTL
      ? "우→좌"
      : "좌→우";
    state.settingsRtlButton.classList.toggle(
      TOGGLE_ACTIVE_CLASS,
      state.readingDirectionRTL
    );
    state.settingsUseWasdButton.querySelector(
      ".dcmv-settings-item-label"
    ).textContent = "wasd로 이동";
    state.settingsUseWasdButton.classList.toggle(
      TOGGLE_ACTIVE_CLASS,
      state.useWasd
    );
    state.settingsUseWasdButton.setAttribute(
      "aria-pressed",
      state.useWasd ? "true" : "false"
    );
    state.settingsAutoFirstPageButton.querySelector(
      ".dcmv-settings-item-label"
    ).textContent = "첫 페이지가 단면 자동 조정";
    state.settingsAutoFirstPageButton.classList.toggle(
      TOGGLE_ACTIVE_CLASS,
      state.autoFirstPageAdjust
    );
    state.settingsAutoFirstPageButton.setAttribute(
      "aria-pressed",
      state.autoFirstPageAdjust ? "true" : "false"
    );

    syncManualResetClearVisibility();

    syncNavButtonLabels();
  }

  function syncManualResetClearVisibility() {
    if (!state?.settingsManualResetClearButton) return;

    const hasAnyManualReset =
      Array.isArray(state.manualPairingResetIndices) &&
      state.manualPairingResetIndices.length > 0;

    state.settingsManualResetClearButton.hidden = !hasAnyManualReset;
  }

  function syncNavButtonLabels() {
    if (!state) return;

    state.prevButton.querySelector(".dcmv-nav-btn-label").textContent =
      state.readingDirectionRTL ? "다음" : "이전";
    state.nextButton.querySelector(".dcmv-nav-btn-label").textContent =
      state.readingDirectionRTL ? "이전" : "다음";
  }

  function togglePagePicker(forceOpen) {
    if (!state) return;

    const nextOpen =
      typeof forceOpen === "boolean" ? forceOpen : !state.isPagePickerOpen;

    state.isPagePickerOpen = nextOpen;
    state.pagePicker.classList.toggle("dcmv-page-picker-open", nextOpen);
    state.pageCounter.classList.toggle("dcmv-page-counter-open", nextOpen);

    if (nextOpen) {
      toggleSettingsMenu(false);
      state.pagePickerSelectedIndex = getCurrentDisplayPageIndex();
      renderPagePicker();
      scrollCurrentPagePickerItemIntoView();
      state.hud.classList.add(HUD_VISIBLE_CLASS);
      clearTimeout(state.hudHideTimer);
      state.pageCounter.focus();
    }
  }

  function toggleSettingsMenu(forceOpen) {
    if (!state) return;

    const nextOpen =
      typeof forceOpen === "boolean" ? forceOpen : !state.isSettingsMenuOpen;

    state.isSettingsMenuOpen = nextOpen;
    state.settingsMenu.classList.toggle("dcmv-settings-menu-open", nextOpen);
    state.settingsButton.classList.toggle("dcmv-page-counter-open", nextOpen);

    if (nextOpen) {
      syncManualResetClearVisibility();
      togglePagePicker(false);
      state.hud.classList.add(HUD_VISIBLE_CLASS);
      clearTimeout(state.hudHideTimer);
      state.settingsButton.focus();
      return;
    }

    if (!refreshHudPointerState()) {
      clearTimeout(state.hudHideTimer);
      state.hud.classList.remove(HUD_VISIBLE_CLASS);
    }
  }

  function renderPagePicker() {
    if (!state) return;

    const currentPageIndex = state.isPagePickerOpen
      ? state.pagePickerSelectedIndex
      : getCurrentDisplayPageIndex();
    const fragment = document.createDocumentFragment();

    for (const item of state.sourceItems) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dcmv-page-picker-item";
      button.dataset.dcmvAction = "go-to-page";
      button.dataset.dcmvPageIndex = String(item.index);
      button.textContent = String(item.displayIndex);

      if (item.index === currentPageIndex) {
        button.classList.add("dcmv-page-picker-item-active");
      }

      fragment.appendChild(button);
    }

    state.pagePickerList.replaceChildren(fragment);
  }

  function scrollCurrentPagePickerItemIntoView() {
    if (!state || !state.isPagePickerOpen) return;

    const activeItem = state.pagePickerList.querySelector(
      ".dcmv-page-picker-item-active"
    );

    if (!(activeItem instanceof Element)) return;

    activeItem.scrollIntoView({
      block: "center"
    });
  }

  function handlePagePickerKeydown(e) {
    if (!state) return false;

    const key = String(e.key || "").toLowerCase();
    const currentPageIndex = state.pagePickerSelectedIndex;

    if (key === "arrowdown" || key === "s") {
      if (key === "s" && !state.useWasd) return false;
      state.pagePickerSelectedIndex = Math.min(
        currentPageIndex + 1,
        state.sourceItems.length - 1
      );
      renderPagePicker();
      scrollCurrentPagePickerItemIntoView();
      return true;
    }

    if (key === "arrowup" || key === "w") {
      if (key === "w" && !state.useWasd) return false;
      state.pagePickerSelectedIndex = Math.max(currentPageIndex - 1, 0);
      renderPagePicker();
      scrollCurrentPagePickerItemIntoView();
      return true;
    }

    if (
      key === "arrowleft" ||
      key === "arrowright" ||
      (state.useWasd && key === "a") ||
      (state.useWasd && key === "d")
    ) {
      return true;
    }

    if (key === "enter" || key === " " || key === "spacebar") {
      goToPageIndex(state.pagePickerSelectedIndex);
      return true;
    }

    return false;
  }

  function getCurrentDisplayPageIndex() {
    if (!state?.currentStep?.images?.length) return 0;

    return getPrimaryAnchorItem(state)?.index ?? 0;
  }

  function syncHudTrigger() {
    if (!state) return;

    const hudStyle = window.getComputedStyle(state.hud);
    const bottom = Number.parseFloat(hudStyle.bottom) || 0;
    const width = state.hud.offsetWidth;
    const height = state.hud.offsetHeight;
    const left = Math.max(0, (window.innerWidth - width) / 2);
    const top = Math.max(0, window.innerHeight - bottom - height);
    const rect = {
      left,
      top,
      width,
      height,
    };
    const trigger = state.hudTrigger;

    const triggerLeft = Math.max(0, rect.left - HUD_TRIGGER_MARGIN_X);
    const triggerTop = Math.max(0, rect.top - HUD_TRIGGER_MARGIN_Y);
    const triggerWidth = Math.min(
      window.innerWidth - triggerLeft,
      rect.width + HUD_TRIGGER_MARGIN_X * 2
    );
    const triggerHeight = Math.min(
      window.innerHeight - triggerTop,
      rect.height + HUD_TRIGGER_MARGIN_Y * 2
    );

    trigger.style.left = `${triggerLeft}px`;
    trigger.style.top = `${triggerTop}px`;
    trigger.style.width = `${triggerWidth}px`;
    trigger.style.height = `${triggerHeight}px`;

    if (state.lastPointerX == null || state.lastPointerY == null) {
      return;
    }

    const inside = isPointerInsideHudTrigger(state.lastPointerX, state.lastPointerY);
    state.isPointerOverHudZone = inside;

    if (inside) {
      state.hud.classList.add(HUD_VISIBLE_CLASS);
      clearTimeout(state.hudHideTimer);
    }
  }

  function isPointerInsideHudTrigger(x, y) {
    if (!state) return false;

    const rect = state.hudTrigger.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function syncHudVisibility() {
    if (!state) return;

    const shouldShow =
      !!state.isPointerOverHudZone ||
      !!state.isPagePickerOpen ||
      !!state.isSettingsMenuOpen;

    state.hud.classList.toggle(HUD_VISIBLE_CLASS, shouldShow);
  }

  function updateHudHoverState(nextInside, options = {}) {
    if (!state) return;
    state.isPointerOverHudZone = !!nextInside;
    syncHudVisibility();
  }

  function refreshHudPointerState() {
    if (!state) return false;
    if (state.lastPointerX == null || state.lastPointerY == null) {
      syncHudVisibility();
      return !!state.isPointerOverHudZone;
    }

    const inside = isPointerInsideHudTrigger(state.lastPointerX, state.lastPointerY);
    updateHudHoverState(inside);
    return inside;
  }

  function scheduleHudHide() {
    refreshHudPointerState();
  }

  function showHudTemporarily() {
    if (!state) return;

    state.hud.classList.add(HUD_VISIBLE_CLASS);
  }

  function showEdgeToast(message, durationMs = EDGE_TOAST_DURATION_MS) {
    if (!state || !state.edgeToast) return;

    clearTimeout(state.edgeToastTimer);
    state.edgeToast.textContent = message;
    state.edgeToast.classList.add("dcmv-edge-toast-visible");

    state.edgeToastTimer = setTimeout(() => {
      if (!state?.edgeToast) return;
      state.edgeToast.classList.remove("dcmv-edge-toast-visible");
    }, durationMs);
  }

  function scheduleCursorHide() {
    if (!state) return;

    clearTimeout(state.cursorHideTimer);
    state.cursorHideTimer = setTimeout(() => {
      if (!state) return;
      if (
        state.isPointerOverHudZone ||
        state.isPagePickerOpen ||
        state.isSettingsMenuOpen
      ) {
        return;
      }
      hideCursor();
    }, CURSOR_HIDE_DELAY_MS);
  }

  function showCursor() {
    if (!state || !state.isCursorHidden) return;

    state.isCursorHidden = false;
    state.overlay.classList.remove(CURSOR_HIDDEN_CLASS);
  }

  function hideCursor() {
    if (!state || state.isCursorHidden) return;

    state.isCursorHidden = true;
    state.overlay.classList.add(CURSOR_HIDDEN_CLASS);
  }

  function rememberPointerPosition(x, y) {
    if (!state) return;

    state.lastPointerX = x;
    state.lastPointerY = y;
  }

  function hasPointerMovedSignificantly(x, y) {
    if (!state) return false;
    if (state.lastPointerX == null || state.lastPointerY == null) return true;

    return (
      Math.hypot(x - state.lastPointerX, y - state.lastPointerY) >=
      CURSOR_MOVE_THRESHOLD_PX
    );
  }

  function canNavigate(force) {
    if (!state) return false;

    if (force) {
      state.navLockedUntil = Date.now() + NAV_THROTTLE_MS;
      return true;
    }

    const now = Date.now();
    if (now < state.navLockedUntil) return false;

    state.navLockedUntil = now + NAV_THROTTLE_MS;
    return true;
  }

  function getCurrentAnchorIndex() {
    if (!state || !state.currentStep || !state.currentStep.images.length) {
      return 0;
    }

    return state.currentStep.images[0].index;
  }

  function getSavedImageIndex(targetState = state) {
    const anchorItem = getPrimaryAnchorItem(targetState);
    return anchorItem ? anchorItem.index : 0;
  }

  function resolveInitialAnchorIndex() {
    if (!state) return 0;

    const requestedIndex = findSourceItemIndexByUrl(state.requestedTargetUrl);
    if (requestedIndex >= 0) {
      return requestedIndex;
    }

    const savedPosition = loadLastReadPosition();
    if (!savedPosition) return 0;

    const savedIndex = Number(savedPosition.index);

    if (Number.isInteger(savedIndex)) {
      return Math.max(0, Math.min(savedIndex, state.sourceItems.length - 1));
    }

    return 0;
  }

  function rebuildStepsKeepingAnchor(anchorIndex) {
    state.steps = buildAllSteps();

    let idx = state.steps.findIndex((step) => step.startIndex === anchorIndex);

    if (idx < 0) {
      idx = state.steps.findIndex((step) =>
      step.images.some((img) => img.index === anchorIndex)
      );
    }

    if (idx < 0) idx = 0;

    state.stepIndex = idx;
    state.currentStep = state.steps[idx] || null;
  }
  function getStepSignature(step) {
    if (!step) return "";

    const imageKey = (step.images || [])
      .map((item) => `${item.index}:${item.resolvedSrc || item.src || ""}`)
      .join(",");

    return `${step.displayType || ""}|${step.startIndex}|${imageKey}`;
  }

  function getStepsSignature(steps) {
    if (!Array.isArray(steps)) return "";
    return steps.map((step) => getStepSignature(step)).join("||");
  }

  function findStepIndexForAnchorInSteps(steps, anchorIndex) {
    let idx = steps.findIndex((step) => step.startIndex === anchorIndex);

    if (idx < 0) {
      idx = steps.findIndex((step) =>
        step.images.some((img) => img.index === anchorIndex)
      );
    }

    return idx < 0 ? 0 : idx;
  }

  function applyRebuiltLayoutIfChanged(anchorIndex) {
    if (!state) return false;

    const nextSteps = buildAllSteps();
    const nextStepIndex = findStepIndexForAnchorInSteps(nextSteps, anchorIndex);
    const nextCurrentStep = nextSteps[nextStepIndex] || null;

    if (
      getStepsSignature(state.steps) === getStepsSignature(nextSteps) &&
      getStepSignature(state.currentStep) === getStepSignature(nextCurrentStep) &&
      state.stepIndex === nextStepIndex
    ) {
      return false;
    }

    state.steps = nextSteps;
    state.stepIndex = nextStepIndex;
    state.currentStep = nextCurrentStep;
    return true;
  }


  function buildStepsForSegment(
    items,
    firstPageSingleOverride,
    segmentStartIndex = 0
  ) {
    const steps = [];
    let portraitBuffer = [];
    let portraitSeen = 0;

    function flushPortraitBufferAsSingles() {
      while (portraitBuffer.length) {
        const item = portraitBuffer.shift();
        steps.push(makeSingleStep(item.index, item));
      }
    }

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];

      if (isLandscape(item)) {
        flushPortraitBufferAsSingles();
        steps.push(makeSingleStep(item.index, item));
        continue;
      }

      // 수동 재설정 이후 구간도 첫 두 페이지 예외 규칙을 동일하게 적용한다.
      if (shouldTreatEarlyPortraitAsSingle(item, items, segmentStartIndex)) {
        flushPortraitBufferAsSingles();
        steps.push(makeSingleStep(item.index, item));
        continue;
      }

      portraitSeen += 1;

      if (firstPageSingleOverride && portraitSeen === 1) {
        steps.push(makeSingleStep(item.index, item));
        continue;
      }

      portraitBuffer.push(item);

      if (portraitBuffer.length === 2) {
        const a = portraitBuffer[0];
        const b = portraitBuffer[1];

        steps.push({
          startIndex: a.index,
          images: [a, b],
          nextStartIndex: b.index + 1,
          displayType: "pair"
        });

        portraitBuffer = [];
      }
    }

    flushPortraitBufferAsSingles();
    return steps;
  }

  function buildAllSteps(
    firstPageSingleOverride = state.firstPageSingle,
    itemsOverride = state.sourceItems
  ) {
    const items = itemsOverride;

    if (!state.spreadEnabled) {
      const steps = [];
      for (let i = 0; i < items.length; i += 1) {
        steps.push(makeSingleStep(i, items[i]));
      }
      return steps;
    }

    const resetIndices = Array.isArray(state?.manualPairingResetIndices)
      ? state.manualPairingResetIndices
          .filter((index) => Number.isInteger(index) && index > 0)
          .sort((a, b) => a - b)
      : [];

    if (!resetIndices.length) {
      return buildStepsForSegment(items, firstPageSingleOverride, 0);
    }

    const steps = [];
    let segmentStart = 0;

    for (let i = 0; i <= resetIndices.length; i += 1) {
      const resetIndex = resetIndices[i];
      const segmentEnd = resetIndex == null ? Infinity : resetIndex;
      const segmentItems = items.filter(
        (item) => item.index >= segmentStart && item.index < segmentEnd
      );

      if (!segmentItems.length) {
        segmentStart = resetIndex == null ? segmentStart : resetIndex;
        continue;
      }

      const shouldForceFirstSingle =
        i === 0 ? firstPageSingleOverride : true;

      steps.push(
        ...buildStepsForSegment(
          segmentItems,
          shouldForceFirstSingle,
          segmentStart
        )
      );

      if (resetIndex != null) {
        segmentStart = resetIndex;
      }
    }

    return steps;
  }

  function chooseInitialFirstPageSinglePreference(preferredValue, options = {}) {
    if (!state?.spreadEnabled) return preferredValue;
    const isInitialPhase = options.phase === "1차 판정";
    const rawEvaluationItems = options.evaluationItems || state.sourceItems;
    const evaluationItems = isInitialPhase
      ? rawEvaluationItems.map((item) =>
          isDcPlaceholderSize(item)
            ? { ...item, width: 0, height: 0 }
            : item
        )
      : rawEvaluationItems;
    const landscapeItems = evaluationItems.filter((item) => isLandscape(item));
    if (!landscapeItems.length) {
      return preferredValue;
    }
    if (
      landscapeItems.length === 1 &&
      landscapeItems[0].index === evaluationItems.length - 1
    ) {
      return preferredValue;
    }

    // 뷰어를 처음 열 때만 첫 페이지 단면 on/off를 자동 선택한다.
    // 목적은 가로 페이지 때문에 중간 세로 페이지가 한 장씩 남는 경우를 줄이는 것이다.
    const stepsWithSingle = buildAllSteps(true, evaluationItems);
    const stepsWithoutSingle = buildAllSteps(false, evaluationItems);

    const scoreWithSingle = countLandscapeAdjacentSinglePortraitSteps(
      stepsWithSingle,
      evaluationItems
    );
    const scoreWithoutSingle = countLandscapeAdjacentSinglePortraitSteps(
      stepsWithoutSingle,
      evaluationItems
    );

    if (scoreWithSingle === scoreWithoutSingle) {
      return preferredValue;
    }
    const nextValue = scoreWithSingle < scoreWithoutSingle;
    return nextValue;
  }

  function setImageLoadingProgress(progress, options = {}) {
    if (!state?.imageLoadingBar || !state?.imageLoadingBarFill) return;

    const normalized = Math.max(0, Math.min(1, Number(progress) || 0));
    syncImageLoadingBarPosition();
    state.imageLoadingBar.classList.add("dcmv-image-loading-bar-visible");
    state.imageLoadingBarFill.style.transform = `scaleX(${normalized})`;

    if (options.complete) {
      clearTimeout(state.imageLoadingBarHideTimer);
      state.imageLoadingBarHideTimer = setTimeout(() => {
        if (!state?.imageLoadingBar || !state?.imageLoadingBarFill) return;
        state.imageLoadingBar.classList.remove("dcmv-image-loading-bar-visible");
        state.imageLoadingBarFill.style.transform = "scaleX(0)";
      }, 220);
    }
  }

  function syncImageLoadingBarPosition() {
    if (!state?.imageLoadingBar || !state?.stage) return;

    const targets = Array.from(
      state.stage.querySelectorAll(".dcmv-image, .dcmv-image-failed")
    ).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    });

    if (!targets.length) {
      state.imageLoadingBar.style.opacity = "0";
      return;
    }

    const rects = targets.map((el) => el.getBoundingClientRect());
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const left = Math.min(...rects.map((rect) => rect.left));
    const right = Math.max(...rects.map((rect) => rect.right));
    const barWidth = Math.max(24, right - left);
    const barTop = Math.max(0, bottom - 2);

    state.imageLoadingBar.style.left = `${Math.max(0, left)}px`;
    state.imageLoadingBar.style.top = `${barTop}px`;
    state.imageLoadingBar.style.width = `${Math.min(window.innerWidth, barWidth)}px`;
    state.imageLoadingBar.style.opacity = "";
  }

  function getCurrentPageKey() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  function loadSavedReopenedViewerPageKey() {
    try {
      const raw = window.sessionStorage.getItem(REOPENED_VIEWER_PAGE_SESSION_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.pageKey || "";
    } catch {
      return "";
    }
  }

  function hasReopenedViewerPageKey(pageKey = getCurrentPageKey()) {
    if (reopenedViewerPageKey === pageKey) return true;
    return loadSavedReopenedViewerPageKey() === pageKey;
  }

  function rememberReopenedViewerPageKey(pageKey = getCurrentPageKey()) {
    reopenedViewerPageKey = pageKey;

    try {
      window.sessionStorage.setItem(
        REOPENED_VIEWER_PAGE_SESSION_KEY,
        JSON.stringify({ pageKey })
      );
    } catch {
    }
  }

  function loadSavedManualPairingResetIndices() {
    try {
      const raw = window.sessionStorage.getItem(MANUAL_PAIRING_RESET_SESSION_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || parsed.pageKey !== getCurrentPageKey()) return null;
      return Array.isArray(parsed.indices)
        ? parsed.indices.filter((index) => Number.isInteger(index) && index > 0)
        : null;
    } catch {
      return null;
    }
  }

  function saveManualPairingResetIndices(indices) {
    try {
      window.sessionStorage.setItem(
        MANUAL_PAIRING_RESET_SESSION_KEY,
        JSON.stringify({
          pageKey: getCurrentPageKey(),
          indices: Array.isArray(indices) ? indices : []
        })
      );
    } catch {
    }
  }

  function clearSavedManualPairingResetIndices() {
    state.manualPairingResetIndices = [];
    try {
      window.sessionStorage.removeItem(MANUAL_PAIRING_RESET_SESSION_KEY);
    } catch {
    }
  }

  function loadAutoFirstPageSingleSession() {
    try {
      const raw = window.sessionStorage.getItem(FIRST_PAGE_AUTO_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function loadSavedAutoFirstPageSingleValue() {
    const saved = loadAutoFirstPageSingleSession();
    if (!saved || saved.pageKey !== getCurrentPageKey()) return null;
    if (typeof saved.value !== "boolean") return null;
    return saved.value;
  }

  function shouldApplyInitialFirstPageSingleAuto() {
    try {
      const saved = loadAutoFirstPageSingleSession();
      return !saved || saved.pageKey !== getCurrentPageKey();
    } catch {
      return true;
    }
  }

  function saveAutoAdjustedFirstPageSingleValue(value) {
    try {
      window.sessionStorage.setItem(
        FIRST_PAGE_AUTO_SESSION_KEY,
        JSON.stringify({
          pageKey: getCurrentPageKey(),
          value: !!value
        })
      );
    } catch {
      // Ignore sessionStorage failures and continue without caching the auto-adjusted value.
    }
  }

  function applyInitialFirstPageSingleAuto(preferredValue) {
    if (
      !state ||
      !state.autoFirstPageAdjust ||
      state.hasUserAdjustedFirstPageSingle ||
      !shouldApplyInitialFirstPageSingleAuto()
    ) {
      return false;
    }

    const evaluationItems = state.sourceItems.slice(0, INITIAL_AUTO_EVAL_PAGE_LIMIT);
    const nextValue = chooseInitialFirstPageSinglePreference(preferredValue, {
      phase: "1차 판정",
      evaluationItems
    });
    state.firstPageSingle = nextValue;

    if (nextValue === preferredValue) {
      return false;
    }

    state.didAutoAdjustFirstPageSingle = true;
    saveAutoAdjustedFirstPageSingleValue(nextValue);
    return true;
  }

  function syncKnownDimensionsFromDom() {
    if (!state?.root || !state?.sourceItems?.length) return;

    const refreshed = refreshSourceItemsFromDom();
    if (!refreshed?.nextSourceItems?.length) return;

    for (const nextItem of refreshed.nextSourceItems) {
      const currentItem = state.sourceItems[nextItem.index];
      if (!currentItem) continue;
      if (!currentItem.width && nextItem.width) {
        currentItem.width = nextItem.width;
      }
      if (!currentItem.height && nextItem.height) {
        currentItem.height = nextItem.height;
      }
    }
  }

  async function waitForAllPagesReadyBeforeSecondPass(maxWaitMs = 2000) {
    if (!state?.sourceItems?.length) return;

    const startedAt = Date.now();

    while (state) {
      syncKnownDimensionsFromDom();

      const allReady = state.sourceItems.every((item) =>
        hasUsableImageMetadata(item)
      );
      if (allReady) {
        return;
      }

      if (Date.now() - startedAt >= maxWaitMs) {
        return;
      }

      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 80);
        state?.repairTimers?.push(timer);
      });
    }
  }

  async function ensureInitialAutoMetadataWindow() {
    if (!state?.sourceItems?.length) return;
    if (state.initialAutoMetadataPromise) {
      await state.initialAutoMetadataPromise;
      return;
    }

    const targetItems = state.sourceItems
      .slice(0, INITIAL_AUTO_REQUIRED_KNOWN_PAGES)
      .filter((item) => !item.width || !item.height || isDcPlaceholderSize(item));

    if (!targetItems.length) {
      return;
    }

    state.initialAutoMetadataPromise = Promise.all(
      targetItems.map((item) => loadImageMetadata(item))
    ).finally(() => {
      if (state) {
        state.initialAutoMetadataPromise = null;
      }
    });

    await state.initialAutoMetadataPromise;
  }

  async function runInitialAutoWhenReady(reason) {
    if (!state || state.hasRunInitialAutoAfterFirstImageLoad) {
      return;
    }

    if (state.shouldReuseSavedAutoFirstPageSingle) {
      state.hasRunInitialAutoAfterFirstImageLoad = true;
      await presentInitialViewerAfterInitialAuto(false);
      return;
    }

    await ensureInitialAutoMetadataWindow();
    syncKnownDimensionsFromDom();

    const rawEvaluationItems = state.sourceItems.slice(0, INITIAL_AUTO_EVAL_PAGE_LIMIT);
    const evaluationItems = rawEvaluationItems.map((item) =>
      isDcPlaceholderSize(item)
        ? { ...item, width: 0, height: 0 }
        : item
    );
    const rawKnownSizeCount = rawEvaluationItems.filter((item) => item.width && item.height).length;
    const knownSizeCount = evaluationItems.filter((item) => item.width && item.height).length;
    const totalCount = state.sourceItems.length;
    const requiredKnownSizeCount = Math.min(INITIAL_AUTO_REQUIRED_KNOWN_PAGES, totalCount);
    const hasEnoughKnownPages = knownSizeCount >= INITIAL_AUTO_REQUIRED_KNOWN_PAGES;
    const hasLoadedAllKnownPages = rawKnownSizeCount >= Math.min(totalCount, INITIAL_AUTO_EVAL_PAGE_LIMIT);

    if (!hasEnoughKnownPages && !hasLoadedAllKnownPages) {
      return;
    }

    state.hasRunInitialAutoAfterFirstImageLoad = true;

    const previousFirstPageSingle = state.firstPageSingle;
    const didChange = applyInitialFirstPageSingleAuto(previousFirstPageSingle);
    if (didChange) {
      state.firstSingleCheckbox.checked = state.firstPageSingle;
      syncToggleVisuals();
      rebuildStepsKeepingAnchor(getCurrentAnchorIndex());
      renderCurrentStep();
      syncHudTrigger();
    }

    await presentInitialViewerAfterInitialAuto(didChange);
  }

  async function presentInitialViewerAfterInitialAuto(didChange) {
    if (!state || state.hasPresentedInitialViewer) {
      return;
    }

    await sleep(5);
    if (!state || state.hasPresentedInitialViewer) {
      return;
    }

    state.hasPresentedInitialViewer = true;
    state.stage.style.visibility = "";
    setImageLoadingProgress(0.22);
    showHudTemporarily();

    if (didChange) {
      showEdgeToast("첫 페이지가 단면 설정이 자동 조정 되었습니다.", 2000);
    }
  }

  function countLandscapeAdjacentSinglePortraitSteps(
    steps,
    sourceItems = state?.sourceItems || []
  ) {
    if (!Array.isArray(steps)) return 0;

    let count = 0;
    const lastIndex = Math.max(0, sourceItems.length - 1 || 0);
    const leadingBoundaryIndex = getLeadingBoundaryExclusionIndex(sourceItems);

    for (const step of steps) {
      if (!step || step.displayType !== "single" || step.images.length !== 1) {
        continue;
      }

      const item = step.images[0];
      if (!item || isLandscape(item)) continue;
      // 앞쪽 경계는 1페이지를 기본으로 제외한다.
      // 다만 1페이지가 가로면 2페이지, 2페이지도 가로면 3페이지까지 넘겨서 본다.
      // 뒤쪽은 마지막 페이지가 혼자 남는 경우를 자연스러운 경계로 보고 제외한다.
      if (item.index === leadingBoundaryIndex || item.index === lastIndex) continue;

      const prevItem = sourceItems[item.index - 1] || null;
      const nextItem = sourceItems[item.index + 1] || null;
      const hasLandscapeNeighbor =
        (!!prevItem && isLandscape(prevItem)) || (!!nextItem && isLandscape(nextItem));

      if (hasLandscapeNeighbor) count += 1;
    }

    return count;
  }

  function getLeadingBoundaryExclusionIndex(items = state?.sourceItems || []) {
    const maxIndex = Math.min(2, items.length - 1);

    for (let i = 0; i <= maxIndex; i += 1) {
      if (!isLandscape(items[i])) {
        return i;
      }
    }

    return 0;
  }

  function makeSingleStep(startIndex, item) {
    return {
      startIndex,
      images: [item],
      nextStartIndex: startIndex + 1,
      displayType: "single"
    };
  }

  function goNext(force = false) {
    if (!state || !state.currentStep) return;
    if (!canNavigate(force)) return;
    if (state.stepIndex >= state.steps.length - 1) {
      if (state.edgeToastCooldownRemaining > 0) {
        state.edgeToastCooldownRemaining -= 1;
        return;
      }

      showEdgeToast("마지막 페이지입니다.");
      state.edgeToastCooldownRemaining = EDGE_TOAST_COOLDOWN_ATTEMPTS;
      return;
    }

    state.edgeToastCooldownRemaining = EDGE_TOAST_COOLDOWN_ATTEMPTS;
    state.stepIndex += 1;
    state.currentStep = state.steps[state.stepIndex];
    renderCurrentStep();
    syncHudTrigger();
    saveLastReadPosition();
  }

  function goPrev(force = false) {
    if (!state || !state.currentStep) return;
    if (!canNavigate(force)) return;
    if (state.stepIndex <= 0) return;

    state.stepIndex -= 1;
    state.currentStep = state.steps[state.stepIndex];
    renderCurrentStep();
    syncHudTrigger();
    saveLastReadPosition();
  }

  function goToPageIndex(pageIndex, options = {}) {
    if (!state) return;

    const normalizedIndex = Math.max(
      0,
      Math.min(Number(pageIndex) || 0, state.sourceItems.length - 1)
    );

    if (options.keepPickerOpen) {
      rebuildStepsKeepingAnchor(normalizedIndex);
      renderCurrentStep();
      togglePagePicker(true);
      return;
    }

    togglePagePicker(false);
    state.navLockedUntil = Date.now() + NAV_THROTTLE_MS;

    setTimeout(() => {
      if (!state) return;

      rebuildStepsKeepingAnchor(normalizedIndex);
      renderCurrentStep();
      saveLastReadPosition();
    }, NAV_THROTTLE_MS);
  }

  function renderCurrentStep() {
    if (!state) return;

    const step = state.currentStep;

    if (!step || !step.images.length) {
      const empty = document.createElement("div");
      empty.className = "dcmv-empty";
      empty.textContent = "표시할 페이지가 없습니다.";
      state.stage.replaceChildren(empty);
      state.pageCounter.textContent = `0 / ${state.totalCount}`;
      return;
    }

    state.stage.replaceChildren();

    const wrap = document.createElement("div");
    wrap.className = `dcmv-page-wrap ${
      step.displayType === "pair" ? "dcmv-page-pair" : "dcmv-page-single"
    }`;

    if (
      step.displayType === "single" &&
      step.images[0].width > step.images[0].height
    ) {
      wrap.classList.add("dcmv-page-single-landscape");
    }

    let renderImages = step.images;
    if (step.displayType === "pair" && state.readingDirectionRTL) {
      renderImages = [step.images[1], step.images[0]];
    }

    for (const item of renderImages) {
      if (item.failed) {
        const failedBox = document.createElement("div");
        failedBox.className = "dcmv-image dcmv-image-failed";
        failedBox.style.display = "flex";
        failedBox.style.alignItems = "center";
        failedBox.style.justifyContent = "center";
        failedBox.style.minHeight = "320px";
        failedBox.style.padding = "24px";
        failedBox.style.boxSizing = "border-box";
        failedBox.style.textAlign = "center";
        failedBox.style.whiteSpace = "pre-line";
        failedBox.textContent = "이미지 로딩 실패";
        wrap.appendChild(failedBox);
        continue;
      }

      const img = document.createElement("img");
      img.className = "dcmv-image";
      img.src = item.resolvedSrc || item.src || "";
      img.alt = item.alt || "";
      img.draggable = false;

      const logFirstViewerImageLoad = () => {
        if (!state || state.hasLoggedFirstViewerImageLoad) return;
        state.hasLoggedFirstViewerImageLoad = true;
        queueMicrotask(() => {
          runInitialAutoWhenReady("첫 이미지 로드 완료");
        });
      };

      if (img.complete && img.naturalWidth) {
        queueMicrotask(() => {
          logFirstViewerImageLoad();
          syncImageLoadingBarPosition();
        });
      } else {
        img.addEventListener(
          "load",
          () => {
            logFirstViewerImageLoad();
            syncImageLoadingBarPosition();
          },
          { once: true }
        );
      }

      if (item.resolvedSrc && item.src && item.resolvedSrc !== item.src) {
        img.addEventListener(
          "error",
          () => {
            img.src = item.src;
          },
          { once: true }
        );
      }

      img.addEventListener("error", () => {
        handleViewerImageError(item);
        syncImageLoadingBarPosition();
      });

      wrap.appendChild(img);
    }

    state.stage.appendChild(wrap);
    renderPageCounter(step);
    syncManualResetClearVisibility();
    syncImageLoadingBarPosition();
    preloadNearbySteps();
  }

  function renderPageCounter(step) {
    if (!state) return;

    if (step.images.length === 1) {
      state.pageCounterLabel.textContent = `${step.images[0].displayIndex} / ${state.totalCount}`;
      renderPagePicker();
      return;
    }

    state.pageCounterLabel.textContent =
      `${step.images[0].displayIndex}, ${step.images[1].displayIndex} / ${state.totalCount}`;
    renderPagePicker();
  }

  function preloadNearbySteps() {
    if (!state || !state.currentStep) return;

    const targets = [state.stepIndex + 1, state.stepIndex + 2, state.stepIndex - 1]
      .filter((i) => i >= 0 && i < state.steps.length);

    for (const idx of targets) {
      for (const item of state.steps[idx].images) {
        if (item.failed) continue;
        const img = new Image();
        img.src = item.resolvedSrc || item.src || "";
      }
    }
  }

  function isLandscape(item) {
    if (!item || !item.width || !item.height) return false;
    if (isDcPlaceholderSize(item)) return false;
    return item.width >= item.height;
  }

  function shouldTreatEarlyPortraitAsSingle(item, items, segmentStartIndex = 0) {
    if (!item || item.index - segmentStartIndex > 1) return false;
    if (isLandscape(item)) return false;

    const portraitSamples = items
      .slice(2)
      .filter((sample) => isReliablePortraitReference(sample))
      .map((sample) => getPortraitRatio(sample));

    const candidateRatio = getPortraitRatio(item);

    if (portraitSamples.length < EARLY_STRIP_MIN_SAMPLE_PORTRAITS) {
      return false;
    }

    const baseRatio = getMedian(portraitSamples);
    if (!baseRatio) return false;

    const clusterCount = portraitSamples.filter((ratio) =>
      Math.abs(ratio - baseRatio) / baseRatio <= EARLY_STRIP_CLUSTER_TOLERANCE
    ).length;

    if (
      clusterCount / portraitSamples.length <
      EARLY_STRIP_REQUIRED_CLUSTER_SHARE
    ) {
      return false;
    }

    return (
      candidateRatio < baseRatio * EARLY_STRIP_RATIO_LOWER_THRESHOLD ||
      candidateRatio > baseRatio * EARLY_STRIP_RATIO_UPPER_THRESHOLD
    );
  }

  function isReliablePortraitReference(item) {
    if (!item) return false;
    if (item.failed) return false;
    if (isLandscape(item)) return false;
    if (!item.width || !item.height) return false;
    if (
      item.width < EARLY_STRIP_MIN_DIMENSION ||
      item.height < EARLY_STRIP_MIN_DIMENSION
    ) {
      return false;
    }

    return true;
  }

  function getPortraitRatio(item) {
    if (!item?.width || !item?.height) return 0;
    return item.height / item.width;
  }

  function getMedian(values) {
    if (!values.length) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) {
      return sorted[mid];
    }

    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function findContentRoot() {
    const selectors = [
      ".writing_view_box",
      ".write_div",
      ".view_content_wrap",
      ".view_content",
      ".gallview_contents",
      ".ub-content",
      "article",
      "main"
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    return document.body;
  }


  function isInsideExcludedImageCommentArea(el) {
    if (!(el instanceof Element)) return false;
    return !!el.closest("div.comment_box.img_comment_box");
  }

  function isExcludedInlineDcconImage(el) {
    if (!(el instanceof Element)) return false;
    return el.matches("img.written_dccon");
  }

  function isInsideOpenGraphPreview(el) {
    if (!(el instanceof Element)) return false;
    return !!el.closest("div.og-div");
  }

  function collectSourceItems(root) {
    const domImages = Array.from(root.querySelectorAll("img"));
    const result = [];
    const seen = new Set();

    for (const imgEl of domImages) {
      if (isInsideExcludedImageCommentArea(imgEl)) continue;
      if (isExcludedInlineDcconImage(imgEl)) continue;
      if (isInsideOpenGraphPreview(imgEl)) continue;

      const originalPopUrl = parseOriginalPopUrlFromTag(imgEl.outerHTML || "");
      const normalSrc =
        imgEl.getAttribute("data-original") ||
        imgEl.getAttribute("data-src") ||
        imgEl.getAttribute("src") ||
        resolveImageUrlFromTag(imgEl.outerHTML || "");

      const decodedSrc = decodeHtml(normalSrc || "");
      const decodedPopUrl = decodeHtml(originalPopUrl || "");
      const dedupeKey = decodedPopUrl || decodedSrc;

      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      result.push({
        src: decodedSrc || "",
        originalPopUrl: decodedPopUrl || "",
        resolvedSrc: "",
        width:
          imgEl.naturalWidth ||
          Number(imgEl.getAttribute("width")) ||
          0,
        height:
          imgEl.naturalHeight ||
          Number(imgEl.getAttribute("height")) ||
          0,
        alt: imgEl.getAttribute("alt") || "",
        index: result.length,
        displayIndex: result.length + 1,
        element: imgEl,
        failed: false
      });
    }

    return result;
  }

  function loadLastReadPosition() {
    try {
      const raw = window.sessionStorage.getItem(PAGE_SESSION_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (!saved) return null;
      const currentPageKey = `${location.origin}${location.pathname}${location.search}`;
      return saved.pageKey === currentPageKey ? saved : null;
    } catch {
      return null;
    }
  }

  function getPrimaryAnchorItem(targetState = state) {
    if (!targetState?.currentStep?.images?.length) return null;

    if (targetState.currentStep.images.length === 1) {
      return targetState.currentStep.images[0];
    }

    return targetState.readingDirectionRTL
      ? targetState.currentStep.images[targetState.currentStep.images.length - 1]
      : targetState.currentStep.images[0];
  }

  function normalizeComparableUrl(url) {
    if (!url) return "";

    try {
      return new URL(url, location.href).href;
    } catch {
      return String(url);
    }
  }
  function getComparableUrlsForItem(item) {
    if (!item) return [];

    const urls = [
      item.src,
      item.resolvedSrc,
      item.originalPopUrl,
      item.element?.currentSrc,
      item.element?.getAttribute?.("src"),
      item.element?.getAttribute?.("data-src"),
      item.element?.getAttribute?.("data-original")
    ]
      .map((value) => normalizeComparableUrl(value || ""))
      .filter(Boolean);

    return Array.from(new Set(urls));
  }

  function findSourceItemIndexByUrl(targetUrl) {
    if (!state || !targetUrl) return -1;

    for (const item of state.sourceItems) {
      if (getComparableUrlsForItem(item).includes(targetUrl)) {
        return item.index;
      }
    }

    return -1;
  }

  function getStableItemKey(item) {
    const urls = getComparableUrlsForItem(item);
    return urls[0] || "";
  }

  function saveLastReadPosition(targetState = state) {
    if (!targetState) return;

    const pageKey = `${location.origin}${location.pathname}${location.search}`;
    const nextPosition = {
      pageKey,
      index: getSavedImageIndex(targetState)
    };

    try {
      window.sessionStorage.setItem(PAGE_SESSION_KEY, JSON.stringify(nextPosition));
    } catch {
      // Ignore sessionStorage failures and continue without restoring position.
    }
  }

  function shouldIgnoreKeydown(e) {
    if (e.defaultPrevented) return true;
    if (e.ctrlKey || e.altKey || e.metaKey) return true;

    const target = e.target;
    if (!(target instanceof Element)) return false;

    return !!target.closest("input, textarea, select, [contenteditable=\"true\"]");
  }

  function getLogicalNavigationForKey(e) {
    const key = String(e.key || "").toLowerCase();

    if (key === " " || key === "spacebar") {
      return e.shiftKey ? "prev" : "next";
    }

    if (key === "arrowdown" || (state?.useWasd && key === "s")) return "next";
    if (key === "arrowup" || (state?.useWasd && key === "w")) return "prev";

    if (key === "arrowright" || (state?.useWasd && key === "d")) {
      return state?.readingDirectionRTL ? "prev" : "next";
    }

    if (key === "arrowleft" || (state?.useWasd && key === "a")) {
      return state?.readingDirectionRTL ? "next" : "prev";
    }

    return null;
  }

  function getLogicalNavigationForViewportSide(clientX, options = {}) {
    const viewportCenterX = window.innerWidth / 2;
    const halfDeadZone = options.ignoreDeadZone
      ? 0
      : getViewportClickDeadZoneWidth() / 2;

    if (Math.abs(clientX - viewportCenterX) <= halfDeadZone) {
      return null;
    }

    const isLeftSide = clientX < viewportCenterX;

    if (isLeftSide) {
      return state?.readingDirectionRTL ? "next" : "prev";
    }

    return state?.readingDirectionRTL ? "prev" : "next";
  }
  function getViewportClickDeadZoneWidth() {
    const baseWidth = Math.max(
      CLICK_DEAD_ZONE_MIN_PX,
      Math.min(CLICK_DEAD_ZONE_MAX_PX, window.innerWidth * CLICK_DEAD_ZONE_RATIO)
    );

    if (isSinglePortraitStep()) {
      return Math.round(baseWidth * SINGLE_PORTRAIT_DEAD_ZONE_SCALE);
    }

    return baseWidth;
  }

  function isSinglePortraitStep() {
    if (!state?.currentStep?.images?.length) return false;
    if (state.currentStep.displayType !== "single") return false;

    const item = state.currentStep.images[0];
    return !!item && !isLandscape(item);
  }

  function getLogicalNavigationForOverlayButton(action) {
    const isLeftButton = action === "prev";

    if (isLeftButton) {
      return state?.readingDirectionRTL ? "next" : "prev";
    }

    return state?.readingDirectionRTL ? "prev" : "next";
  }

  async function hydrateImageMetadata(items, options = {}) {
    const orientationChangedPages = [];

    for (let i = 0; i < items.length; i += IMAGE_METADATA_BATCH_SIZE) {
      const batch = items.slice(i, i + IMAGE_METADATA_BATCH_SIZE);
      const results = await Promise.all(batch.map((item) => loadImageMetadata(item, options)));

      for (const result of results) {
        if (result && result.orientationChanged) {
          orientationChangedPages.push(result.index);
        }
      }
    }

    return { orientationChangedPages };
  }

  function loadImageMetadata(item, options = {}) {
    return new Promise((resolve) => {
      let done = false;
      const prevLandscape = isLandscapeLike(item.width, item.height);

      const finish = (failed) => {
        if (done) return;
        done = true;
        clearTimeout(timer);

        if (!item.width) item.width = 1200;
        if (!item.height) item.height = 1700;

        if (failed && !options.forceImageFailure) {
          item.failed = false;
        } else {
          item.failed = !!failed;
        }

        if (!item.failed && item.width >= item.height && item.originalPopUrl) {
          item.resolvedSrc = convertPopUrlToDirectImageUrl(item.originalPopUrl);
        } else {
          item.resolvedSrc = "";
        }

        const nextLandscape = isLandscapeLike(item.width, item.height);
        resolve({
          index: item.index,
          orientationChanged:
            (prevLandscape === null && nextLandscape !== null) ||
            (prevLandscape !== null &&
              nextLandscape !== null &&
              prevLandscape !== nextLandscape)
        });
      };

      const probe = new Image();

      probe.onload = () => {
        item.width = probe.naturalWidth || item.width || 1200;
        item.height = probe.naturalHeight || item.height || 1700;
        finish(false);
      };

      probe.onerror = () => {
        finish(false);
      };

      const timer = setTimeout(() => {
        finish(false);
      }, IMAGE_METADATA_TIMEOUT_MS);

      try {
        probe.src = item.src || "";
      } catch {
        finish(false);
      }
    });
  }

  function findElementForSourceItem(root, targetItem) {
    if (!root || !targetItem) return null;

    const imgs = Array.from(root.querySelectorAll("img"));
    const targetKey = decodeHtml(targetItem.originalPopUrl || targetItem.src || "");

    if (!targetKey) return null;

    for (const imgEl of imgs) {
      const imgSrc =
        imgEl.getAttribute("data-original") ||
        imgEl.getAttribute("data-src") ||
        imgEl.getAttribute("src") ||
        "";

      const imgPopUrl = parseOriginalPopUrlFromTag(imgEl.outerHTML || "");
      const imgKey = decodeHtml(imgPopUrl || imgSrc || "");

      if (imgKey === targetKey) {
        return imgEl;
      }
    }

    return null;
  }

  function estimateRenderedImageHeight(root, item, contentWidth) {
    const actualHeight = getActualRenderedHeightForItem(root, item);
    if (actualHeight != null) {
      return actualHeight;
    }

    const width = Math.max(1, Number(item?.width) || 1);
    const height = Math.max(1, Number(item?.height) || 1);

    return contentWidth * (height / width);
  }

  function getActualRenderedHeightForItem(root, item) {
    const el = findElementForSourceItem(root, item);
    if (!el || !document.contains(el)) return null;

    const rect = el.getBoundingClientRect();
    if (!rect.height || rect.height <= 1) return null;

    return rect.height;
  }

  function estimateScrollTopForImageIndex(root, sourceItems, targetIndex) {
    if (!root || !sourceItems?.length) return null;

    const rootRect = root.getBoundingClientRect();
    const currentScrollY = window.scrollY || window.pageYOffset;
    const rootTop = rootRect.top + currentScrollY;
    const contentWidth = Math.max(320, root.clientWidth || rootRect.width || 320);

    let y = rootTop;

    for (let i = 0; i < targetIndex; i += 1) {
      const item = sourceItems[i];
      y += estimateRenderedImageHeight(root, item, contentWidth);
      y += 12;
    }

    return Math.max(0, Math.round(y));
  }

  function convertPopUrlToDirectImageUrl(popUrl) {
    if (!popUrl) return "";

    try {
      const url = new URL(popUrl);
      const no = url.searchParams.get("no");
      if (!no) return "";
      return `https://image.dcinside.com/viewimage.php?id=&no=${no}`;
    } catch {
      return "";
    }
  }

  function parseOriginalPopUrlFromTag(tag) {
    const match = tag.match(/imgPop\(['"]([^'"]+)['"]/i);
    if (!match) return "";
    return decodeHtml(match[1]);
  }

  function resolveImageUrlFromTag(tag) {
    const dataOriginal = parseAttr(tag, "data-original");
    if (dataOriginal && isDcImageUrl(dataOriginal)) {
      return decodeHtml(dataOriginal);
    }

    const dataSrc = parseAttr(tag, "data-src");
    if (dataSrc && isDcImageUrl(dataSrc)) {
      return decodeHtml(dataSrc);
    }

    const src = parseAttr(tag, "src");
    if (src && isDcImageUrl(src)) {
      return decodeHtml(src);
    }

    return "";
  }

  function parseAttr(tag, attrName) {
    const regex = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, "i");
    const match = tag.match(regex);
    return match ? match[1] : "";
  }

  function isDcImageUrl(url) {
    return /https?:\/\/(?:dcimg\d+|image)\.dcinside\.(?:com|co\.kr)\/(?:viewimage\.php\?|dccon\.php|data\/)/i.test(
      url
    );
  }

  function decodeHtml(str) {
    if (!str || !str.includes("&")) return str;

    const parser = new DOMParser();
    const doc = parser.parseFromString(str, "text/html");
    return doc.documentElement.textContent || "";
  }

  function handleViewerImageError(item) {
    if (!state || !item) return;

    const count = item.viewerRetryCount || 0;
    if (count >= VIEWER_IMAGE_RETRY_LIMIT) return;

    item.viewerRetryCount = count + 1;
    setTimeout(() => {
      if (!state) return;
      retrySourceItem(item).then(() => {
        if (!state) return;
        renderCurrentStep();
      });
    }, 500);
  }

  function refreshSourceItemsFromDom() {
    if (!state) {
      return { nextSourceItems: [], countChanged: false };
    }

    const prevItemsByKey = new Map();
    for (const item of state.sourceItems) {
      const key = getStableItemKey(item);
      if (key) {
        prevItemsByKey.set(key, item);
      }
    }

    const nextSourceItems = collectSourceItems(state.root).map((item) => {
      const prevItem = prevItemsByKey.get(getStableItemKey(item));
      if (!prevItem) return item;

      return {
        ...item,
        resolvedSrc: prevItem.resolvedSrc || item.resolvedSrc,
        width: prevItem.width || item.width,
        height: prevItem.height || item.height,
        failed: prevItem.failed,
        viewerRetryCount: prevItem.viewerRetryCount || 0
      };
    });

    const countChanged = nextSourceItems.length !== state.sourceItems.length;

    return { nextSourceItems, countChanged };
  }

  function applyRefreshedSourceItems(nextSourceItems) {
    if (!state) return;

    state.sourceItems = nextSourceItems;
    state.totalCount = nextSourceItems.length;
  }

  async function retryMissingItems() {
    if (!state) {
      return { orientationChangedPages: [] };
    }

    const missing = state.sourceItems.filter((item) => item.failed || !item.width || !item.height);
    const orientationChangedPages = [];
    for (const item of missing) {
      const result = await retrySourceItem(item);
      if (result?.orientationChanged) {
        orientationChangedPages.push(result.index);
      }
    }

    return { orientationChangedPages };
  }

  async function retrySourceItem(item) {
    if (!item) return;
    item.src = appendCacheBust(item.src || item.resolvedSrc || "");
    return loadImageMetadata(item);
  }

  function getPrimaryVisiblePageIndex() {
    if (!state || !state.currentStep || !state.currentStep.images.length) return 0;

    if (state.currentStep.images.length === 1) {
      return state.currentStep.images[0].index;
    }

    return state.readingDirectionRTL
      ? state.currentStep.images[state.currentStep.images.length - 1].index
      : state.currentStep.images[0].index;
  }

  function getCurrentStepRenderUrls(targetState = state) {
    if (!targetState?.currentStep?.images?.length) return [];

    return targetState.currentStep.images.map((item) => ({
      index: item.index,
      url: item.resolvedSrc || item.src || ""
    }));
  }

  function syncCurrentStepImagesFromSourceItems() {
    if (!state?.currentStep?.images?.length) return;

    state.currentStep = {
      ...state.currentStep,
      images: state.currentStep.images.map((item) =>
        state.sourceItems[item.index] || item
      )
    };
  }

  function didCurrentStepRenderUrlsChange(previousUrls) {
    if (!Array.isArray(previousUrls) || !previousUrls.length) return false;

    return previousUrls.some((entry) => {
      const nextItem = state?.sourceItems?.[entry.index];
      if (!nextItem) return false;
      return (nextItem.resolvedSrc || nextItem.src || "") !== entry.url;
    });
  }

  function scheduleInitialPostLazyRefresh() {
    if (!state) return;

    runInitialLazyRepair().catch((err) => {
      console.error("[Mangall Viewer] initial post-lazy refresh failed", err);
    });

  }

  async function runInitialLazyRepair() {
    if (!state) return;

    setImageLoadingProgress(0.38);
    await wakeLazyImages(state.root);
    hasAutoLazyWakeRunInThisTabPage = true;
    runInitialAutoWhenReady("lazy 깨우기 완료");
    setImageLoadingProgress(0.62);

    if (!state) return;

    await waitForAllPagesReadyBeforeSecondPass(2000);

    if (!state) return;

    setImageLoadingProgress(0.82);
    await initialPostLazyRefreshRound();
  }

  async function initialPostLazyRefreshRound() {
    if (!state) return;

    const refreshResult = refreshSourceItemsFromDom();
    const previousCount = state.totalCount;
    const anchorIndexBefore = getCurrentAnchorIndex();
    const stepIndexBefore = state.stepIndex;
    const previousRenderUrls = getCurrentStepRenderUrls();
    let didChange = false;

    applyRefreshedSourceItems(refreshResult.nextSourceItems);
    const metadataResult = state.sourceItems.length
      ? await hydrateImageMetadata(state.sourceItems)
      : { orientationChangedPages: [] };
    const retryResult = await retryMissingItems();

    if (
      state.autoFirstPageAdjust &&
      !state.hasUserAdjustedFirstPageSingle
    ) {
      const previousFirstPageSingle = state.firstPageSingle;
      state.firstPageSingle = chooseInitialFirstPageSinglePreference(previousFirstPageSingle, {
        phase: "2차 판정"
      });
      if (state.firstPageSingle !== previousFirstPageSingle) {
        didChange = true;
        state.didAutoAdjustFirstPageSingle = true;
        saveAutoAdjustedFirstPageSingleValue(state.firstPageSingle);
        showEdgeToast("첫 페이지가 단면 설정이 자동 조정 되었습니다.", 2000);
      }
      syncToggleVisuals();
    }

    const layoutChanged = applyRebuiltLayoutIfChanged(anchorIndexBefore);

    if (!layoutChanged) {
      state.stepIndex = Math.max(0, Math.min(stepIndexBefore, state.steps.length - 1));
      state.currentStep = state.steps[state.stepIndex] || state.currentStep;
      if (didCurrentStepRenderUrlsChange(previousRenderUrls)) {
        syncCurrentStepImagesFromSourceItems();
      }
    }

    renderCurrentStep();
    syncHudTrigger();
    setImageLoadingProgress(1, { complete: true });
    if (
      refreshResult.countChanged ||
      metadataResult.orientationChangedPages.length ||
      retryResult.orientationChangedPages.length ||
      didChange ||
      layoutChanged
    ) {
      if (state.totalCount !== previousCount) {
        showEdgeToast("이미지가 추가 확인되어 새로고침 하였습니다.", 2000);
      }
    }
  }
  function rebuildStepsForOrientationChange(primaryPageIndex) {
    if (!state) return;

    state.steps = buildAllSteps();

    let idx = state.steps.findIndex((step) =>
      step.images.some((img) => img.index === primaryPageIndex)
    );

    if (idx < 0) {
      idx = Math.max(0, Math.min(state.stepIndex, state.steps.length - 1));
    }

    state.stepIndex = idx;
    state.currentStep = state.steps[idx] || null;
  }

  function scheduleBackgroundRepair() {
    if (!state) return;

    clearRepairTimers(state);

    for (let i = 0; i < REPAIR_MAX_ROUNDS; i += 1) {
      const delay = REPAIR_INITIAL_DELAY_MS + REPAIR_INTERVAL_MS * i;
      const timer = setTimeout(() => {
        backgroundRepairRound().catch((err) => {
          console.error("[Mangall Viewer] background repair failed", err);
        });
      }, delay);
      state.repairTimers.push(timer);
    }
  }

  async function backgroundRepairRound() {
    if (!state || state.isRepairRunning) return;
    state.isRepairRunning = true;

    try {
      const anchorIndexBefore = getCurrentAnchorIndex();
      const stepIndexBefore = state.stepIndex;
      const previousRenderUrls = getCurrentStepRenderUrls();

      if (!hasAutoLazyWakeRunInThisTabPage) {
        await wakeLazyImages(state.root);
        hasAutoLazyWakeRunInThisTabPage = true;
      }

      const refreshResult = refreshSourceItemsFromDom();
      applyRefreshedSourceItems(refreshResult.nextSourceItems);
      await hydrateImageMetadata(state.sourceItems);
      await retryMissingItems();

      const layoutChanged = applyRebuiltLayoutIfChanged(anchorIndexBefore);

      if (!layoutChanged) {
        state.stepIndex = Math.max(0, Math.min(stepIndexBefore, state.steps.length - 1));
        state.currentStep = state.steps[state.stepIndex] || state.currentStep;
        if (didCurrentStepRenderUrlsChange(previousRenderUrls)) {
          syncCurrentStepImagesFromSourceItems();
        }
      }

      renderCurrentStep();
      syncHudTrigger();
    } finally {
      if (state) {
        state.isRepairRunning = false;
      }
    }
  }
  async function runManualRefresh() {
    if (!state || state.isRepairRunning || state.isManualRefreshRunning) return;
    state.isRepairRunning = true;
    state.isManualRefreshRunning = true;
    const hadManualPairingReset =
      Array.isArray(state.manualPairingResetIndices) &&
      state.manualPairingResetIndices.length > 0;
    state.manualPairingResetIndices = [];
    clearSavedManualPairingResetIndices();
    setRefreshButtonState(true);

    try {
      const anchorIndexBefore = getCurrentAnchorIndex();
      const stepIndexBefore = state.stepIndex;
      const previousRenderUrls = getCurrentStepRenderUrls();
      let didChange = hadManualPairingReset;

      await wakeLazyImages(state.root);
      const refreshResult = refreshSourceItemsFromDom();
      applyRefreshedSourceItems(refreshResult.nextSourceItems);
      await hydrateImageMetadata(state.sourceItems);
      await retryMissingItems();

      const layoutChanged = applyRebuiltLayoutIfChanged(anchorIndexBefore);

      if (!layoutChanged) {
        if (didChange) {
          rebuildStepsKeepingAnchor(anchorIndexBefore);
        } else {
          state.stepIndex = Math.max(0, Math.min(stepIndexBefore, state.steps.length - 1));
          state.currentStep = state.steps[state.stepIndex] || state.currentStep;
          if (didCurrentStepRenderUrlsChange(previousRenderUrls)) {
            syncCurrentStepImagesFromSourceItems();
          }
        }
      } else {
        didChange = true;
      }

      renderCurrentStep();
      syncHudTrigger();
      if (didChange || layoutChanged) {
        showEdgeToast("갱신 완료", 2000);
      }
    } finally {
      if (state) {
        state.isRepairRunning = false;
        state.isManualRefreshRunning = false;
        setRefreshButtonState(false);
      }
    }
  }
  // 뷰어에서 디시 이미지를 누락 없이 수집할 수 있도록, 지연 로딩된 본문 이미지를 한 번 깨우는 용도.
  // 페이지 스크롤을 아래로 훑으며 src가 비어 있는 이미지를 채운 뒤 원래 스크롤 위치로 복원한다.
  async function wakeLazyImages(root) {
    if (!root) return;

    const startY = window.scrollY || window.pageYOffset || 0;

    window.scrollTo(0, 0);
    await sleep(LAZY_WAKE_SCROLL_DELAY_MS);

    let y = 0;
    let lastScrollY = -1;
    let stuckCount = 0;

    while (stuckCount < 2) {
      pokeLazyImages(root);
      window.scrollTo(0, y);
      await sleep(LAZY_WAKE_SCROLL_DELAY_MS);

      const currentScrollY = window.scrollY || window.pageYOffset || 0;
      if (currentScrollY <= lastScrollY) {
        stuckCount += 1;
      } else {
        stuckCount = 0;
        lastScrollY = currentScrollY;
      }

      y = currentScrollY + LAZY_WAKE_SCROLL_STEP;
    }

    pokeLazyImages(root);
    window.scrollTo(0, startY);
    pokeLazyImages(root);
  }

  function pokeLazyImages(root) {
    const imgs = Array.from(root.querySelectorAll("img"));
    for (const img of imgs) {
      const dataOriginal = img.getAttribute("data-original");
      const dataSrc = img.getAttribute("data-src");
      if (!img.getAttribute("src") && dataOriginal) {
        img.setAttribute("src", dataOriginal);
      } else if (!img.getAttribute("src") && dataSrc) {
        img.setAttribute("src", dataSrc);
      }
    }
  }

  function clearRepairTimers(targetState) {
    const timers = targetState?.repairTimers || [];
    for (const timer of timers) {
      clearTimeout(timer);
    }
    if (targetState) {
      targetState.repairTimers = [];
    }
  }


  function appendCacheBust(url) {
    if (!url) return url;
    const [base] = String(url).split("#");
    const joiner = base.includes("?") ? "&" : "?";
    return `${base}${joiner}_dcmv=${Date.now()}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isLandscapeLike(width, height) {
    if (!width || !height) return null;
    return width >= height;
  }

  function getStorageArea() {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      return null;
    }

    return chrome.storage.local;
  }

  function loadSettings() {
    return new Promise((resolve) => {
      const storageArea = getStorageArea();
      if (!storageArea) {
        resolve({});
        return;
      }

      storageArea.get(
        [
          STORAGE_KEYS.readingDirectionRTL,
          STORAGE_KEYS.spreadEnabled,
          STORAGE_KEYS.firstPageSingle,
          STORAGE_KEYS.useWasd,
          STORAGE_KEYS.autoFirstPageAdjust
        ],
        (result) => {
          resolve({
            readingDirectionRTL: result[STORAGE_KEYS.readingDirectionRTL],
            spreadEnabled: result[STORAGE_KEYS.spreadEnabled],
            firstPageSingle: result[STORAGE_KEYS.firstPageSingle],
            useWasd: result[STORAGE_KEYS.useWasd],
            autoFirstPageAdjust: result[STORAGE_KEYS.autoFirstPageAdjust]
          });
        }
      );
    });
  }

  function saveSettings(settings) {
    return new Promise((resolve) => {
      const storageArea = getStorageArea();
      if (!storageArea) {
        resolve();
        return;
      }

      storageArea.set(
        {
          [STORAGE_KEYS.readingDirectionRTL]: !!settings.readingDirectionRTL,
          [STORAGE_KEYS.spreadEnabled]: !!settings.spreadEnabled,
          [STORAGE_KEYS.firstPageSingle]: !!settings.firstPageSingle,
          [STORAGE_KEYS.useWasd]:
            settings.useWasd === undefined ? true : !!settings.useWasd,
          [STORAGE_KEYS.autoFirstPageAdjust]:
            settings.autoFirstPageAdjust === undefined
              ? true
              : !!settings.autoFirstPageAdjust
        },
        () => resolve()
      );
    });
  }
})();











