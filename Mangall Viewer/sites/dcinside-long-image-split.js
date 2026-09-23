(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  const MIN_LONG_IMAGE_RATIO = 2.4;

  function getPhysicalSourceItems(targetState) {
    if (!targetState) return [];
    return Array.isArray(targetState.physicalSourceItems)
      ? targetState.physicalSourceItems
      : Array.isArray(targetState.sourceItems)
        ? targetState.sourceItems
        : [];
  }

  function getSourceIndexForViewerItem(item) {
    if (!item) return 0;
    return Number.isInteger(item.sourceIndex) ? item.sourceIndex : item.index;
  }

  function shouldSplitLongImage(item, deps = {}) {
    if (!item?.width || !item?.height) return false;
    if (deps.isPlaceholderSize?.(item)) return false;
    return item.height / item.width >= MIN_LONG_IMAGE_RATIO;
  }

  function createViewerSourceItems(physicalItems, splitEnabled, deps = {}) {
    const items = [];
    let splitCount = 0;

    for (let sourceIndex = 0; sourceIndex < physicalItems.length; sourceIndex += 1) {
      const sourceItem = physicalItems[sourceIndex];
      if (splitEnabled && shouldSplitLongImage(sourceItem, deps)) {
        splitCount += 1;

        // 실제 표시 크기는 고정하지 않고, 분할 페이지의 비율만 보존한다.
        // 창이나 모니터 크기가 바뀌면 이 비율을 기준으로 다시 맞춘다.
        const splitWidth = sourceItem.width;
        const splitHeight = Math.max(1, Math.floor(sourceItem.height / 2));
        const splitAspectRatio = splitWidth / splitHeight;

        for (const part of ["top", "bottom"]) {
          items.push({
            ...sourceItem,
            index: items.length,
            displayIndex: items.length + 1,
            sourceIndex,
            width: splitWidth,
            height: splitHeight,
            longImageSplitPart: part,
            longImageSplitAspectRatio: splitAspectRatio,
            longImageOriginalWidth: sourceItem.width,
            longImageOriginalHeight: sourceItem.height
          });
        }
        continue;
      }

      const {
        longImageSplitPart,
        longImageSplitAspectRatio,
        longImageOriginalWidth,
        longImageOriginalHeight,
        ...plainSourceItem
      } = sourceItem;
      items.push({
        ...plainSourceItem,
        index: items.length,
        displayIndex: items.length + 1,
        sourceIndex
      });
    }

    return { items, splitCount };
  }

  function findViewerIndexForSource(items, sourceIndex, preferredPart = "") {
    if (!Array.isArray(items) || !items.length) return 0;

    if (preferredPart) {
      const exactIndex = items.findIndex(
        (item) =>
          getSourceIndexForViewerItem(item) === sourceIndex &&
          item.longImageSplitPart === preferredPart
      );
      if (exactIndex >= 0) return exactIndex;
    }

    const sourceMatchIndex = items.findIndex(
      (item) => getSourceIndexForViewerItem(item) === sourceIndex
    );
    return sourceMatchIndex >= 0 ? sourceMatchIndex : 0;
  }

  function getRenderAspectRatioOverride(renderBox, item) {
    const aspectRatio =
      Number(item?.longImageSplitAspectRatio) ||
      Number(renderBox?.dataset?.dcmvLongImageSplitAspectRatio) ||
      0;
    const isSplitPage = !!(
      item?.longImageSplitPart ||
      renderBox?.dataset?.dcmvLongImageSplitPart ||
      aspectRatio
    );

    return isSplitPage && aspectRatio > 0 ? aspectRatio : 0;
  }

  function decorateRenderBox(renderBox, item) {
    const part = item?.longImageSplitPart;
    if (!(renderBox instanceof HTMLElement) || (part !== "top" && part !== "bottom")) {
      return;
    }

    renderBox.classList.add(
      "dcmv-image-render-box-split",
      `dcmv-image-render-box-split-${part}`
    );
    renderBox.dataset.dcmvLongImageSplitPart = part;
    renderBox.dataset.dcmvLongImageSplitAspectRatio = `${
      item.longImageSplitAspectRatio || ""
    }`;
  }

  function shouldAttachImageComments(item) {
    return item?.longImageSplitPart !== "top";
  }

  function applyViewerSourceItems(targetState, splitEnabled, deps = {}) {
    const previousItems = Array.isArray(targetState.sourceItems)
      ? targetState.sourceItems
      : [];
    const anchorItem = deps.getPrimaryAnchorItem?.(targetState) || null;
    const anchorSourceIndex = getSourceIndexForViewerItem(anchorItem);
    const anchorPart = anchorItem?.longImageSplitPart || "";
    const resetSourceIndices = (targetState.manualPairingResetIndices || [])
      .map((index) => previousItems[index])
      .filter(Boolean)
      .map(getSourceIndexForViewerItem);

    const result = createViewerSourceItems(
      getPhysicalSourceItems(targetState),
      splitEnabled,
      deps
    );
    targetState.longImageSplitActive = !!splitEnabled;
    targetState.sourceItems = result.items;
    targetState.totalCount = result.items.length;
    targetState.manualPairingResetIndices = Array.from(
      new Set(
        resetSourceIndices.map((sourceIndex) =>
          findViewerIndexForSource(result.items, sourceIndex)
        )
      )
    ).sort((a, b) => a - b);
    deps.saveManualPairingResetIndices?.(targetState.manualPairingResetIndices);

    return {
      ...result,
      anchorIndex: findViewerIndexForSource(
        result.items,
        anchorSourceIndex,
        anchorPart
      )
    };
  }

  async function setActive(targetState, enabled, options = {}, deps = {}) {
    if (!targetState?.isDcinsideSite || targetState.isLongImageSplitRunning) {
      return null;
    }

    targetState.isLongImageSplitRunning = true;
    try {
      if (enabled) {
        await deps.hydrateImageMetadata?.(getPhysicalSourceItems(targetState));
      }
      if (
        deps.getState?.() !== targetState ||
        deps.getRawPageKey?.() !== targetState.pageKey
      ) {
        return null;
      }

      // 자를 이미지가 없으면 분할 상태를 켜지 않는다. 수동 버튼은 계속 "자르기"로 남는다.
      if (
        enabled &&
        !getPhysicalSourceItems(targetState).some((item) =>
          shouldSplitLongImage(item, deps)
        )
      ) {
        if (options.closeMenu !== false) {
          deps.toggleSettingsMenu?.(false);
        }
        if (options.notify !== false && options.notifyIfNoSplit !== false) {
          deps.showEdgeToast?.("자를 긴 이미지를 찾지 못했습니다.", 2000);
        }
        return null;
      }

      const result = applyViewerSourceItems(targetState, enabled, deps);
      deps.rebuildStepsKeepingAnchor?.(result.anchorIndex);
      deps.syncToggleVisuals?.();
      deps.syncManualResetClearVisibility?.();

      if (options.render !== false) {
        deps.renderCurrentStep?.();
        deps.syncHudTrigger?.();
        deps.updateCornerPageCounter?.();
      }
      if (options.closeMenu !== false) {
        deps.toggleSettingsMenu?.(false);
      }

      if (options.notify !== false) {
        if (!enabled) {
          deps.showEdgeToast?.("긴 이미지 자르기를 해제했습니다.", 2000);
        } else if (result.splitCount > 0) {
          deps.showEdgeToast?.(
            `긴 이미지 ${result.splitCount}장을 ${result.splitCount * 2}페이지로 나눴습니다.`,
            2400
          );
        }
      }

      return result;
    } finally {
      if (deps.getState?.() === targetState) {
        targetState.isLongImageSplitRunning = false;
      }
    }
  }

  modules.dcinsideLongImageSplit = {
    getPhysicalSourceItems,
    getSourceIndexForViewerItem,
    createViewerSourceItems,
    findViewerIndexForSource,
    getRenderAspectRatioOverride,
    decorateRenderBox,
    shouldAttachImageComments,
    setActive
  };
})();
