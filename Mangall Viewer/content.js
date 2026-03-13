(() => {
  const OVERLAY_ID = "dcmv-overlay";
  const LOCK_CLASS = "dcmv-lock-scroll";
  const HUD_VISIBLE_CLASS = "dcmv-hud-visible";
  const TOGGLE_ACTIVE_CLASS = "dcmv-toggle-active";

  const STORAGE_KEYS = {
    readingDirectionRTL: "readingDirectionRTL",
    spreadEnabled: "spreadEnabled",
    firstPageSingle: "firstPageSingle"
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

  let state = null;
  let hasAutoLazyWakeRunInThisTabPage = false;

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "DCMV_OPEN") return;

    openViewer().catch((err) => {
      console.error("[Mangall Viewer]", err);
      alert("만화 보기 실행 중 오류가 발생했습니다.");
    });
  });

  async function openViewer() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      closeViewer();
      return;
    }

    const root = findContentRoot();
    const sourceItems = collectSourceItems(root);

    if (!sourceItems.length) {
      alert("원본 팝업 주소를 가진 이미지를 찾지 못했습니다.");
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
      hud: overlay.querySelector(".dcmv-hud"),
      hudTrigger: overlay.querySelector(".dcmv-hud-trigger"),
      pageCounter: overlay.querySelector(".dcmv-page-counter"),
      refreshButton: overlay.querySelector("[data-dcmv-action=\"refresh\"]"),

      spreadCheckbox: overlay.querySelector(".dcmv-spread-checkbox"),
      firstSingleCheckbox: overlay.querySelector(".dcmv-first-single-checkbox"),
      rtlCheckbox: overlay.querySelector(".dcmv-rtl-checkbox"),

      spreadToggle: overlay.querySelector(".dcmv-toggle-spread"),
      firstSingleToggle: overlay.querySelector(".dcmv-toggle-first-single"),
      rtlToggle: overlay.querySelector(".dcmv-toggle-rtl"),

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

      steps: [],
      stepIndex: 0,
      currentStep: null,

      navLockedUntil: 0,
      hudHideTimer: null,
      isPointerOverHudZone: false,
      repairTimers: [],
      isRepairRunning: false,
      handlers: {}
    };

    state.spreadCheckbox.checked = state.spreadEnabled;
    state.firstSingleCheckbox.checked = state.firstPageSingle;
    state.rtlCheckbox.checked = state.readingDirectionRTL;

    syncToggleVisuals();
    bindEvents();

    await hydrateImageMetadata(state.sourceItems);
    rebuildStepsKeepingAnchor(0);
    renderCurrentStep();
    syncHudTrigger();
    showHudTemporarily();
  }

  function closeViewer() {
    if (!state) return;

    const prevState = state;

    clearTimeout(prevState.hudHideTimer);
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

      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
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

      e.preventDefault();

      if (Math.abs(e.deltaY) < 4) return;

      if (e.deltaY > 0) goNext();
      else goPrev();
    };

    const mousemove = (e) => {
      if (!state) return;

      const inside = isPointerInsideHudTrigger(e.clientX, e.clientY);
      state.isPointerOverHudZone = inside;

      if (inside) {
        state.hud.classList.add(HUD_VISIBLE_CLASS);
        clearTimeout(state.hudHideTimer);
      } else {
        scheduleHudHide();
      }
    };

    const docMouseleave = () => {
      if (!state) return;
      state.isPointerOverHudZone = false;
      scheduleHudHide();
    };

    const resize = () => {
      if (!state) return;
      syncHudTrigger();
    };

    const click = (e) => {
      if (!state) return;
      if (!(e.target instanceof Element)) return;

      const actionEl = e.target.closest("[data-dcmv-action]");
      if (!actionEl) return;

      const action = actionEl.getAttribute("data-dcmv-action");

      if (action === "prev") {
        goPrev(true);
      } else if (action === "next") {
        goNext(true);
      } else if (action === "refresh") {
        runManualRefresh().catch((err) => {
          console.error("[Mangall Viewer] manual refresh failed", err);
        });
      } else if (action === "close") {
        closeViewer();
      }
    };

    state.handlers = {
      keydown,
      keyup,
      winKeydown: escHandler,
      wheel,
      mousemove,
      docMouseleave,
      resize,
      click
    };

    document.addEventListener("keydown", keydown, true);
    document.addEventListener("keyup", keyup, true);
    window.addEventListener("keydown", escHandler, true);
    document.addEventListener("mousemove", mousemove, true);
    document.addEventListener("mouseleave", docMouseleave, true);
    window.addEventListener("resize", resize, true);

    state.overlay.addEventListener("wheel", wheel, { passive: false });
    state.overlay.addEventListener("click", click, true);

    state.spreadCheckbox.addEventListener("change", async () => {
      if (!state) return;

      const anchor = getCurrentAnchorIndex();
      state.spreadEnabled = state.spreadCheckbox.checked;
      syncToggleVisuals();

      await saveSettings({
        readingDirectionRTL: state.readingDirectionRTL,
        spreadEnabled: state.spreadEnabled,
        firstPageSingle: state.firstPageSingle
      });

      rebuildStepsKeepingAnchor(anchor);
      renderCurrentStep();
      syncHudTrigger();
    });

    state.firstSingleCheckbox.addEventListener("change", async () => {
      if (!state) return;

      const anchor = getCurrentAnchorIndex();
      state.firstPageSingle = state.firstSingleCheckbox.checked;
      syncToggleVisuals();

      await saveSettings({
        readingDirectionRTL: state.readingDirectionRTL,
        spreadEnabled: state.spreadEnabled,
        firstPageSingle: state.firstPageSingle
      });

      rebuildStepsKeepingAnchor(anchor);
      renderCurrentStep();
      syncHudTrigger();
    });

    state.rtlCheckbox.addEventListener("change", async () => {
      if (!state) return;

      state.readingDirectionRTL = state.rtlCheckbox.checked;
      syncToggleVisuals();

      await saveSettings({
        readingDirectionRTL: state.readingDirectionRTL,
        spreadEnabled: state.spreadEnabled,
        firstPageSingle: state.firstPageSingle
      });

      renderCurrentStep();
      syncHudTrigger();
    });
  }

  function buildOverlay() {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "dcmv-overlay";

    overlay.innerHTML = `
      <div class="dcmv-stage"></div>
      <div class="dcmv-hud-trigger"></div>
      <div class="dcmv-hud ${HUD_VISIBLE_CLASS}">
        <button type="button" class="dcmv-btn" data-dcmv-action="prev">← 이전</button>

        <label class="dcmv-toggle dcmv-toggle-spread">
          <span>양면으로 보기</span>
          <input type="checkbox" class="dcmv-spread-checkbox">
        </label>

        <label class="dcmv-toggle dcmv-toggle-first-single">
          <span>첫페이지가 단면</span>
          <input type="checkbox" class="dcmv-first-single-checkbox">
        </label>

        <label class="dcmv-toggle dcmv-toggle-rtl">
          <span>페이지 읽는 순서 우→좌</span>
          <input type="checkbox" class="dcmv-rtl-checkbox">
        </label>

        <div class="dcmv-page-counter">0 / 0</div>

        <button type="button" class="dcmv-btn" data-dcmv-action="refresh">새로고침</button>
        <button type="button" class="dcmv-btn" data-dcmv-action="close">닫기</button>
        <button type="button" class="dcmv-btn" data-dcmv-action="next">다음 →</button>
      </div>
    `;

    return overlay;
  }

  function setRefreshButtonState(isRunning) {
    if (!state || !state.refreshButton) return;

    state.refreshButton.disabled = !!isRunning;
    state.refreshButton.textContent = isRunning ? "갱신 중..." : "새로고침";
  }

  function syncToggleVisuals() {
    if (!state) return;

    state.spreadToggle.classList.toggle(
      TOGGLE_ACTIVE_CLASS,
      state.spreadCheckbox.checked
    );
    state.firstSingleToggle.classList.toggle(
      TOGGLE_ACTIVE_CLASS,
      state.firstSingleCheckbox.checked
    );
    state.rtlToggle.classList.toggle(
      TOGGLE_ACTIVE_CLASS,
      state.rtlCheckbox.checked
    );
  }

  function syncHudTrigger() {
    if (!state) return;

    const rect = state.hud.getBoundingClientRect();
    const trigger = state.hudTrigger;

    const left = Math.max(0, rect.left - HUD_TRIGGER_MARGIN_X);
    const top = Math.max(0, rect.top - HUD_TRIGGER_MARGIN_Y);
    const width = Math.min(
      window.innerWidth - left,
      rect.width + HUD_TRIGGER_MARGIN_X * 2
    );
    const height = Math.min(
      window.innerHeight - top,
      rect.height + HUD_TRIGGER_MARGIN_Y * 2
    );

    trigger.style.left = `${left}px`;
    trigger.style.top = `${top}px`;
    trigger.style.width = `${width}px`;
    trigger.style.height = `${height}px`;
  }

  function isPointerInsideHudTrigger(x, y) {
    if (!state) return false;

    const rect = state.hudTrigger.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function scheduleHudHide() {
    if (!state) return;

    clearTimeout(state.hudHideTimer);

    state.hudHideTimer = setTimeout(() => {
      if (!state) return;
      if (state.isPointerOverHudZone) return;
      state.hud.classList.remove(HUD_VISIBLE_CLASS);
    }, HUD_HIDE_DELAY);
  }

  function showHudTemporarily() {
    if (!state) return;

    state.hud.classList.add(HUD_VISIBLE_CLASS);
    clearTimeout(state.hudHideTimer);

    state.hudHideTimer = setTimeout(() => {
      if (!state) return;
      if (state.isPointerOverHudZone) return;
      state.hud.classList.remove(HUD_VISIBLE_CLASS);
    }, HUD_INITIAL_SHOW_DELAY);
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

  function rebuildStepsKeepingAnchor(anchorIndex) {
    state.steps = buildAllSteps();

    let idx = state.steps.findIndex((step) =>
      step.images.some((img) => img.index === anchorIndex)
    );

    if (idx < 0) idx = 0;

    state.stepIndex = idx;
    state.currentStep = state.steps[idx] || null;
  }

  function buildAllSteps() {
    const steps = [];
    const items = state.sourceItems;

    if (!state.spreadEnabled) {
      for (let i = 0; i < items.length; i += 1) {
        steps.push(makeSingleStep(i, items[i]));
      }
      return steps;
    }

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

      portraitSeen += 1;

      if (state.firstPageSingle && portraitSeen === 1) {
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
    if (state.stepIndex >= state.steps.length - 1) return;

    state.stepIndex += 1;
    state.currentStep = state.steps[state.stepIndex];
    renderCurrentStep();
  }

  function goPrev(force = false) {
    if (!state || !state.currentStep) return;
    if (!canNavigate(force)) return;
    if (state.stepIndex <= 0) return;

    state.stepIndex -= 1;
    state.currentStep = state.steps[state.stepIndex];
    renderCurrentStep();
  }

  function renderCurrentStep() {
    if (!state) return;

    const step = state.currentStep;

    if (!step || !step.images.length) {
      state.stage.innerHTML =
        '<div class="dcmv-empty">표시할 페이지가 없습니다.</div>';
      state.pageCounter.textContent = `0 / ${state.totalCount}`;
      return;
    }

    state.stage.innerHTML = "";

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
      });

      wrap.appendChild(img);
    }

    state.stage.appendChild(wrap);
    renderPageCounter(step);
    preloadNearbySteps();
  }

  function renderPageCounter(step) {
    if (!state) return;

    if (step.images.length === 1) {
      state.pageCounter.textContent = `${step.images[0].displayIndex} / ${state.totalCount}`;
      return;
    }

    state.pageCounter.textContent =
      `${step.images[0].displayIndex}, ${step.images[1].displayIndex} / ${state.totalCount}`;
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
    return item.width >= item.height;
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

  function collectSourceItems(root) {
    const domImages = Array.from(root.querySelectorAll("img"));
    const result = [];
    const seen = new Set();

    for (const imgEl of domImages) {
      if (isInsideExcludedImageCommentArea(imgEl)) continue;
      if (isExcludedInlineDcconImage(imgEl)) continue;

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
        width: 0,
        height: 0,
        alt: imgEl.getAttribute("alt") || "",
        index: result.length,
        displayIndex: result.length + 1,
        element: imgEl,
        failed: false
      });
    }

    return result;
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
            prevLandscape !== null && nextLandscape !== null && prevLandscape !== nextLandscape
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

    const ta = document.createElement("textarea");
    ta.innerHTML = str;
    return ta.value;
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

  function refreshSourceItemSources() {
    if (!state) return;

    for (const item of state.sourceItems) {
      const el = findElementForSourceItem(state.root, item) || item.element;
      if (!el || isInsideExcludedImageCommentArea(el) || isExcludedInlineDcconImage(el)) continue;

      const nextSrc =
        el.getAttribute("data-original") ||
        el.getAttribute("data-src") ||
        el.getAttribute("src") ||
        item.src ||
        "";

      if (nextSrc) {
        item.src = decodeHtml(nextSrc);
      }

      item.element = el;
    }
  }

  async function retryMissingItems() {
    if (!state) return;

    const missing = state.sourceItems.filter((item) => item.failed || !item.width || !item.height);
    for (const item of missing) {
      await retrySourceItem(item);
    }
  }

  async function retrySourceItem(item) {
    if (!item) return;
    item.src = appendCacheBust(item.src || item.resolvedSrc || "");
    await loadImageMetadata(item);
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
      const stepIndexBefore = state.stepIndex;
      const primaryPageIndex = getPrimaryVisiblePageIndex();

      if (!hasAutoLazyWakeRunInThisTabPage) {
        await wakeLazyImages(state.root);
        hasAutoLazyWakeRunInThisTabPage = true;
      }

      refreshSourceItemSources();
      const metadataResult = await hydrateImageMetadata(state.sourceItems);
      await retryMissingItems();

      if (metadataResult.orientationChangedPages.length) {
        rebuildStepsForOrientationChange(primaryPageIndex);
      } else {
        state.currentStep = state.steps[state.stepIndex] || state.currentStep;
        state.stepIndex = Math.max(0, Math.min(stepIndexBefore, state.steps.length - 1));
        state.currentStep = state.steps[state.stepIndex] || state.currentStep;
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
    setRefreshButtonState(true);

    try {
      const stepIndexBefore = state.stepIndex;
      const primaryPageIndex = getPrimaryVisiblePageIndex();

      await wakeLazyImages(state.root);
      refreshSourceItemSources();
      const metadataResult = await hydrateImageMetadata(state.sourceItems);
      await retryMissingItems();

      if (metadataResult.orientationChangedPages.length) {
        rebuildStepsForOrientationChange(primaryPageIndex);
      } else {
        state.stepIndex = Math.max(0, Math.min(stepIndexBefore, state.steps.length - 1));
        state.currentStep = state.steps[state.stepIndex] || state.currentStep;
      }

      renderCurrentStep();
      syncHudTrigger();
    } finally {
      if (state) {
        state.isRepairRunning = false;
        state.isManualRefreshRunning = false;
        setRefreshButtonState(false);
      }
    }
  }

  async function wakeLazyImages(root) {
    if (!root) return;

    const startY = window.scrollY || window.pageYOffset || 0;
    const maxScroll = Math.max(0, (document.documentElement.scrollHeight || document.body.scrollHeight || 0) - window.innerHeight);

    for (let y = startY; y <= maxScroll; y += LAZY_WAKE_SCROLL_STEP) {
      pokeLazyImages(root);
      window.scrollTo(0, y);
      await sleep(LAZY_WAKE_SCROLL_DELAY_MS);
    }

    pokeLazyImages(root);
    window.scrollTo(0, maxScroll);
    await sleep(LAZY_WAKE_SCROLL_DELAY_MS);
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

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [
          STORAGE_KEYS.readingDirectionRTL,
          STORAGE_KEYS.spreadEnabled,
          STORAGE_KEYS.firstPageSingle
        ],
        (result) => {
          resolve({
            readingDirectionRTL: result[STORAGE_KEYS.readingDirectionRTL],
            spreadEnabled: result[STORAGE_KEYS.spreadEnabled],
            firstPageSingle: result[STORAGE_KEYS.firstPageSingle]
          });
        }
      );
    });
  }

  function saveSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          [STORAGE_KEYS.readingDirectionRTL]: !!settings.readingDirectionRTL,
          [STORAGE_KEYS.spreadEnabled]: !!settings.spreadEnabled,
          [STORAGE_KEYS.firstPageSingle]: !!settings.firstPageSingle
        },
        () => resolve()
      );
    });
  }
})();
