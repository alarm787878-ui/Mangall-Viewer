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
    autoFirstPageAdjust: "autoFirstPageAdjust",
    showImageComments: "showImageComments",
    alwaysShowComments: "alwaysShowComments",
    autoFullscreen: "autoFullscreen",
    forceBelowMode: "forceBelowMode",
    showCornerPageCounter: "showCornerPageCounter"
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
  let globalToastTimer = null;
  const commonUtils = globalThis.__dcmvCommon || {};
  const runtimeModules = globalThis.__dcmvModules || {};
  const siteRegistry = globalThis.__dcmvSiteRegistry || {};
  const VIEWER_DISPLAY_NAME = "만갤 뷰어";
  const CONTENT_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function getCurrentSiteAdapter() {
    return siteRegistry.getSiteAdapterForUrl?.(location.href) || null;
  }

  function callSiteAdapter(methodName, ...args) {
    const adapter = getCurrentSiteAdapter();
    if (adapter && typeof adapter[methodName] === "function") {
      return adapter[methodName](...args);
    }

    return undefined;
  }

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

    const wasAlreadyFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);

    // 만약 툴바나 메뉴를 통해 열린 것이라면, 비동기 로직(openViewer)에 진입하기 전에 
    // 즉시 전체화면을 요청하여 사용자 제스처(Transient Activation) 소실을 방지합니다.
    // 설정에서 자동 전체화면이 꺼져있을 수도 있지만, 일단 요청한 뒤 openViewer 내부에서 
    // 설정값에 따라 유지하거나 해제하는 것이 더 확실한 권한 획득 방법입니다.
    requestViewerDocumentFullscreen();

    openViewer(message, wasAlreadyFullscreen).catch(() => {
      exitViewerDocumentFullscreen();
      showErrorToast(`${VIEWER_DISPLAY_NAME} 실행 중 오류가 발생했습니다.`, 3000);
    });
  });

  document.addEventListener("dcmv:dcinside-comment-expanded", () => {
    if (!state?.isDcinsideSite || !state?.showImageComments) return;
    renderCurrentStep();
    syncHudTrigger();
  });

  document.addEventListener("dcmv:dcinside-comment-layout-updated", () => {
    if (!state?.isDcinsideSite || !state?.showImageComments) return;
    syncHudTrigger();
  });

  function scheduleDcImageCommentRefresh() {
    setTimeout(() => {
      if (!state?.isDcinsideSite || !state?.showImageComments) return;
      renderCurrentStep();
      syncHudTrigger();
    }, 500);
  }

  function requestViewerDocumentFullscreen() {
    // API 호출 전 현재 사용자 활성화(User Activation) 상태인지 확인하여 브라우저의 강제 에러 로그 기록 방지
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      return;
    }

    const el = document.documentElement;
    const req =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen;
    if (typeof req !== "function") return;
    try {
      const result = req.call(el);
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch {
      // no user activation, denied, or unsupported
    }
  }

  function exitViewerDocumentFullscreen() {
    const doc = document;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) return;
    const exit =
      doc.exitFullscreen ||
      doc.webkitExitFullscreen ||
      doc.mozCancelFullScreen ||
      doc.msExitFullscreen;
    if (typeof exit !== "function") return;
    try {
      const result = exit.call(doc);
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  async function openViewer(message = {}, wasAlreadyFullscreen = false) {

    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      closeViewer();
      return;
    }

    const root = runtimeModules.pageLoading?.findContentRoot
      ? runtimeModules.pageLoading.findContentRoot()
      : document.body;
    const settings = runtimeModules.settings?.loadSettings
      ? await runtimeModules.settings.loadSettings(STORAGE_KEYS)
      : {};

    const sourceItems = runtimeModules.pageLoading?.collectSourceItems
      ? runtimeModules.pageLoading.collectSourceItems(root, {
          isInsideExcludedImageCommentArea: (el) =>
            runtimeModules.pageLoading?.isInsideExcludedImageCommentArea
              ? runtimeModules.pageLoading.isInsideExcludedImageCommentArea(el)
              : false,
          isExcludedInlineDcconImage: (el) =>
            runtimeModules.pageLoading?.isExcludedInlineDcconImage
              ? runtimeModules.pageLoading.isExcludedInlineDcconImage(el)
              : false,
          isInsideOpenGraphPreview: (el) =>
            runtimeModules.pageLoading?.isInsideOpenGraphPreview
              ? runtimeModules.pageLoading.isInsideOpenGraphPreview(el)
              : false,
          parseOriginalPopUrlFromTag,
          resolveImageUrlFromTag,
          decodeHtml
        })
      : [];
    const shouldWaitForInitialMetadata = !!(
      runtimeModules.pageLoading?.loadLastReadPosition
        ? runtimeModules.pageLoading.loadLastReadPosition(PAGE_SESSION_KEY)
        : null
    );
    if (!sourceItems.length) {
      exitViewerDocumentFullscreen();
      showErrorToast("본문 영역에서 이미지를 찾지 못했습니다.", 3000);
      return;
    }
    const overlay = runtimeModules.ui?.buildOverlay
      ? runtimeModules.ui.buildOverlay({
          overlayId: OVERLAY_ID
        })
      : (() => {
          throw new Error("viewer-ui.js가 로드되지 않았습니다.");
        })();
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
      settingsCornerCounterButton: overlay.querySelector(
        ".dcmv-settings-corner-counter"
      ),
      settingsCornerCounterSwitch: overlay.querySelector(
        ".dcmv-settings-corner-counter-switch"
      ),
      settingsImageCommentsButton: overlay.querySelector(
        ".dcmv-settings-image-comments"
      ),
      settingsAutoFullscreenButton: overlay.querySelector(
        ".dcmv-settings-auto-fullscreen"
      ),
      settingsManualResetClearButton: overlay.querySelector(
        ".dcmv-settings-manual-reset-clear"
      ),
      edgeToast: overlay.querySelector(".dcmv-edge-toast"),
      cornerPageCounter: overlay.querySelector(".dcmv-corner-page-counter"),
      refreshButton: overlay.querySelector("[data-dcmv-action=\"refresh\"]"),
      fullscreenButton: overlay.querySelector("[data-dcmv-action=\"toggle-fullscreen\"]"),
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
      showImageComments:
        settings.showImageComments === undefined
          ? false
          : !!settings.showImageComments,
      autoFullscreen:
        settings.autoFullscreen === undefined
          ? true
          : !!settings.autoFullscreen,
      alwaysShowComments:
        settings.alwaysShowComments === undefined
          ? true
          : !!settings.alwaysShowComments,
      forceBelowMode:
        settings.forceBelowMode === undefined
          ? false
          : !!settings.forceBelowMode,
      showCornerPageCounter:
        settings.showCornerPageCounter === undefined
          ? false
          : !!settings.showCornerPageCounter,
      isDcinsideSite: getCurrentSiteAdapter()?.id === "dcinside",
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
      dcImageCommentsWereOriginallyOff: false,
      isPointerOverHudZone: false,
      isPagePickerOpen: false,
      isSettingsMenuOpen: false,
      pagePickerSelectedIndex: 0,
      isCursorHidden: false,
      lastPointerX: null,
      lastPointerY: null,
      wasAlreadyFullscreen: wasAlreadyFullscreen,
      repairTimers: [],
      isRepairRunning: false,
      handlers: {},
      requestedTargetUrl: runtimeModules.pageLoading?.normalizeComparableUrl
        ? runtimeModules.pageLoading.normalizeComparableUrl(
            message.targetImageUrl || "",
            {
              normalizeComparableUrl: commonUtils.normalizeComparableUrl,
              locationHref: location.href
            }
          )
        : !message.targetImageUrl
          ? ""
          : String(message.targetImageUrl)
    };

      if (state.isDcinsideSite) {
        state.dcImageCommentsWereOriginallyOff =
          runtimeModules.dcinsideComments?.isImageCommentDisabled?.() ?? false;
        if (state.showImageComments && state.dcImageCommentsWereOriginallyOff) {
          runtimeModules.dcinsideComments?.ensureImageCommentVisibility?.(true);
          scheduleDcImageCommentRefresh();
        }
        // alwaysShowComments 값 전달 및 저장 콜백 설정
        runtimeModules.dcinsideComments?.setAlwaysShowComments?.(state.alwaysShowComments);
        runtimeModules.dcinsideComments?.setSaveAlwaysShowCommentsCallback?.((enabled) => {
          state.alwaysShowComments = !!enabled;
          runtimeModules.settings?.saveSettings?.(STORAGE_KEYS, {
            alwaysShowComments: !!enabled
          });
        });
        // forceBelowMode 값 전달 및 저장 콜백 설정
        runtimeModules.dcinsideComments?.setForceBelowMode?.(state.forceBelowMode);
        runtimeModules.dcinsideComments?.setSaveForceBelowModeCallback?.((enabled) => {
          state.forceBelowMode = !!enabled;
          runtimeModules.settings?.saveSettings?.(STORAGE_KEYS, {
            forceBelowMode: !!enabled
          });
        });
        // 초기 forceBelowMode 적용
        if (state.forceBelowMode) {
          runtimeModules.dcinsideComments?.applyForceBelowModeToAllLayouts?.();
        }
      }

    state.firstSingleCheckbox.checked = state.firstPageSingle;

    // autoFullscreen 설정이 켜져있으면 전체화면 진입
    if (state.autoFullscreen !== false) {
      requestViewerDocumentFullscreen();
    } else if (!wasAlreadyFullscreen) {
      exitViewerDocumentFullscreen();
    }

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

    if (!state.wasAlreadyFullscreen) {
      exitViewerDocumentFullscreen();
    }

    const prevState = state;
    if (prevState.isDcinsideSite && prevState.dcImageCommentsWereOriginallyOff) {
      runtimeModules.dcinsideComments?.ensureImageCommentVisibility?.(false);
    }
    saveLastReadPosition(prevState);
    clearTimeout(prevState.hudHideTimer);
    clearTimeout(prevState.cursorHideTimer);
    clearTimeout(prevState.edgeToastTimer);
    clearRepairTimers(prevState);

    document.removeEventListener("keydown", prevState.handlers.keydown, true);
    document.removeEventListener("mousemove", prevState.handlers.mousemove, true);
    document.removeEventListener(
      "mouseleave",
      prevState.handlers.docMouseleave,
      true
    );
    window.removeEventListener("resize", prevState.handlers.resize, true);
    document.removeEventListener(
      "fullscreenchange",
      prevState.handlers.fullscreenchange,
      true
    );

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
    runtimeModules.navigation?.bindEvents?.(state, {
      getState: () => state,
      closeViewer,
      shouldIgnoreKeydown,
      handlePagePickerKeydown,
      getLogicalNavigationForKey,
      goNext,
      goPrev,
      isPointerInsideHudTrigger,
      updateHudHoverState,
      showCursor,
      hasPointerMovedSignificantly,
      rememberPointerPosition,
      scheduleCursorHide,
      syncHudTrigger,
      syncImageLoadingBarPosition,
      refreshCurrentStepRenderBoxes: () =>
        runtimeModules.layout?.refreshCurrentStepRenderBoxes?.(state),
      togglePagePicker,
      toggleSettingsMenu,
      getLogicalNavigationForOverlayButton,
      runManualRefresh,
      getCurrentAnchorIndex,
      syncToggleVisuals,
      saveSettings: (settings) =>
        runtimeModules.settings?.saveSettings
          ? runtimeModules.settings.saveSettings(STORAGE_KEYS, settings)
          : Promise.resolve(),
      getSettingsSnapshot: () => ({
        readingDirectionRTL: state.readingDirectionRTL,
        spreadEnabled: state.spreadEnabled,
        firstPageSingle: state.firstPageSingle,
        useWasd: state.useWasd,
        autoFirstPageAdjust: state.autoFirstPageAdjust,
        showImageComments: state.showImageComments,
        alwaysShowComments: state.alwaysShowComments,
        autoFullscreen: state.autoFullscreen,
        forceBelowMode: state.forceBelowMode
      }),
      requestFullscreen: requestViewerDocumentFullscreen,
      exitFullscreen: exitViewerDocumentFullscreen,
      rebuildStepsKeepingAnchor,
      renderCurrentStep,
      updateCornerPageCounter,
      saveManualPairingResetIndices,
      syncManualResetClearVisibility,
      showEdgeToast,
      clearSavedManualPairingResetIndices,
      goToPageIndex,
      getLogicalNavigationForViewportSide,
      syncDcImageCommentsForViewer
    });
  }

  function setRefreshButtonState(isRunning) {
    if (runtimeModules.ui?.setRefreshButtonState) {
      runtimeModules.ui.setRefreshButtonState(state, isRunning);
    }
  }

  function syncToggleVisuals() {
    runtimeModules.settings?.syncToggleVisuals?.(state, {
      toggleActiveClass: TOGGLE_ACTIVE_CLASS,
      syncManualResetClearVisibility,
      syncNavButtonLabels
    });
  }

  function syncManualResetClearVisibility() {
    runtimeModules.settings?.syncManualResetClearVisibility?.(state);
  }

  function syncNavButtonLabels() {
    runtimeModules.settings?.syncNavButtonLabels?.(state);
  }

  function togglePagePicker(forceOpen) {
    runtimeModules.navigation?.togglePagePicker?.(state, forceOpen, {
      hudVisibleClass: HUD_VISIBLE_CLASS,
      toggleSettingsMenu,
      getCurrentDisplayPageIndex,
      renderPagePicker,
      scrollCurrentPagePickerItemIntoView
    });
  }

  function toggleSettingsMenu(forceOpen) {
    runtimeModules.navigation?.toggleSettingsMenu?.(state, forceOpen, {
      hudVisibleClass: HUD_VISIBLE_CLASS,
      syncManualResetClearVisibility,
      togglePagePicker,
      refreshHudPointerState
    });
  }

  function renderPagePicker() {
    runtimeModules.navigation?.renderPagePicker?.(state, {
      getCurrentDisplayPageIndex
    });
  }

  function scrollCurrentPagePickerItemIntoView() {
    runtimeModules.navigation?.scrollCurrentPagePickerItemIntoView?.(state);
  }

  function handlePagePickerKeydown(e) {
    return runtimeModules.navigation?.handlePagePickerKeydown?.(state, e, {
      renderPagePicker,
      scrollCurrentPagePickerItemIntoView,
      goToPageIndex
    }) ?? false;
  }

  function getCurrentDisplayPageIndex() {
    if (!state?.currentStep?.images?.length) return 0;

    return getPrimaryAnchorItem(state)?.index ?? 0;
  }

  function syncHudTrigger() {
    runtimeModules.hud?.syncHudTrigger?.(state, {
      hudVisibleClass: HUD_VISIBLE_CLASS,
      hudTriggerMarginX: HUD_TRIGGER_MARGIN_X,
      hudTriggerMarginY: HUD_TRIGGER_MARGIN_Y,
      isPointerInsideHudTrigger
    });
  }

  function isPointerInsideHudTrigger(x, y) {
    return runtimeModules.hud?.isPointerInsideHudTrigger?.(state, x, y) ?? false;
  }

  function syncHudVisibility() {
    runtimeModules.hud?.syncHudVisibility?.(state, {
      hudVisibleClass: HUD_VISIBLE_CLASS
    });
  }

  function updateHudHoverState(nextInside, options = {}) {
    runtimeModules.hud?.updateHudHoverState?.(state, nextInside, {
      syncHudVisibility
    });
  }

  function refreshHudPointerState() {
    return runtimeModules.hud?.refreshHudPointerState?.(state, {
      syncHudVisibility,
      isPointerInsideHudTrigger,
      updateHudHoverState
    }) ?? false;
  }

  function scheduleHudHide() {
    runtimeModules.hud?.scheduleHudHide?.(state, {
      refreshHudPointerState
    });
  }

  function showHudTemporarily() {
    runtimeModules.hud?.showHudTemporarily?.(state, {
      hudVisibleClass: HUD_VISIBLE_CLASS
    });
  }

  function showEdgeToast(message, durationMs = EDGE_TOAST_DURATION_MS, options = {}) {
    runtimeModules.hud?.showEdgeToast?.(state, message, durationMs, options);
  }

  function showGlobalToast(message, durationMs = 3000, options = {}) {
    let toast = document.getElementById("dcmv-global-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "dcmv-global-toast";
      toast.className = "dcmv-edge-toast";
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }

    clearTimeout(globalToastTimer);
    toast.textContent = message;
    toast.classList.toggle("dcmv-edge-toast-error", !!options.isError);
    toast.classList.add("dcmv-edge-toast-visible");

    globalToastTimer = setTimeout(() => {
      const liveToast = document.getElementById("dcmv-global-toast");
      if (!liveToast) return;
      liveToast.classList.remove("dcmv-edge-toast-visible");
      setTimeout(() => {
        const nextLiveToast = document.getElementById("dcmv-global-toast");
        if (!nextLiveToast) return;
        nextLiveToast.classList.remove("dcmv-edge-toast-error");
      }, 200);
    }, durationMs);
  }

  function showErrorToast(message, durationMs = 3000) {
    if (state?.edgeToast) {
      showEdgeToast(message, durationMs, { isError: true });
      return;
    }

    showGlobalToast(message, durationMs, { isError: true });
  }

  function scheduleCursorHide() {
    runtimeModules.hud?.scheduleCursorHide?.(state, {
      cursorHideDelayMs: CURSOR_HIDE_DELAY_MS,
      hideCursor
    });
  }

  function showCursor() {
    runtimeModules.hud?.showCursor?.(state, {
      cursorHiddenClass: CURSOR_HIDDEN_CLASS
    });
  }

  function hideCursor() {
    runtimeModules.hud?.hideCursor?.(state, {
      cursorHiddenClass: CURSOR_HIDDEN_CLASS
    });
  }

  function rememberPointerPosition(x, y) {
    runtimeModules.hud?.rememberPointerPosition?.(state, x, y);
  }

  function hasPointerMovedSignificantly(x, y) {
    return runtimeModules.hud?.hasPointerMovedSignificantly?.(state, x, y, {
      cursorMoveThresholdPx: CURSOR_MOVE_THRESHOLD_PX
    }) ?? false;
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

    const savedPosition = runtimeModules.pageLoading?.loadLastReadPosition
      ? runtimeModules.pageLoading.loadLastReadPosition(PAGE_SESSION_KEY)
      : null;
    if (!savedPosition) return 0;

    const savedIndex = Number(savedPosition.index);

    if (Number.isInteger(savedIndex)) {
      return Math.max(0, Math.min(savedIndex, state.sourceItems.length - 1));
    }

    return 0;
  }

  function rebuildStepsKeepingAnchor(anchorIndex) {
    runtimeModules.layout?.rebuildStepsKeepingAnchor?.(state, anchorIndex, {
      buildAllSteps
    });
  }
  function getStepSignature(step) {
    return runtimeModules.layout?.getStepSignature?.(step) ?? "";
  }

  function getStepsSignature(steps) {
    return runtimeModules.layout?.getStepsSignature?.(steps, {
      getStepSignature
    }) ?? "";
  }

  function findStepIndexForAnchorInSteps(steps, anchorIndex) {
    return runtimeModules.layout?.findStepIndexForAnchorInSteps?.(steps, anchorIndex) ?? 0;
  }

  function applyRebuiltLayoutIfChanged(anchorIndex) {
    return runtimeModules.layout?.applyRebuiltLayoutIfChanged?.(state, anchorIndex, {
      buildAllSteps,
      findStepIndexForAnchorInSteps,
      getStepsSignature,
      getStepSignature
    }) ?? false;
  }


  function buildStepsForSegment(
    items,
    firstPageSingleOverride,
    segmentStartIndex = 0
  ) {
    return runtimeModules.layout?.buildStepsForSegment?.(
      items,
      firstPageSingleOverride,
      segmentStartIndex,
      {
        makeSingleStep,
        isLandscape,
        shouldTreatEarlyPortraitAsSingle
      }
    ) ?? [];
  }

  function buildAllSteps(
    firstPageSingleOverride = state.firstPageSingle,
    itemsOverride = state.sourceItems
  ) {
    return runtimeModules.layout?.buildAllSteps?.(
      state,
      firstPageSingleOverride,
      itemsOverride,
      {
        makeSingleStep,
        buildStepsForSegment
      }
    ) ?? [];
  }

  function chooseInitialFirstPageSinglePreference(preferredValue, options = {}) {
    return runtimeModules.settings?.chooseInitialFirstPageSinglePreference?.(
      state,
      preferredValue,
      options,
      {
        isDcPlaceholderSize,
        isLandscape,
        buildAllSteps,
        countLandscapeAdjacentSinglePortraitSteps
      }
    ) ?? preferredValue;
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
    return runtimeModules.settings?.getCurrentPageKey?.() ?? "";
  }

  function loadSavedReopenedViewerPageKey() {
    return runtimeModules.settings?.loadSavedReopenedViewerPageKey?.(
      REOPENED_VIEWER_PAGE_SESSION_KEY
    ) ?? "";
  }

  function hasReopenedViewerPageKey(pageKey = getCurrentPageKey()) {
    return runtimeModules.settings?.hasReopenedViewerPageKey?.(
      reopenedViewerPageKey,
      pageKey,
      {
        loadSavedReopenedViewerPageKey
      }
    ) ?? false;
  }

  function rememberReopenedViewerPageKey(pageKey = getCurrentPageKey()) {
    runtimeModules.settings?.rememberReopenedViewerPageKey?.(pageKey, {
      reopenedViewerPageSessionKey: REOPENED_VIEWER_PAGE_SESSION_KEY,
      setReopenedViewerPageKey: (value) => {
        reopenedViewerPageKey = value;
      }
    });
  }

  function loadSavedManualPairingResetIndices() {
    return runtimeModules.settings?.loadSavedManualPairingResetIndices?.(
      getCurrentPageKey(),
      MANUAL_PAIRING_RESET_SESSION_KEY
    ) ?? null;
  }

  function saveManualPairingResetIndices(indices) {
    runtimeModules.settings?.saveManualPairingResetIndices?.(
      getCurrentPageKey(),
      MANUAL_PAIRING_RESET_SESSION_KEY,
      indices
    );
  }

  function clearSavedManualPairingResetIndices() {
    runtimeModules.settings?.clearSavedManualPairingResetIndices?.(
      state,
      MANUAL_PAIRING_RESET_SESSION_KEY
    );
  }

  function loadAutoFirstPageSingleSession() {
    return runtimeModules.settings?.loadAutoFirstPageSingleSession?.(
      FIRST_PAGE_AUTO_SESSION_KEY
    ) ?? null;
  }

  function loadSavedAutoFirstPageSingleValue() {
    return runtimeModules.settings?.loadSavedAutoFirstPageSingleValue?.(
      getCurrentPageKey(),
      {
        loadAutoFirstPageSingleSession
      }
    ) ?? null;
  }

  function shouldApplyInitialFirstPageSingleAuto() {
    return runtimeModules.settings?.shouldApplyInitialFirstPageSingleAuto?.(
      getCurrentPageKey(),
      {
        loadAutoFirstPageSingleSession
      }
    ) ?? true;
  }

  function saveAutoAdjustedFirstPageSingleValue(value) {
    runtimeModules.settings?.saveAutoAdjustedFirstPageSingleValue?.(
      getCurrentPageKey(),
      FIRST_PAGE_AUTO_SESSION_KEY,
      value
    );
  }

  function applyInitialFirstPageSingleAuto(preferredValue) {
    return runtimeModules.settings?.applyInitialFirstPageSingleAuto?.(state, preferredValue, {
      shouldApplyInitialFirstPageSingleAuto,
      initialAutoEvalPageLimit: INITIAL_AUTO_EVAL_PAGE_LIMIT,
      chooseInitialFirstPageSinglePreference,
      saveAutoAdjustedFirstPageSingleValue
    }) ?? false;
  }

  function syncKnownDimensionsFromDom() {
    runtimeModules.pageLoading?.syncKnownDimensionsFromDom?.(state, {
      refreshSourceItemsFromDom
    });
  }

  async function waitForAllPagesReadyBeforeSecondPass(maxWaitMs = 2000) {
    await runtimeModules.pageLoading?.waitForAllPagesReadyBeforeSecondPass?.(state, maxWaitMs, {
      getState: () => state,
      syncKnownDimensionsFromDom,
      hasUsableImageMetadata
    });
  }

  async function ensureInitialAutoMetadataWindow() {
    await runtimeModules.pageLoading?.ensureInitialAutoMetadataWindow?.(state, {
      getState: () => state,
      initialAutoRequiredKnownPages: INITIAL_AUTO_REQUIRED_KNOWN_PAGES,
      isDcPlaceholderSize,
      loadImageMetadata
    });
  }

  async function runInitialAutoWhenReady(reason) {
    await runtimeModules.pageLoading?.runInitialAutoWhenReady?.(state, reason, {
      initialAutoEvalPageLimit: INITIAL_AUTO_EVAL_PAGE_LIMIT,
      initialAutoRequiredKnownPages: INITIAL_AUTO_REQUIRED_KNOWN_PAGES,
      isDcPlaceholderSize,
      ensureInitialAutoMetadataWindow,
      syncKnownDimensionsFromDom,
      applyInitialFirstPageSingleAuto,
      syncToggleVisuals,
      rebuildStepsKeepingAnchor,
      getCurrentAnchorIndex,
      renderCurrentStep,
      syncHudTrigger,
      presentInitialViewerAfterInitialAuto
    });
  }

  async function presentInitialViewerAfterInitialAuto(didChange) {
    await runtimeModules.pageLoading?.presentInitialViewerAfterInitialAuto?.(state, didChange, {
      getState: () => state,
      sleep,
      setImageLoadingProgress,
      showHudTemporarily,
      showEdgeToast
    });
  }

  function countLandscapeAdjacentSinglePortraitSteps(
    steps,
    sourceItems = state?.sourceItems || []
  ) {
    return runtimeModules.settings?.countLandscapeAdjacentSinglePortraitSteps?.(
      steps,
      sourceItems,
      {
        getLeadingBoundaryExclusionIndex,
        isLandscape
      }
    ) ?? 0;
  }

  function getLeadingBoundaryExclusionIndex(items = state?.sourceItems || []) {
    return runtimeModules.settings?.getLeadingBoundaryExclusionIndex?.(items, {
      isLandscape
    }) ?? 0;
  }

  function makeSingleStep(startIndex, item) {
    return runtimeModules.layout?.makeSingleStep?.(startIndex, item) ?? null;
  }

  function goNext(force = false) {
    runtimeModules.navigation?.goNext?.(state, force, {
      canNavigate,
      showEdgeToast,
      edgeToastCooldownAttempts: EDGE_TOAST_COOLDOWN_ATTEMPTS,
      renderCurrentStep,
      syncHudTrigger,
      saveLastReadPosition
    });
  }

  function goPrev(force = false) {
    runtimeModules.navigation?.goPrev?.(state, force, {
      canNavigate,
      renderCurrentStep,
      syncHudTrigger,
      saveLastReadPosition
    });
  }

  function goToPageIndex(pageIndex, options = {}) {
    runtimeModules.navigation?.goToPageIndex?.(state, pageIndex, options, {
      navThrottleMs: NAV_THROTTLE_MS,
      getState: () => state,
      rebuildStepsKeepingAnchor,
      renderCurrentStep,
      togglePagePicker,
      saveLastReadPosition
    });
  }

  function renderCurrentStep() {
    runtimeModules.layout?.renderCurrentStep?.(state, {
      getState: () => state,
      handleViewerImageError,
      syncImageLoadingBarPosition,
      runInitialAutoWhenReady,
      renderPageCounter,
      syncManualResetClearVisibility,
      preloadNearbySteps,
      refreshViewerStepLayout: () => {
        runtimeModules.layout?.refreshCurrentStepRenderBoxes?.(state);
        globalThis.__dcmvDcinsideComments?.updateAllCommentLayouts?.();
      }
    });
    updateCornerPageCounter();
  }

  function updateCornerPageCounter() {
    if (!state?.cornerPageCounter) return;

    if (!state.showCornerPageCounter) {
      state.cornerPageCounter.classList.remove("dcmv-corner-counter-visible");
      return;
    }

    const step = state.currentStep;
    const total = state.totalCount || 0;
    let pageText;

    if (!step?.images?.length) {
      pageText = `0 / ${total}`;
    } else if (step.images.length === 1) {
      pageText = `${step.images[0].displayIndex} / ${total}`;
    } else {
      pageText = `${step.images[0].displayIndex}, ${step.images[1].displayIndex} / ${total}`;
    }

    state.cornerPageCounter.textContent = pageText;
    state.cornerPageCounter.classList.add("dcmv-corner-counter-visible");
  }

  function renderPageCounter(step) {
    runtimeModules.layout?.renderPageCounter?.(state, step, {
      renderPagePicker
    });
  }

  function preloadNearbySteps() {
    runtimeModules.layout?.preloadNearbySteps?.(state);
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
    return commonUtils.getPortraitRatio
      ? commonUtils.getPortraitRatio(item)
      : !item?.width || !item?.height
        ? 0
        : item.height / item.width;
  }

  function getMedian(values) {
    return commonUtils.getMedian ? commonUtils.getMedian(values) : 0;
  }

  function getPrimaryAnchorItem(targetState = state) {
    return runtimeModules.pageLoading?.getPrimaryAnchorItem
      ? runtimeModules.pageLoading.getPrimaryAnchorItem(targetState)
      : null;
  }
  function getComparableUrlsForItem(item) {
    return runtimeModules.pageLoading?.getComparableUrlsForItem
      ? runtimeModules.pageLoading.getComparableUrlsForItem(item, {
          normalizeComparableUrl: (url) =>
            runtimeModules.pageLoading?.normalizeComparableUrl
              ? runtimeModules.pageLoading.normalizeComparableUrl(url, {
                  normalizeComparableUrl: commonUtils.normalizeComparableUrl,
                  locationHref: location.href
                })
              : !url
                ? ""
                : String(url)
        })
      : [];
  }

  function findSourceItemIndexByUrl(targetUrl) {
    return runtimeModules.pageLoading?.findSourceItemIndexByUrl
      ? runtimeModules.pageLoading.findSourceItemIndexByUrl(targetUrl, {
          state,
          getComparableUrlsForItem
        })
      : -1;
  }

  function getStableItemKey(item) {
    return runtimeModules.pageLoading?.getStableItemKey
      ? runtimeModules.pageLoading.getStableItemKey(item, {
          getComparableUrlsForItem
        })
      : "";
  }

  function saveLastReadPosition(targetState = state) {
    if (runtimeModules.pageLoading?.saveLastReadPosition) {
      runtimeModules.pageLoading.saveLastReadPosition(targetState, {
        pageSessionKey: PAGE_SESSION_KEY,
        getSavedImageIndex
      });
    }
  }

  function shouldIgnoreKeydown(e) {
    return runtimeModules.navigation?.shouldIgnoreKeydown?.(e) ?? false;
  }

  function getLogicalNavigationForKey(e) {
    return runtimeModules.navigation?.getLogicalNavigationForKey?.(state, e) ?? null;
  }

  function getLogicalNavigationForViewportSide(clientX, options = {}) {
    return (
      runtimeModules.navigation?.getLogicalNavigationForViewportSide?.(
        state,
        clientX,
        options,
        {
          getViewportClickDeadZoneWidth
        }
      ) ?? null
    );
  }
  function getViewportClickDeadZoneWidth() {
    return runtimeModules.navigation?.getViewportClickDeadZoneWidth?.(state, {
      clickDeadZoneRatio: CLICK_DEAD_ZONE_RATIO,
      clickDeadZoneMinPx: CLICK_DEAD_ZONE_MIN_PX,
      clickDeadZoneMaxPx: CLICK_DEAD_ZONE_MAX_PX,
      singlePortraitDeadZoneScale: SINGLE_PORTRAIT_DEAD_ZONE_SCALE,
      isSinglePortraitStep
    }) ?? 0;
  }

  function isSinglePortraitStep() {
    if (!state?.currentStep?.images?.length) return false;
    if (state.currentStep.displayType !== "single") return false;

    const item = state.currentStep.images[0];
    return !!item && !isLandscape(item);
  }

  function getLogicalNavigationForOverlayButton(action) {
    return runtimeModules.navigation?.getLogicalNavigationForOverlayButton?.(state, action) ?? null;
  }

  async function hydrateImageMetadata(items, options = {}) {
    return runtimeModules.pageLoading?.hydrateImageMetadata
      ? runtimeModules.pageLoading.hydrateImageMetadata(items, options, {
          imageMetadataBatchSize: IMAGE_METADATA_BATCH_SIZE,
          loadImageMetadata,
          isLandscapeLike,
          convertPopUrlToDirectImageUrl,
          imageMetadataTimeoutMs: IMAGE_METADATA_TIMEOUT_MS
        })
      : { orientationChangedPages: [] };
  }

  function loadImageMetadata(item, options = {}) {
    return runtimeModules.pageLoading?.loadImageMetadata
      ? runtimeModules.pageLoading.loadImageMetadata(item, options, {
          isLandscapeLike,
          convertPopUrlToDirectImageUrl,
          imageMetadataTimeoutMs: IMAGE_METADATA_TIMEOUT_MS
        })
      : Promise.resolve();
  }

  function findElementForSourceItem(root, targetItem) {
    return runtimeModules.pageLoading?.findElementForSourceItem
      ? runtimeModules.pageLoading.findElementForSourceItem(root, targetItem, {
          decodeHtml,
          parseOriginalPopUrlFromTag
        })
      : null;
  }

  function estimateRenderedImageHeight(root, item, contentWidth) {
    return runtimeModules.pageLoading?.estimateRenderedImageHeight
      ? runtimeModules.pageLoading.estimateRenderedImageHeight(root, item, contentWidth, {
          getActualRenderedHeightForItem
        })
      : 0;
  }

  function getActualRenderedHeightForItem(root, item) {
    return runtimeModules.pageLoading?.getActualRenderedHeightForItem
      ? runtimeModules.pageLoading.getActualRenderedHeightForItem(root, item, {
          findElementForSourceItem
        })
      : null;
  }

  function estimateScrollTopForImageIndex(root, sourceItems, targetIndex) {
    return runtimeModules.pageLoading?.estimateScrollTopForImageIndex
      ? runtimeModules.pageLoading.estimateScrollTopForImageIndex(root, sourceItems, targetIndex, {
          estimateRenderedImageHeight
        })
      : null;
  }

  function convertPopUrlToDirectImageUrl(popUrl) {
    return callSiteAdapter("convertPopUrlToDirectImageUrl", popUrl) ?? (popUrl || "");
  }

  function parseOriginalPopUrlFromTag(tag) {
    return (
      callSiteAdapter("parseOriginalPopUrlFromTag", tag, {
        decodeHtml,
        parseAttr
      }) ?? ""
    );
  }

  function resolveImageUrlFromTag(tag) {
    return (
      callSiteAdapter("resolveImageUrlFromTag", tag, {
        decodeHtml,
        parseAttr
      }) ||
      decodeHtml(parseAttr(tag, "data-original")) ||
      decodeHtml(parseAttr(tag, "data-src")) ||
      decodeHtml(parseAttr(tag, "src")) ||
      ""
    );
  }

  function parseAttr(tag, attrName) {
    const regex = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, "i");
    const match = tag.match(regex);
    return match ? match[1] : "";
  }

  function decodeHtml(str) {
    if (!str || !str.includes("&")) return str;

    const parser = new DOMParser();
    const doc = parser.parseFromString(str, "text/html");
    return doc.documentElement.textContent || "";
  }

  function syncDcImageCommentsForViewer() {
    if (!state?.isDcinsideSite) return;
    if (!state.dcImageCommentsWereOriginallyOff) return;
    const shouldShow = !!state.showImageComments;
    const wasDisabled =
      runtimeModules.dcinsideComments?.isImageCommentDisabled?.() ?? false;
    runtimeModules.dcinsideComments?.ensureImageCommentVisibility?.(
      shouldShow
    );
    if (shouldShow && wasDisabled) {
      scheduleDcImageCommentRefresh();
    }
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
    return runtimeModules.pageLoading?.refreshSourceItemsFromDom
      ? runtimeModules.pageLoading.refreshSourceItemsFromDom(state, {
          getStableItemKey,
          collectSourceItems: (root) =>
            runtimeModules.pageLoading?.collectSourceItems
              ? runtimeModules.pageLoading.collectSourceItems(root, {
                  isInsideExcludedImageCommentArea: (el) =>
                    runtimeModules.pageLoading?.isInsideExcludedImageCommentArea
                      ? runtimeModules.pageLoading.isInsideExcludedImageCommentArea(el)
                      : false,
                  isExcludedInlineDcconImage: (el) =>
                    runtimeModules.pageLoading?.isExcludedInlineDcconImage
                      ? runtimeModules.pageLoading.isExcludedInlineDcconImage(el)
                      : false,
                  isInsideOpenGraphPreview: (el) =>
                    runtimeModules.pageLoading?.isInsideOpenGraphPreview
                      ? runtimeModules.pageLoading.isInsideOpenGraphPreview(el)
                      : false,
                  parseOriginalPopUrlFromTag,
                  resolveImageUrlFromTag,
                  decodeHtml
                })
              : []
        })
      : { nextSourceItems: [], countChanged: false };
  }

  function applyRefreshedSourceItems(nextSourceItems) {
    runtimeModules.pageLoading?.applyRefreshedSourceItems?.(state, nextSourceItems);
  }

  async function retryMissingItems() {
    return runtimeModules.pageLoading?.retryMissingItems
      ? runtimeModules.pageLoading.retryMissingItems(state, {
          retrySourceItem
        })
      : { orientationChangedPages: [] };
  }

  async function retrySourceItem(item) {
    return runtimeModules.pageLoading?.retrySourceItem
      ? runtimeModules.pageLoading.retrySourceItem(item, {
          appendCacheBust,
          loadImageMetadata
        })
      : undefined;
  }

  function getPrimaryVisiblePageIndex() {
    return runtimeModules.layout?.getPrimaryVisiblePageIndex?.(state) ?? 0;
  }

  function getCurrentStepRenderUrls(targetState = state) {
    return runtimeModules.layout?.getCurrentStepRenderUrls?.(targetState) ?? [];
  }

  function syncCurrentStepImagesFromSourceItems() {
    runtimeModules.layout?.syncCurrentStepImagesFromSourceItems?.(state);
  }

  function didCurrentStepRenderUrlsChange(previousUrls) {
    return runtimeModules.layout?.didCurrentStepRenderUrlsChange?.(state, previousUrls) ?? false;
  }

  function scheduleInitialPostLazyRefresh() {
    runtimeModules.pageLoading?.scheduleInitialPostLazyRefresh?.(state, {
      runInitialLazyRepair
    });
  }

  async function runInitialLazyRepair() {
    await runtimeModules.pageLoading?.runInitialLazyRepair?.(state, {
      getState: () => state,
      setImageLoadingProgress,
      wakeLazyImages,
      setHasAutoLazyWakeRun: (value) => {
        hasAutoLazyWakeRunInThisTabPage = value;
      },
      runInitialAutoWhenReady,
      waitForAllPagesReadyBeforeSecondPass,
      initialPostLazyRefreshRound
    });
  }

  async function initialPostLazyRefreshRound() {
    await runtimeModules.pageLoading?.initialPostLazyRefreshRound?.(state, {
      refreshSourceItemsFromDom,
      getCurrentAnchorIndex,
      getCurrentStepRenderUrls,
      applyRefreshedSourceItems,
      hydrateImageMetadata,
      retryMissingItems,
      chooseInitialFirstPageSinglePreference,
      saveAutoAdjustedFirstPageSingleValue,
      showEdgeToast,
      syncToggleVisuals,
      applyRebuiltLayoutIfChanged,
      didCurrentStepRenderUrlsChange,
      syncCurrentStepImagesFromSourceItems,
      renderCurrentStep,
      syncHudTrigger,
      setImageLoadingProgress
    });
  }
  function rebuildStepsForOrientationChange(primaryPageIndex) {
    runtimeModules.layout?.rebuildStepsForOrientationChange?.(state, primaryPageIndex, {
      buildAllSteps
    });
  }

  function scheduleBackgroundRepair() {
    runtimeModules.pageLoading?.scheduleBackgroundRepair?.(state, {
      repairMaxRounds: REPAIR_MAX_ROUNDS,
      repairInitialDelayMs: REPAIR_INITIAL_DELAY_MS,
      repairIntervalMs: REPAIR_INTERVAL_MS,
      clearRepairTimers,
      backgroundRepairRound
    });
  }

  async function backgroundRepairRound() {
    await runtimeModules.pageLoading?.backgroundRepairRound?.(state, {
      getState: () => state,
      getCurrentAnchorIndex,
      getCurrentStepRenderUrls,
      getHasAutoLazyWakeRun: () => hasAutoLazyWakeRunInThisTabPage,
      setHasAutoLazyWakeRun: (value) => {
        hasAutoLazyWakeRunInThisTabPage = value;
      },
      wakeLazyImages,
      refreshSourceItemsFromDom,
      applyRefreshedSourceItems,
      hydrateImageMetadata,
      retryMissingItems,
      applyRebuiltLayoutIfChanged,
      didCurrentStepRenderUrlsChange,
      syncCurrentStepImagesFromSourceItems,
      renderCurrentStep,
      syncHudTrigger
    });
  }
  async function runManualRefresh() {
    await runtimeModules.pageLoading?.runManualRefresh?.(state, {
      getState: () => state,
      clearSavedManualPairingResetIndices,
      setRefreshButtonState,
      getCurrentAnchorIndex,
      getCurrentStepRenderUrls,
      wakeLazyImages,
      refreshSourceItemsFromDom,
      applyRefreshedSourceItems,
      hydrateImageMetadata,
      retryMissingItems,
      applyRebuiltLayoutIfChanged,
      rebuildStepsKeepingAnchor,
      didCurrentStepRenderUrlsChange,
      syncCurrentStepImagesFromSourceItems,
      renderCurrentStep,
      syncHudTrigger,
      showEdgeToast
    });
  }
  // 뷰어에서 디시 이미지를 누락 없이 수집할 수 있도록, 지연 로딩된 본문 이미지를 한 번 깨우는 용도.
  // 페이지 스크롤을 아래로 훑으며 src가 비어 있는 이미지를 채운 뒤 원래 스크롤 위치로 복원한다.
  async function wakeLazyImages(root) {
    if (runtimeModules.pageLoading?.wakeLazyImages) {
      await runtimeModules.pageLoading.wakeLazyImages(root, {
        lazyWakeScrollDelayMs: LAZY_WAKE_SCROLL_DELAY_MS,
        lazyWakeScrollStep: LAZY_WAKE_SCROLL_STEP,
        pokeLazyImages,
        sleep
      });
    }
  }

  function pokeLazyImages(root) {
    runtimeModules.pageLoading?.pokeLazyImages?.(root);
  }

  function clearRepairTimers(targetState) {
    runtimeModules.pageLoading?.clearRepairTimers?.(targetState);
  }


  function appendCacheBust(url) {
    return commonUtils.appendCacheBust
      ? commonUtils.appendCacheBust(url)
      : url;
  }

  function sleep(ms) {
    return runtimeModules.pageLoading?.sleep?.(ms) ?? Promise.resolve();
  }

  function isLandscapeLike(width, height) {
    return commonUtils.isLandscapeLike
      ? commonUtils.isLandscapeLike(width, height)
      : null;
  }

})();
