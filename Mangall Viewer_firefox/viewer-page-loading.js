(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  const siteRegistry = globalThis.__dcmvSiteRegistry || {};

  function getCurrentSiteAdapter() {
    return siteRegistry.getSiteAdapterForUrl?.(location.href) || null;
  }

  function getAdapterMethod(name, fallback) {
    const adapter = getCurrentSiteAdapter();
    if (adapter && typeof adapter[name] === "function") {
      return adapter[name].bind(adapter);
    }

    return fallback;
  }

  modules.pageLoading = {
    findContentRoot() {
      const fallback = () => {
        const selectors = [
          ".fr-view.article-content",
          ".article-body .article-content",
          ".article-body",
          ".board-article .article-body",
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
      };

      return getAdapterMethod("findContentRoot", fallback)();
    },

    collectSourceItems(root, deps) {
      const collectSourceItems =
        getCurrentSiteAdapter()?.collectSourceItems ||
        ((currentRoot, currentDeps) => {
          const domImages = Array.from(currentRoot.querySelectorAll("img"));
          const result = [];
          const seen = new Set();

          for (const imgEl of domImages) {
            if (this.isInsideExcludedImageCommentArea(imgEl)) continue;
            if (this.isExcludedInlineDcconImage(imgEl)) continue;
            if (this.isInsideOpenGraphPreview(imgEl)) continue;

            const originalPopUrl =
              imgEl.closest("a[href]")?.href ||
              currentDeps.parseOriginalPopUrlFromTag(imgEl.outerHTML || "");
            const normalSrc =
              imgEl.getAttribute("data-original") ||
              imgEl.getAttribute("data-src") ||
              imgEl.getAttribute("src") ||
              currentDeps.resolveImageUrlFromTag(imgEl.outerHTML || "");

            const decodedSrc = currentDeps.decodeHtml(normalSrc || "");
            const decodedPopUrl = currentDeps.decodeHtml(originalPopUrl || "");
            const dedupeKey = decodedPopUrl || decodedSrc;

            if (!dedupeKey || seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            result.push({
              src: decodedSrc || "",
              originalPopUrl: decodedPopUrl || "",
              resolvedSrc: "",
              width: imgEl.naturalWidth || Number(imgEl.getAttribute("width")) || 0,
              height: imgEl.naturalHeight || Number(imgEl.getAttribute("height")) || 0,
              alt: imgEl.getAttribute("alt") || "",
              index: result.length,
              displayIndex: result.length + 1,
              element: imgEl,
              failed: false
            });
          }

          return result;
        });

      return collectSourceItems.call(this, root, deps);
    },

    isInsideExcludedImageCommentArea(el) {
      const fallback = (target) => {
        if (!(target instanceof Element)) return false;
        return !!target.closest(
          ".article-comment, .comment-list, .comment-item, .article-head, .article-profile"
        );
      };

      return getAdapterMethod("isInsideExcludedImageCommentArea", fallback)(el);
    },

    isExcludedInlineDcconImage(el) {
      const fallback = (target) => {
        if (!(target instanceof Element)) return false;
        return target.matches("img.written_dccon, img.emoticon");
      };

      return getAdapterMethod("isExcludedInlineDcconImage", fallback)(el);
    },

    isInsideOpenGraphPreview(el) {
      const fallback = (target) => {
        if (!(target instanceof Element)) return false;
        return !!target.closest("div.og-div, .article-link-card, .link-preview");
      };

      return getAdapterMethod("isInsideOpenGraphPreview", fallback)(el);
    },

    loadLastReadPosition(pageSessionKey) {
      try {
        const raw = window.sessionStorage.getItem(pageSessionKey);
        const saved = raw ? JSON.parse(raw) : null;
        if (!saved) return null;
        const currentPageKey = `${location.origin}${location.pathname}${location.search}`;
        return saved.pageKey === currentPageKey ? saved : null;
      } catch {
        return null;
      }
    },

    getPrimaryAnchorItem(targetState) {
      if (!targetState?.currentStep?.images?.length) return null;

      if (targetState.currentStep.images.length === 1) {
        return targetState.currentStep.images[0];
      }

      return targetState.readingDirectionRTL
        ? targetState.currentStep.images[targetState.currentStep.images.length - 1]
        : targetState.currentStep.images[0];
    },

    normalizeComparableUrl(url, deps) {
      return deps.normalizeComparableUrl
        ? deps.normalizeComparableUrl(url, deps.locationHref)
        : !url
          ? ""
          : String(url);
    },

    getComparableUrlsForItem(item, deps) {
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
        .map((value) => deps.normalizeComparableUrl(value || ""))
        .filter(Boolean);

      return Array.from(new Set(urls));
    },

    findSourceItemIndexByUrl(targetUrl, deps) {
      if (!deps.state || !targetUrl) return -1;

      for (const item of deps.state.sourceItems) {
        if (deps.getComparableUrlsForItem(item).includes(targetUrl)) {
          return item.index;
        }
      }

      return -1;
    },

    getStableItemKey(item, deps) {
      const urls = deps.getComparableUrlsForItem(item);
      return urls[0] || "";
    },

    saveLastReadPosition(targetState, deps) {
      if (!targetState) return;

      const pageKey = `${location.origin}${location.pathname}${location.search}`;
      const nextPosition = {
        pageKey,
        index: deps.getSavedImageIndex(targetState)
      };

      try {
        window.sessionStorage.setItem(
          deps.pageSessionKey,
          JSON.stringify(nextPosition)
        );
      } catch {
      }
    },

    async hydrateImageMetadata(items, options, deps) {
      const orientationChangedPages = [];

      for (let i = 0; i < items.length; i += deps.imageMetadataBatchSize) {
        const batch = items.slice(i, i + deps.imageMetadataBatchSize);
        const results = await Promise.all(
          batch.map((item) => this.loadImageMetadata(item, options, deps))
        );

        for (const result of results) {
          if (result && result.orientationChanged) {
            orientationChangedPages.push(result.index);
          }
        }
      }

      return { orientationChangedPages };
    },

    loadImageMetadata(item, options = {}, deps) {
      return new Promise((resolve) => {
        let done = false;
        const prevLandscape = deps.isLandscapeLike(item.width, item.height);

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
            item.resolvedSrc = deps.convertPopUrlToDirectImageUrl(item.originalPopUrl);
          } else {
            item.resolvedSrc = "";
          }

          const nextLandscape = deps.isLandscapeLike(item.width, item.height);
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
        }, deps.imageMetadataTimeoutMs);

        try {
          probe.src = item.src || "";
        } catch {
          finish(false);
        }
      });
    },

    findElementForSourceItem(root, targetItem, deps) {
      if (!root || !targetItem) return null;

      const imgs = Array.from(root.querySelectorAll("img"));
      const targetKey = deps.decodeHtml(targetItem.originalPopUrl || targetItem.src || "");

      if (!targetKey) return null;

      for (const imgEl of imgs) {
        const imgSrc =
          imgEl.getAttribute("data-original") ||
          imgEl.getAttribute("data-src") ||
          imgEl.getAttribute("src") ||
          "";

        const imgPopUrl = deps.parseOriginalPopUrlFromTag(imgEl.outerHTML || "");
        const imgKey = deps.decodeHtml(imgPopUrl || imgSrc || "");

        if (imgKey === targetKey) {
          return imgEl;
        }
      }

      return null;
    },

    estimateRenderedImageHeight(root, item, contentWidth, deps) {
      const actualHeight = deps.getActualRenderedHeightForItem(root, item);
      if (actualHeight != null) {
        return actualHeight;
      }

      const width = Math.max(1, Number(item?.width) || 1);
      const height = Math.max(1, Number(item?.height) || 1);

      return contentWidth * (height / width);
    },

    getActualRenderedHeightForItem(root, item, deps) {
      const el = deps.findElementForSourceItem(root, item);
      if (!el || !document.contains(el)) return null;

      const rect = el.getBoundingClientRect();
      if (!rect.height || rect.height <= 1) return null;

      return rect.height;
    },

    estimateScrollTopForImageIndex(root, sourceItems, targetIndex, deps) {
      if (!root || !sourceItems?.length) return null;

      const rootRect = root.getBoundingClientRect();
      const currentScrollY = window.scrollY || window.pageYOffset;
      const rootTop = rootRect.top + currentScrollY;
      const contentWidth = Math.max(320, root.clientWidth || rootRect.width || 320);

      let y = rootTop;

      for (let i = 0; i < targetIndex; i += 1) {
        const item = sourceItems[i];
        y += deps.estimateRenderedImageHeight(root, item, contentWidth);
        y += 12;
      }

      return Math.max(0, Math.round(y));
    },

    refreshSourceItemsFromDom(targetState, deps) {
      if (!targetState) {
        return { nextSourceItems: [], countChanged: false };
      }

      const prevItemsByKey = new Map();
      for (const item of targetState.sourceItems) {
        const key = deps.getStableItemKey(item);
        if (key) {
          prevItemsByKey.set(key, item);
        }
      }

      const nextSourceItems = deps.collectSourceItems(targetState.root).map((item) => {
        const prevItem = prevItemsByKey.get(deps.getStableItemKey(item));
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

      const countChanged = nextSourceItems.length !== targetState.sourceItems.length;

      return { nextSourceItems, countChanged };
    },

    applyRefreshedSourceItems(targetState, nextSourceItems) {
      if (!targetState) return;
      targetState.sourceItems = nextSourceItems;
      targetState.totalCount = nextSourceItems.length;
    },

    async retryMissingItems(targetState, deps) {
      if (!targetState) {
        return { orientationChangedPages: [] };
      }

      const missing = targetState.sourceItems.filter(
        (item) => item.failed || !item.width || !item.height
      );
      const orientationChangedPages = [];
      for (const item of missing) {
        const result = await deps.retrySourceItem(item);
        if (result?.orientationChanged) {
          orientationChangedPages.push(result.index);
        }
      }

      return { orientationChangedPages };
    },

    async retrySourceItem(item, deps) {
      if (!item) return;
      item.src = deps.appendCacheBust(item.src || item.resolvedSrc || "");
      return deps.loadImageMetadata(item);
    },

    async wakeLazyImages(root, deps) {
      if (!root) return;

      const startY = window.scrollY || window.pageYOffset || 0;

      window.scrollTo(0, 0);
      await deps.sleep(deps.lazyWakeScrollDelayMs);

      let y = 0;
      let lastScrollY = -1;
      let stuckCount = 0;

      while (stuckCount < 2) {
        deps.pokeLazyImages(root);
        window.scrollTo(0, y);
        await deps.sleep(deps.lazyWakeScrollDelayMs);

        const currentScrollY = window.scrollY || window.pageYOffset || 0;
        if (currentScrollY <= lastScrollY) {
          stuckCount += 1;
        } else {
          stuckCount = 0;
          lastScrollY = currentScrollY;
        }

        y = currentScrollY + deps.lazyWakeScrollStep;
      }

      deps.pokeLazyImages(root);
      window.scrollTo(0, startY);
      deps.pokeLazyImages(root);
    },

    pokeLazyImages(root) {
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

      const adapter = getCurrentSiteAdapter();
      if (adapter && typeof adapter.pokeLazyImages === "function") {
        adapter.pokeLazyImages(root);
      }
    },

    scheduleInitialPostLazyRefresh(targetState, deps) {
      if (!targetState) return;

      deps.runInitialLazyRepair().catch(() => {});
    },

    async runInitialLazyRepair(targetState, deps) {
      if (!targetState) return;

      deps.setImageLoadingProgress(0.38);
      await deps.wakeLazyImages(targetState.root);
      deps.setHasAutoLazyWakeRun(true);
      deps.runInitialAutoWhenReady("lazy 깨우기 완료");
      deps.setImageLoadingProgress(0.62);

      if (!deps.getState()) return;

      await deps.waitForAllPagesReadyBeforeSecondPass(2000);

      if (!deps.getState()) return;

      deps.setImageLoadingProgress(0.82);
      await deps.initialPostLazyRefreshRound();
    },

    async initialPostLazyRefreshRound(targetState, deps) {
      if (!targetState) return;

      const refreshResult = deps.refreshSourceItemsFromDom();
      const previousCount = targetState.totalCount;
      let didChange = false;

      deps.applyRefreshedSourceItems(refreshResult.nextSourceItems);
      const metadataResult = targetState.sourceItems.length
        ? await deps.hydrateImageMetadata(targetState.sourceItems)
        : { orientationChangedPages: [] };
      const retryResult = await deps.retryMissingItems();

      if (targetState.autoFirstPageAdjust && !targetState.hasUserAdjustedFirstPageSingle) {
        const previousFirstPageSingle = targetState.firstPageSingle;
        targetState.firstPageSingle = deps.chooseInitialFirstPageSinglePreference(
          previousFirstPageSingle,
          { phase: "2차 판정" }
        );
        if (targetState.firstPageSingle !== previousFirstPageSingle) {
          didChange = true;
          targetState.didAutoAdjustFirstPageSingle = true;
          deps.saveAutoAdjustedFirstPageSingleValue(targetState.firstPageSingle);
          deps.showEdgeToast("첫 페이지가 단면 설정이 자동 조정 되었습니다.", 2000);
        }
        deps.syncToggleVisuals();
      }

      const anchorIndexBefore = deps.getCurrentAnchorIndex();
      const stepIndexBefore = targetState.stepIndex;
      const previousRenderUrls = deps.getCurrentStepRenderUrls();
      const layoutChanged = deps.applyRebuiltLayoutIfChanged(anchorIndexBefore);

      if (!layoutChanged) {
        targetState.stepIndex = Math.max(
          0,
          Math.min(stepIndexBefore, targetState.steps.length - 1)
        );
        targetState.currentStep =
          targetState.steps[targetState.stepIndex] || targetState.currentStep;
        if (deps.didCurrentStepRenderUrlsChange(previousRenderUrls)) {
          deps.syncCurrentStepImagesFromSourceItems();
        }
      }

      deps.renderCurrentStep();
      deps.syncHudTrigger();
      deps.setImageLoadingProgress(1, { complete: true });
      if (
        refreshResult.countChanged ||
        metadataResult.orientationChangedPages.length ||
        retryResult.orientationChangedPages.length ||
        didChange ||
        layoutChanged
      ) {
        if (targetState.totalCount !== previousCount) {
          deps.showEdgeToast("이미지가 추가 확인되어 새로고침 하였습니다.", 2000);
        }
      }
    },

    scheduleBackgroundRepair(targetState, deps) {
      if (!targetState) return;

      deps.clearRepairTimers(targetState);

      for (let i = 0; i < deps.repairMaxRounds; i += 1) {
        const delay = deps.repairInitialDelayMs + deps.repairIntervalMs * i;
        const timer = setTimeout(() => {
          deps.backgroundRepairRound().catch(() => {});
        }, delay);
        targetState.repairTimers.push(timer);
      }
    },

    async backgroundRepairRound(targetState, deps) {
      if (!targetState || targetState.isRepairRunning) return;
      targetState.isRepairRunning = true;

      try {
        if (!deps.getHasAutoLazyWakeRun()) {
          await deps.wakeLazyImages(targetState.root);
          deps.setHasAutoLazyWakeRun(true);
        }

        const refreshResult = deps.refreshSourceItemsFromDom();
        deps.applyRefreshedSourceItems(refreshResult.nextSourceItems);
        await deps.hydrateImageMetadata(targetState.sourceItems);
        await deps.retryMissingItems();

        const anchorIndexBefore = deps.getCurrentAnchorIndex();
        const stepIndexBefore = targetState.stepIndex;
        const previousRenderUrls = deps.getCurrentStepRenderUrls();
        const layoutChanged = deps.applyRebuiltLayoutIfChanged(anchorIndexBefore);

        if (!layoutChanged) {
          targetState.stepIndex = Math.max(
            0,
            Math.min(stepIndexBefore, targetState.steps.length - 1)
          );
          targetState.currentStep =
            targetState.steps[targetState.stepIndex] || targetState.currentStep;
          if (deps.didCurrentStepRenderUrlsChange(previousRenderUrls)) {
            deps.syncCurrentStepImagesFromSourceItems();
          }
        }

        deps.renderCurrentStep();
        deps.syncHudTrigger();
      } finally {
        if (deps.getState()) {
          deps.getState().isRepairRunning = false;
        }
      }
    },

    async runManualRefresh(targetState, deps) {
      if (!targetState || targetState.isRepairRunning || targetState.isManualRefreshRunning) {
        return;
      }
      targetState.isRepairRunning = true;
      targetState.isManualRefreshRunning = true;
      const hadManualPairingReset =
        Array.isArray(targetState.manualPairingResetIndices) &&
        targetState.manualPairingResetIndices.length > 0;
      targetState.manualPairingResetIndices = [];
      deps.clearSavedManualPairingResetIndices();
      deps.setRefreshButtonState(true);

      try {
        let didChange = hadManualPairingReset;

        await deps.wakeLazyImages(targetState.root);
        const refreshResult = deps.refreshSourceItemsFromDom();
        deps.applyRefreshedSourceItems(refreshResult.nextSourceItems);
        await deps.hydrateImageMetadata(targetState.sourceItems);
        await deps.retryMissingItems();

        const anchorIndexBefore = deps.getCurrentAnchorIndex();
        const stepIndexBefore = targetState.stepIndex;
        const previousRenderUrls = deps.getCurrentStepRenderUrls();
        const layoutChanged = deps.applyRebuiltLayoutIfChanged(anchorIndexBefore);

        if (!layoutChanged) {
          if (didChange) {
            deps.rebuildStepsKeepingAnchor(anchorIndexBefore);
          } else {
            targetState.stepIndex = Math.max(
              0,
              Math.min(stepIndexBefore, targetState.steps.length - 1)
            );
            targetState.currentStep =
              targetState.steps[targetState.stepIndex] || targetState.currentStep;
            if (deps.didCurrentStepRenderUrlsChange(previousRenderUrls)) {
              deps.syncCurrentStepImagesFromSourceItems();
            }
          }
        } else {
          didChange = true;
        }

        deps.renderCurrentStep();
        deps.syncHudTrigger();
        if (didChange || layoutChanged) {
          deps.showEdgeToast("갱신 완료", 2000);
        }
      } finally {
        const state = deps.getState();
        if (state) {
          state.isRepairRunning = false;
          state.isManualRefreshRunning = false;
          deps.setRefreshButtonState(false);
        }
      }
    },

    clearRepairTimers(targetState) {
      const timers = targetState?.repairTimers || [];
      for (const timer of timers) {
        clearTimeout(timer);
      }
      if (targetState) {
        targetState.repairTimers = [];
      }
    },

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    syncKnownDimensionsFromDom(targetState, deps) {
      if (!targetState?.root || !targetState?.sourceItems?.length) return;

      const refreshed = deps.refreshSourceItemsFromDom();
      if (!refreshed?.nextSourceItems?.length) return;

      for (const nextItem of refreshed.nextSourceItems) {
        const currentItem = targetState.sourceItems[nextItem.index];
        if (!currentItem) continue;
        if (!currentItem.width && nextItem.width) {
          currentItem.width = nextItem.width;
        }
        if (!currentItem.height && nextItem.height) {
          currentItem.height = nextItem.height;
        }
      }
    },

    async waitForAllPagesReadyBeforeSecondPass(targetState, maxWaitMs, deps) {
      if (!targetState?.sourceItems?.length) return;

      const startedAt = Date.now();

      while (deps.getState()) {
        deps.syncKnownDimensionsFromDom();

        const allReady = deps.getState().sourceItems.every((item) =>
          deps.hasUsableImageMetadata(item)
        );
        if (allReady) {
          return;
        }

        if (Date.now() - startedAt >= maxWaitMs) {
          return;
        }

        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 80);
          deps.getState()?.repairTimers?.push(timer);
        });
      }
    },

    async ensureInitialAutoMetadataWindow(targetState, deps) {
      if (!targetState?.sourceItems?.length) return;
      if (targetState.initialAutoMetadataPromise) {
        await targetState.initialAutoMetadataPromise;
        return;
      }

      const targetItems = targetState.sourceItems
        .slice(0, deps.initialAutoRequiredKnownPages)
        .filter((item) => !item.width || !item.height || deps.isDcPlaceholderSize(item));

      if (!targetItems.length) {
        return;
      }

      targetState.initialAutoMetadataPromise = Promise.all(
        targetItems.map((item) => deps.loadImageMetadata(item))
      ).finally(() => {
        if (deps.getState()) {
          deps.getState().initialAutoMetadataPromise = null;
        }
      });

      await targetState.initialAutoMetadataPromise;
    },

    async runInitialAutoWhenReady(targetState, reason, deps) {
      if (!targetState || targetState.hasRunInitialAutoAfterFirstImageLoad) {
        return;
      }

      if (targetState.shouldReuseSavedAutoFirstPageSingle) {
        targetState.hasRunInitialAutoAfterFirstImageLoad = true;
        await deps.presentInitialViewerAfterInitialAuto(false);
        return;
      }

      await deps.ensureInitialAutoMetadataWindow();
      deps.syncKnownDimensionsFromDom();

      const rawEvaluationItems = targetState.sourceItems.slice(0, deps.initialAutoEvalPageLimit);
      const evaluationItems = rawEvaluationItems.map((item) =>
        deps.isDcPlaceholderSize(item)
          ? { ...item, width: 0, height: 0 }
          : item
      );
      const rawKnownSizeCount = rawEvaluationItems.filter((item) => item.width && item.height).length;
      const knownSizeCount = evaluationItems.filter((item) => item.width && item.height).length;
      const totalCount = targetState.sourceItems.length;
      const hasEnoughKnownPages = knownSizeCount >= deps.initialAutoRequiredKnownPages;
      const hasLoadedAllKnownPages =
        rawKnownSizeCount >= Math.min(totalCount, deps.initialAutoEvalPageLimit);

      if (!hasEnoughKnownPages && !hasLoadedAllKnownPages) {
        return;
      }

      targetState.hasRunInitialAutoAfterFirstImageLoad = true;

      const previousFirstPageSingle = targetState.firstPageSingle;
      const didChange = deps.applyInitialFirstPageSingleAuto(previousFirstPageSingle);
      if (didChange) {
        targetState.firstSingleCheckbox.checked = targetState.firstPageSingle;
        deps.syncToggleVisuals();
        deps.rebuildStepsKeepingAnchor(deps.getCurrentAnchorIndex());
        deps.renderCurrentStep();
        deps.syncHudTrigger();
      }

      await deps.presentInitialViewerAfterInitialAuto(didChange);
    },

    async presentInitialViewerAfterInitialAuto(targetState, didChange, deps) {
      if (!targetState || targetState.hasPresentedInitialViewer) {
        return;
      }

      await deps.sleep(5);
      if (!deps.getState() || deps.getState().hasPresentedInitialViewer) {
        return;
      }

      deps.getState().hasPresentedInitialViewer = true;
      deps.getState().stage.style.visibility = "";
      deps.setImageLoadingProgress(0.22);
      deps.showHudTemporarily();

      if (didChange) {
        deps.showEdgeToast("첫 페이지가 단면 설정이 자동 조정 되었습니다.", 2000);
      }
    }
  };
})();
