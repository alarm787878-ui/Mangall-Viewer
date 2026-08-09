(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  const VIEWER_IMAGE_READY_TIMEOUT_MS = 1000;
  function preloadImageItem(item) {
    if (!item || item.failed) return;

    const src = item.resolvedSrc || item.src || "";
    if (src) {
      const img = new Image();
      img.src = src;
    }
  }

  function waitForViewerImageReady(imageElement, item) {
    if (!(imageElement instanceof HTMLImageElement)) {
      return Promise.resolve();
    }

    const primarySrc = item?.resolvedSrc || item?.src || "";
    const fallbackSrc =
      item?.resolvedSrc && item?.src && item.resolvedSrc !== item.src
        ? item.src
        : "";

    if (!primarySrc) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let didTryFallback = false;
      let didResolve = false;
      let timeoutId = null;

      const cleanup = () => {
        imageElement.removeEventListener("load", handleLoad);
        imageElement.removeEventListener("error", handleError);
        clearTimeout(timeoutId);
      };

      const finish = () => {
        if (didResolve) return;
        didResolve = true;
        cleanup();
        resolve();
      };

      const resolveAfterDecode = () => {
        if (typeof imageElement.decode !== "function") {
          finish();
          return;
        }

        // Firefox에서는 load 직후 바로 교체하면 디코딩 타이밍 때문에 순간 깜빡일 수 있다.
        try {
          imageElement.decode().then(finish, finish);
        } catch {
          finish();
        }
      };

      const handleLoad = () => {
        resolveAfterDecode();
      };

      const handleError = () => {
        if (!didTryFallback && fallbackSrc) {
          didTryFallback = true;
          imageElement.src = fallbackSrc;
          return;
        }

        finish();
      };

      imageElement.addEventListener("load", handleLoad);
      imageElement.addEventListener("error", handleError);
      timeoutId = setTimeout(finish, VIEWER_IMAGE_READY_TIMEOUT_MS);
      imageElement.src = primarySrc;

      if (imageElement.complete && imageElement.naturalWidth) {
        handleLoad();
      }
    });
  }

  function cleanupEmptyPlaceholders(stage) {
    if (!(stage instanceof HTMLElement)) return;

    const emptyPlaceholders = stage.querySelectorAll(":scope > .dcmv-empty");
    for (const emptyPlaceholder of emptyPlaceholders) {
      emptyPlaceholder.remove();
    }
  }

  function recoverRenderableCurrentStep(targetState, deps = {}) {
    if (!targetState) return null;

    if (targetState.currentStep?.images?.length) {
      return targetState.currentStep;
    }

    let steps = Array.isArray(targetState.steps) ? targetState.steps : [];
    if (!steps.length && targetState.sourceItems?.length && typeof deps.buildAllSteps === "function") {
      targetState.steps = deps.buildAllSteps();
      steps = Array.isArray(targetState.steps) ? targetState.steps : [];
    }

    if (!steps.length) return null;

    const clampedIndex = Math.max(
      0,
      Math.min(Number(targetState.stepIndex) || 0, steps.length - 1)
    );
    const indexedStep = steps[clampedIndex];

    if (indexedStep?.images?.length) {
      targetState.stepIndex = clampedIndex;
      targetState.currentStep = indexedStep;
      return indexedStep;
    }

    const fallbackIndex = steps.findIndex((step) => step?.images?.length);
    if (fallbackIndex < 0) return null;

    // currentStep이 잠깐 비어도 전체 페이지가 있으면 가능한 기존 step에서 복구한다.
    targetState.stepIndex = fallbackIndex;
    targetState.currentStep = steps[fallbackIndex];
    return targetState.currentStep;
  }

  modules.layout = {
    rebuildStepsKeepingAnchor(targetState, anchorIndex, deps) {
      targetState.steps = deps.buildAllSteps();

      let idx = targetState.steps.findIndex((step) => step.startIndex === anchorIndex);

      if (idx < 0) {
        idx = targetState.steps.findIndex((step) =>
          step.images.some((img) => img.index === anchorIndex)
        );
      }

      if (idx < 0) idx = 0;

      targetState.stepIndex = idx;
      targetState.currentStep = targetState.steps[idx] || null;
    },

    getStepSignature(step) {
      if (!step) return "";

      const imageKey = (step.images || [])
        .map((item) => `${item.index}:${item.resolvedSrc || item.src || ""}`)
        .join(",");

      return `${step.displayType || ""}|${step.startIndex}|${imageKey}`;
    },

    getStepsSignature(steps, deps) {
      if (!Array.isArray(steps)) return "";
      return steps.map((step) => deps.getStepSignature(step)).join("||");
    },

    findStepIndexForAnchorInSteps(steps, anchorIndex) {
      let idx = steps.findIndex((step) => step.startIndex === anchorIndex);

      if (idx < 0) {
        idx = steps.findIndex((step) =>
          step.images.some((img) => img.index === anchorIndex)
        );
      }

      return idx < 0 ? 0 : idx;
    },

    applyRebuiltLayoutIfChanged(targetState, anchorIndex, deps) {
      if (!targetState) return false;

      const nextSteps = deps.buildAllSteps();
      const nextStepIndex = deps.findStepIndexForAnchorInSteps(nextSteps, anchorIndex);
      const nextCurrentStep = nextSteps[nextStepIndex] || null;

      if (
        deps.getStepsSignature(targetState.steps) === deps.getStepsSignature(nextSteps) &&
        deps.getStepSignature(targetState.currentStep) === deps.getStepSignature(nextCurrentStep) &&
        targetState.stepIndex === nextStepIndex
      ) {
        return false;
      }

      targetState.steps = nextSteps;
      targetState.stepIndex = nextStepIndex;
      targetState.currentStep = nextCurrentStep;
      return true;
    },

    buildStepsForSegment(items, firstPageSingleOverride, segmentStartIndex, deps) {
      const steps = [];
      let portraitBuffer = [];
      let portraitSeen = 0;

      function flushPortraitBufferAsSingles() {
        while (portraitBuffer.length) {
          const item = portraitBuffer.shift();
          steps.push(deps.makeSingleStep(item.index, item));
        }
      }

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];

        if (deps.isLandscape(item)) {
          flushPortraitBufferAsSingles();
          steps.push(deps.makeSingleStep(item.index, item));
          continue;
        }

        if (deps.shouldTreatEarlyPortraitAsSingle(item, items, segmentStartIndex)) {
          flushPortraitBufferAsSingles();
          steps.push(deps.makeSingleStep(item.index, item));
          continue;
        }

        portraitSeen += 1;

        if (firstPageSingleOverride && portraitSeen === 1) {
          steps.push(deps.makeSingleStep(item.index, item));
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
    },

    buildAllSteps(targetState, firstPageSingleOverride, itemsOverride, deps) {
      const items = itemsOverride;

      if (!targetState.spreadEnabled) {
        const steps = [];
        for (let i = 0; i < items.length; i += 1) {
          steps.push(deps.makeSingleStep(i, items[i]));
        }
        return steps;
      }

      const resetIndices = Array.isArray(targetState?.manualPairingResetIndices)
        ? targetState.manualPairingResetIndices
          .filter((index) => Number.isInteger(index) && index >= 0)
          .sort((a, b) => a - b)
        : [];

      if (!resetIndices.length) {
        return deps.buildStepsForSegment(items, firstPageSingleOverride, 0);
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

        const shouldForceFirstSingle = i === 0 ? firstPageSingleOverride : true;

        steps.push(
          ...deps.buildStepsForSegment(segmentItems, shouldForceFirstSingle, segmentStart)
        );

        if (resetIndex != null) {
          segmentStart = resetIndex;
        }
      }

      return steps;
    },

    makeSingleStep(startIndex, item) {
      return {
        startIndex,
        images: [item],
        nextStartIndex: startIndex + 1,
        displayType: "single"
      };
    },

    goNext(targetState, force, deps) {
      if (!targetState || !targetState.currentStep) return;
      if (!deps.canNavigate(force)) return;
      if (targetState.stepIndex >= targetState.steps.length - 1) {
        if (targetState.edgeToastCooldownRemaining > 0) {
          targetState.edgeToastCooldownRemaining -= 1;
          return;
        }

        deps.showEdgeToast("마지막 페이지입니다.");
        targetState.edgeToastCooldownRemaining = deps.edgeToastCooldownAttempts;
        return;
      }

      targetState.edgeToastCooldownRemaining = deps.edgeToastCooldownAttempts;
      targetState.stepIndex += 1;
      targetState.currentStep = targetState.steps[targetState.stepIndex];
      deps.renderCurrentStep();
      deps.syncHudTrigger();
      deps.saveLastReadPosition();
    },

    goPrev(targetState, force, deps) {
      if (!targetState || !targetState.currentStep) return;
      if (!deps.canNavigate(force)) return;
      if (targetState.stepIndex <= 0) return;

      targetState.stepIndex -= 1;
      targetState.currentStep = targetState.steps[targetState.stepIndex];
      deps.renderCurrentStep();
      deps.syncHudTrigger();
      deps.saveLastReadPosition();
    },

    goToPageIndex(targetState, pageIndex, options, deps) {
      if (!targetState) return;

      const normalizedIndex = Math.max(
        0,
        Math.min(Number(pageIndex) || 0, targetState.sourceItems.length - 1)
      );

      if (options.keepPickerOpen) {
        deps.rebuildStepsKeepingAnchor(normalizedIndex);
        deps.renderCurrentStep();
        deps.togglePagePicker(true);
        return;
      }

      deps.togglePagePicker(false);
      targetState.navLockedUntil = Date.now() + deps.navThrottleMs;

      setTimeout(() => {
        if (!deps.getState()) return;

        deps.rebuildStepsKeepingAnchor(normalizedIndex);
        deps.renderCurrentStep();
        deps.saveLastReadPosition();
      }, deps.navThrottleMs);
    },

    renderCurrentStep(targetState, deps) {
      if (!targetState) return;

      const step = recoverRenderableCurrentStep(targetState, deps);

      if (!step || !step.images.length) {
        const hasKnownPages = !!(
          targetState.totalCount || targetState.sourceItems?.length
        );
        if (hasKnownPages) {
          cleanupEmptyPlaceholders(targetState.stage);
          return;
        }

        const empty = document.createElement("div");
        empty.className = "dcmv-empty";
        empty.textContent = "표시할 페이지가 없습니다.";
        targetState.stage.replaceChildren(empty);
        if (targetState.pageCounterLabel) {
          targetState.pageCounterLabel.textContent = `0 / ${targetState.totalCount}`;
        }
        return;
      }

      targetState.renderSeq = (targetState.renderSeq || 0) + 1;
      const renderSeq = targetState.renderSeq;

      const wrap = document.createElement("div");
      wrap.className = `dcmv-page-wrap ${
        step.displayType === "pair" ? "dcmv-page-pair" : "dcmv-page-single"
      }`;

      if (step.displayType === "single" && step.images[0].width > step.images[0].height) {
        wrap.classList.add("dcmv-page-single-landscape");
      }

      let renderImages = step.images;
      if (step.displayType === "pair" && targetState.readingDirectionRTL) {
        renderImages = [step.images[1], step.images[0]];
      }

      const imageReadyPromises = [];

      for (let renderIndex = 0; renderIndex < renderImages.length; renderIndex += 1) {
        const item = renderImages[renderIndex];
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
        img.alt = item.alt || "";
        img.draggable = false;
        imageReadyPromises.push(waitForViewerImageReady(img, item));

        const runInitialAutoAfterFirstViewerImageLoad = () => {
          const state = deps.getState();
          if (!state || state.hasRunInitialAutoAfterFirstImageLoadTrigger) return;
          state.hasRunInitialAutoAfterFirstImageLoadTrigger = true;
          queueMicrotask(() => {
            deps.runInitialAutoWhenReady("첫 이미지 로드 완료");
          });
        };

        if (img.complete && img.naturalWidth) {
          queueMicrotask(() => {
            runInitialAutoAfterFirstViewerImageLoad();
            deps.syncImageLoadingBarPosition();
          });
        } else {
          img.addEventListener(
            "load",
            () => {
              runInitialAutoAfterFirstViewerImageLoad();
              deps.syncImageLoadingBarPosition();
            },
            { once: true }
          );
        }

        img.addEventListener("error", () => {
          deps.handleViewerImageError(item);
          deps.syncImageLoadingBarPosition();
        });

        wrap.appendChild(img);
      }

      Promise.all(imageReadyPromises).then(() => {
        if (!targetState.stage || targetState.renderSeq !== renderSeq) return;
        targetState.stage.replaceChildren(wrap);
        deps.syncImageLoadingBarPosition();
      });
      deps.renderPageCounter(step);
      deps.syncManualResetClearVisibility();
      deps.syncImageLoadingBarPosition();
      deps.preloadNearbySteps();
    },

    renderPageCounter(targetState, step, deps) {
      if (!targetState) return;

      if (step.images.length === 1) {
        targetState.pageCounterLabel.textContent =
          `${step.images[0].displayIndex} / ${targetState.totalCount}`;
        deps.renderPagePicker();
        return;
      }

      targetState.pageCounterLabel.textContent =
        `${step.images[0].displayIndex}, ${step.images[1].displayIndex} / ${targetState.totalCount}`;
      deps.renderPagePicker();
    },

    preloadNearbySteps(targetState) {
      if (!targetState || !targetState.currentStep) return;

      const targets = [targetState.stepIndex + 1, targetState.stepIndex + 2, targetState.stepIndex - 1]
        .filter((i) => i >= 0 && i < targetState.steps.length);

      for (const idx of targets) {
        for (const item of targetState.steps[idx].images) {
          if (item.failed) continue;
          preloadImageItem(item);
        }
      }
    },

    getPrimaryVisiblePageIndex(targetState) {
      const currentStep = recoverRenderableCurrentStep(targetState);
      if (!currentStep?.images?.length) {
        return 0;
      }

      if (currentStep.images.length === 1) {
        return currentStep.images[0].index;
      }

      return targetState.readingDirectionRTL
        ? currentStep.images[currentStep.images.length - 1].index
        : currentStep.images[0].index;
    },

    getCurrentStepRenderUrls(targetState) {
      if (!targetState?.currentStep?.images?.length) return [];

      return targetState.currentStep.images.map((item) => ({
        index: item.index,
        url: item.resolvedSrc || item.src || ""
      }));
    },

    syncCurrentStepImagesFromSourceItems(targetState) {
      if (!targetState?.currentStep?.images?.length) return;

      targetState.currentStep = {
        ...targetState.currentStep,
        images: targetState.currentStep.images.map((item) =>
          targetState.sourceItems[item.index] || item
        )
      };
    },

    didCurrentStepRenderUrlsChange(targetState, previousUrls) {
      if (!Array.isArray(previousUrls) || !previousUrls.length) return false;

      return previousUrls.some((entry) => {
        const nextItem = targetState?.sourceItems?.[entry.index];
        if (!nextItem) return false;
        return (nextItem.resolvedSrc || nextItem.src || "") !== entry.url;
      });
    },

    rebuildStepsForOrientationChange(targetState, primaryPageIndex, deps) {
      if (!targetState) return;

      targetState.steps = deps.buildAllSteps();

      let idx = targetState.steps.findIndex((step) =>
        step.images.some((img) => img.index === primaryPageIndex)
      );

      if (idx < 0) {
        idx = Math.max(0, Math.min(targetState.stepIndex, targetState.steps.length - 1));
      }

      targetState.stepIndex = idx;
      targetState.currentStep = targetState.steps[idx] || null;
    }
  };
})();
