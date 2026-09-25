(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  const MIN_LONG_IMAGE_RATIO = 2.4;
  const MAX_SPLIT_DEPTH = 8;
  const SIZE_PROBE_TIMEOUT_MS = 3000;

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

  // 크기가 없거나, 디시 자리표시(200×200)이거나, 불러오기 실패로 기본값이 채워진 경우.
  // 공용 메타데이터 확인은 실패하면 1200×1700을 채우므로 그 크기도 다시 확인한다.
  // 실제로 1200×1700인 이미지는 어차피 긴 이미지가 아니라 다시 확인해도 결과가 같다.
  function hasUnknownSize(item, deps = {}) {
    return !item?.width || !item?.height || item.hasKnownSourceSize === false ||
      (item.width === 1200 && item.height === 1700) ||
      !!deps.isPlaceholderSize?.(item);
  }

  // 자르기 판단에는 비율만 필요하므로 게시판 이미지 크기만 잰다.
  // 고화질 원본 확인은 기존 복구 단계가 따로 맡는다.
  function probeImageSize(item) {
    return new Promise((resolve) => {
      if (!item?.src) {
        resolve();
        return;
      }

      const probe = new Image();
      let timer = 0;
      const finish = () => {
        clearTimeout(timer);
        probe.onload = null;
        probe.onerror = null;
        resolve();
      };
      probe.onload = () => {
        if (probe.naturalWidth && probe.naturalHeight) {
          item.width = probe.naturalWidth;
          item.height = probe.naturalHeight;
          item.hasKnownSourceSize = true;
        }
        finish();
      };
      probe.onerror = finish;
      timer = setTimeout(finish, SIZE_PROBE_TIMEOUT_MS);
      try {
        probe.src = item.src;
      } catch {
        finish();
      }
    });
  }

  // 복구 단계의 메타데이터 확인은 화면용 복사본에 크기를 채운다.
  // 안 잘린 복사본이 알아낸 실제 크기를 원본 목록에도 옮겨 다음 자르기 판단에 쓴다.
  function syncKnownSizesFromViewerItems(targetState, deps = {}) {
    const physicalItems = getPhysicalSourceItems(targetState);
    for (const viewerItem of targetState?.sourceItems || []) {
      if (viewerItem.longImageSplitCount || hasUnknownSize(viewerItem, deps)) continue;
      const physicalItem = physicalItems[getSourceIndexForViewerItem(viewerItem)];
      if (!physicalItem || physicalItem === viewerItem || !hasUnknownSize(physicalItem, deps)) {
        continue;
      }
      physicalItem.width = viewerItem.width;
      physicalItem.height = viewerItem.height;
      physicalItem.hasKnownSourceSize = true;
    }
  }

  // 이미 자른 상태에서 뒤늦게 크기가 잡혀 아직 현재 단계로 잘리지 않은 긴 이미지 수.
  function getPendingSplitCount(targetState, deps = {}) {
    const splitDepth = targetState?.longImageSplitDepth || 0;
    if (splitDepth <= 0) return 0;

    syncKnownSizesFromViewerItems(targetState, deps);
    const appliedPartCounts = new Map();
    for (const viewerItem of targetState.sourceItems || []) {
      if (viewerItem.longImageSplitCount) {
        appliedPartCounts.set(
          getSourceIndexForViewerItem(viewerItem),
          viewerItem.longImageSplitCount
        );
      }
    }

    return getPhysicalSourceItems(targetState).filter(
      (item, sourceIndex) => shouldSplitLongImage(item, deps) &&
        appliedPartCounts.get(sourceIndex) !== getPartCount(item, splitDepth)
    ).length;
  }

  function getPartCount(item, splitDepth) {
    if (splitDepth <= 0) return 1;
    // 원본의 세로 픽셀 수보다 많은 조각을 만들지 않는다.
    const maxPartsForImage = 2 ** Math.floor(Math.log2(Math.max(2, item.height)));
    return Math.min(2 ** Math.min(splitDepth, MAX_SPLIT_DEPTH), maxPartsForImage);
  }

  function getNextSplitPartCount(targetState, deps = {}) {
    const currentDepth = targetState?.longImageSplitDepth || 0;
    if (currentDepth === 0) return 2;
    // 뒤늦게 크기가 잡혀 아직 안 잘린 긴 이미지가 있으면 버튼은 그 이미지들을
    // 현재 단계로 자르므로, 라벨도 다음 단계가 아니라 현재 단계를 보여준다.
    if (getPendingSplitCount(targetState, deps) > 0) return 2 ** currentDepth;
    if (currentDepth >= MAX_SPLIT_DEPTH) return 0;
    const nextDepth = currentDepth + 1;
    return getPhysicalSourceItems(targetState).some(
      (item) => shouldSplitLongImage(item, deps) &&
        getPartCount(item, nextDepth) > getPartCount(item, currentDepth)
    ) ? 2 ** nextDepth : 0;
  }

  function createViewerSourceItems(physicalItems, splitDepth, deps = {}) {
    const items = [];
    let splitCount = 0;
    let advancedCount = 0;

    for (let sourceIndex = 0; sourceIndex < physicalItems.length; sourceIndex += 1) {
      const sourceItem = physicalItems[sourceIndex];
      if (splitDepth > 0 && shouldSplitLongImage(sourceItem, deps)) {
        splitCount += 1;
        // 수동 버튼을 다시 누를 때마다 같은 원본을 두 배로 세분화한다.
        const partCount = getPartCount(sourceItem, splitDepth);
        if (partCount > getPartCount(sourceItem, splitDepth - 1)) {
          advancedCount += 1;
        }

        // 실제 표시 크기는 고정하지 않고, 분할 페이지의 비율만 보존한다.
        // 창이나 모니터 크기가 바뀌면 이 비율을 기준으로 다시 맞춘다.
        const splitWidth = sourceItem.width;
        const splitHeight = Math.max(1, sourceItem.height / partCount);
        const splitAspectRatio = splitWidth / splitHeight;

        for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
          const part = partIndex === 0 ? "top" : partIndex === partCount - 1
            ? "bottom" : `middle-${partIndex}`;
          items.push({
            ...sourceItem,
            index: items.length,
            displayIndex: items.length + 1,
            sourceIndex,
            width: splitWidth,
            height: splitHeight,
            longImageSplitPart: part,
            longImageSplitIndex: partIndex,
            longImageSplitCount: partCount,
            longImageSplitAspectRatio: splitAspectRatio,
            longImageOriginalWidth: sourceItem.width,
            longImageOriginalHeight: sourceItem.height
          });
        }
        continue;
      }

      const {
        longImageSplitPart,
        longImageSplitIndex,
        longImageSplitCount,
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

    return { items, splitCount, advancedCount };
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
    const partCount = item?.longImageSplitCount;
    const partIndex = item?.longImageSplitIndex;
    if (!(renderBox instanceof HTMLElement) || !partCount || !Number.isInteger(partIndex)) {
      return;
    }

    renderBox.classList.add("dcmv-image-render-box-split");
    renderBox.style.setProperty("--dcmv-split-image-height", `${partCount * 100}%`);
    renderBox.style.setProperty("--dcmv-split-image-top", `${-partIndex * 100}%`);
    renderBox.dataset.dcmvLongImageSplitPart = item.longImageSplitPart;
    renderBox.dataset.dcmvLongImageSplitAspectRatio = `${
      item.longImageSplitAspectRatio || ""
    }`;
  }

  function shouldAttachImageComments(item) {
    return !item?.longImageSplitCount ||
      item.longImageSplitIndex === item.longImageSplitCount - 1;
  }

  function applyViewerSourceItems(targetState, splitDepth, deps = {}) {
    const previousItems = Array.isArray(targetState.sourceItems)
      ? targetState.sourceItems
      : [];
    const anchorItem = deps.getPrimaryAnchorItem?.(targetState) || null;
    const anchorSourceIndex = getSourceIndexForViewerItem(anchorItem);
    const anchorFraction = (anchorItem?.longImageSplitIndex || 0) /
      (anchorItem?.longImageSplitCount || 1);
    const resetSourceIndices = (targetState.manualPairingResetIndices || [])
      .map((index) => previousItems[index])
      .filter(Boolean)
      .map(getSourceIndexForViewerItem);

    const result = createViewerSourceItems(
      getPhysicalSourceItems(targetState),
      splitDepth,
      deps
    );
    targetState.longImageSplitDepth = splitDepth;
    targetState.longImageSplitActive = splitDepth > 0;
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

    const sourceStartIndex = findViewerIndexForSource(result.items, anchorSourceIndex);
    const sourcePartCount = result.items.filter(
      (item) => getSourceIndexForViewerItem(item) === anchorSourceIndex
    ).length;

    return {
      ...result,
      anchorIndex: sourceStartIndex + Math.min(
        Math.max(0, sourcePartCount - 1),
        Math.floor(anchorFraction * sourcePartCount)
      )
    };
  }

  async function setActive(targetState, enabled, options = {}, deps = {}) {
    if (!targetState?.isDcinsideSite || targetState.isLongImageSplitRunning) {
      return null;
    }

    targetState.isLongImageSplitRunning = true;
    try {
      const currentDepth = targetState.longImageSplitDepth || 0;
      if (!enabled && currentDepth === 0) {
        if (options.closeMenu !== false) deps.toggleSettingsMenu?.(false);
        return null;
      }

      if (enabled) {
        // 자르기 판단에는 비율만 필요하므로 크기를 모르는 이미지만 확인한다.
        // 고화질 원본까지 기다리면 모든 원본 다운로드가 끝날 때까지 자르기가 멈춘다.
        syncKnownSizesFromViewerItems(targetState, deps);
        const unknownSizeItems = getPhysicalSourceItems(targetState).filter(
          (item) => hasUnknownSize(item, deps)
        );
        if (unknownSizeItems.length) {
          await Promise.all(unknownSizeItems.map(probeImageSize));
        }
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

      // 이미 자른 상태에서 뒤늦게 크기가 잡힌 긴 이미지가 있으면
      // 단계를 올리지 않고 그 이미지들만 현재 단계로 따라 자른다.
      const pendingCount = enabled ? getPendingSplitCount(targetState, deps) : 0;
      let nextDepth = 0;
      if (enabled && (currentDepth === 0 || pendingCount > 0)) {
        nextDepth = Math.max(1, currentDepth);
      } else if (enabled && options.advance === true) {
        if (currentDepth >= MAX_SPLIT_DEPTH || !getNextSplitPartCount(targetState, deps)) {
          if (options.closeMenu !== false) deps.toggleSettingsMenu?.(false);
          if (options.notify !== false) {
            deps.showEdgeToast?.("더 자를 긴 이미지를 찾지 못했습니다.", 2000);
          }
          return null;
        }
        nextDepth = currentDepth + 1;
      } else if (enabled) {
        if (options.closeMenu !== false) deps.toggleSettingsMenu?.(false);
        return null;
      }

      const result = applyViewerSourceItems(targetState, nextDepth, deps);
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
        } else if (pendingCount > 0) {
          // 따라 자른 뒤에는 남은 이미지가 없으므로 다음 단계 조각 수가 나온다.
          const nextPartCount = getNextSplitPartCount(targetState, deps);
          deps.showEdgeToast?.(
            `새로 불러온 긴 이미지 ${pendingCount}장을 잘랐습니다.` +
              (nextPartCount > 0 ? ` 1/${nextPartCount}로 자르려면 다시 눌러주세요.` : ""),
            nextPartCount > 0 ? 3200 : 2400
          );
        } else if (nextDepth > 1) {
          deps.showEdgeToast?.(
            `긴 이미지 ${result.advancedCount}장을 각각 ${2 ** nextDepth}페이지로 나눴습니다.`,
            2400
          );
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
    shouldSplitLongImage,
    getNextSplitPartCount,
    createViewerSourceItems,
    findViewerIndexForSource,
    getRenderAspectRatioOverride,
    decorateRenderBox,
    shouldAttachImageComments,
    setActive
  };
})();
