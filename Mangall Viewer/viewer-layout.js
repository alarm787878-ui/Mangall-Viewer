(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  const dcinsideComments = globalThis.__dcmvDcinsideComments || null;
  const MAX_VIEWER_UPSCALE = 1.5;

  function sizeViewerRenderBox(renderBox, item, displayType = "single") {
    if (!(renderBox instanceof HTMLElement)) {
      return;
    }

    const imageElement = renderBox.querySelector(":scope > .dcmv-image");
    if (!(imageElement instanceof HTMLImageElement)) {
      return;
    }

    const width = imageElement.naturalWidth;
    const height = imageElement.naturalHeight;

    if (!width || !height) {
      renderBox.style.removeProperty("width");
      renderBox.style.removeProperty("height");
      return;
    }

    const availableWidth =
      displayType === "pair"
        ? Math.max(0, Math.floor(window.innerWidth / 2) - 4)
        : Math.max(0, window.innerWidth - 4);
    const availableHeight = Math.max(0, window.innerHeight - 4);
    if (!availableWidth || !availableHeight) {
      return;
    }

    const scale = Math.min(
      MAX_VIEWER_UPSCALE,
      availableWidth / width,
      availableHeight / height
    );
    if (!Number.isFinite(scale) || scale <= 0) {
      return;
    }

    renderBox.style.width = `${Math.max(1, Math.floor(width * scale))}px`;
    renderBox.style.height = `${Math.max(1, Math.floor(height * scale))}px`;
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

      dcinsideComments?.restoreMovedCommentRoots?.();

      const step = targetState.currentStep;

      if (!step || !step.images.length) {
        const empty = document.createElement("div");
        empty.className = "dcmv-empty";
        empty.textContent = "표시할 페이지가 없습니다.";
        targetState.stage.replaceChildren(empty);
        targetState.pageCounter.textContent = `0 / ${targetState.totalCount}`;
        return;
      }

      targetState.stage.replaceChildren();

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

      let layoutRefreshCoalesced = false;
      const scheduleStepLayoutRefresh = () => {
        if (layoutRefreshCoalesced) return;
        layoutRefreshCoalesced = true;
        queueMicrotask(() => {
          layoutRefreshCoalesced = false;
          deps.refreshViewerStepLayout?.();
        });
      };

      for (let renderIndex = 0; renderIndex < renderImages.length; renderIndex += 1) {
        const item = renderImages[renderIndex];
        const pagePosition =
          step.displayType === "pair"
            ? renderIndex === 0
              ? "left"
              : "right"
            : "single";

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
          const state = deps.getState();
          if (!state || state.hasLoggedFirstViewerImageLoad) return;
          state.hasLoggedFirstViewerImageLoad = true;
          queueMicrotask(() => {
            deps.runInitialAutoWhenReady("첫 이미지 로드 완료");
          });
        };

        if (img.complete && img.naturalWidth) {
          queueMicrotask(() => {
            logFirstViewerImageLoad();
            deps.syncImageLoadingBarPosition();
            scheduleStepLayoutRefresh();
          });
        } else {
          img.addEventListener(
            "load",
            () => {
              logFirstViewerImageLoad();
              deps.syncImageLoadingBarPosition();
              scheduleStepLayoutRefresh();
            },
            { once: true }
          );
        }

        if (item.resolvedSrc && item.src && item.resolvedSrc !== item.src) {
          img.addEventListener(
            "error",
            () => {
              img.src = item.src;
              img.addEventListener(
                "load",
                () => {
                  scheduleStepLayoutRefresh();
                },
                { once: true }
              );
            },
            { once: true }
          );
        }

        img.addEventListener("error", () => {
          deps.handleViewerImageError(item);
          deps.syncImageLoadingBarPosition();
        });

        wrap.appendChild(
          wrapViewerImageWithComments({
            imageElement: img,
            item,
            pagePosition,
            targetState,
            displayType: step.displayType
          })
        );
      }

      targetState.stage.appendChild(wrap);
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
          const img = new Image();
          img.src = item.resolvedSrc || item.src || "";
        }
      }
    },

    getPrimaryVisiblePageIndex(targetState) {
      if (!targetState || !targetState.currentStep || !targetState.currentStep.images.length) {
        return 0;
      }

      if (targetState.currentStep.images.length === 1) {
        return targetState.currentStep.images[0].index;
      }

      return targetState.readingDirectionRTL
        ? targetState.currentStep.images[targetState.currentStep.images.length - 1].index
        : targetState.currentStep.images[0].index;
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
    },

    refreshCurrentStepRenderBoxes(targetState) {
      if (!targetState?.stage || !targetState?.currentStep?.images?.length) return;

      const renderBoxes = targetState.stage.querySelectorAll(".dcmv-image-render-box");
      for (const renderBox of renderBoxes) {
        if (!(renderBox instanceof HTMLElement)) continue;
        const itemIndex = Number(renderBox.dataset.dcmvImageIndex);
        if (!Number.isInteger(itemIndex)) continue;
        const item = targetState.currentStep.images.find((entry) => entry.index === itemIndex);
        if (!item) continue;
        sizeViewerRenderBox(renderBox, item, renderBox.dataset.dcmvDisplayType || targetState.currentStep.displayType || "single");
      }
    }
  };

  function buildViewerRenderBox(imageElement, item, displayType = "single") {
    if (!(imageElement instanceof HTMLElement)) {
      return imageElement;
    }

    const renderBox = document.createElement("div");
    renderBox.className = "dcmv-image-render-box";
    renderBox.dataset.dcmvImageIndex = `${item?.index ?? ""}`;
    renderBox.dataset.dcmvDisplayType = displayType;
    renderBox.appendChild(imageElement);

    sizeViewerRenderBox(renderBox, item, displayType);
    return renderBox;
  }

  function wrapViewerImageWithComments(options = {}) {
    const { imageElement, item, pagePosition, targetState, displayType = "single" } = options;

    if (!(imageElement instanceof HTMLElement)) {
      return imageElement;
    }

    const renderBox = buildViewerRenderBox(imageElement, item, displayType);

    if (!targetState?.isDcinsideSite || !targetState?.showImageComments || !dcinsideComments) {
      return renderBox;
    }

      const isCollapsed =
        dcinsideComments.isCommentCollapsedForSource?.(item?.element) || false;
      const comments = isCollapsed
        ? []
        : dcinsideComments.collectImageCommentsForSourceItem?.(item?.element);
      const originalCommentRoot = dcinsideComments.findOriginalCommentRoot?.(item?.element) || null;
      const emptyCommentButton =
        dcinsideComments.findEmptyCommentOpenButton?.(item?.element) || null;
      const commentKey = dcinsideComments.getCommentSourceKey?.(item?.element) || "";
      const hasComments = Array.isArray(comments) && comments.length > 0;

      const side = dcinsideComments.getCommentSide?.({ pagePosition }) || "right";
      return (
        dcinsideComments.wrapImageWithComments?.({
          imageElement,
          sourceElement: item?.element || null,
          comments: hasComments ? comments : [],
          side,
          titleText: `이미지 댓글 ${hasComments ? comments.length : 0}개`,
          originalCommentRoot,
          emptyCommentButton,
          commentKey
        }) || renderBox
      );
  }
})();
