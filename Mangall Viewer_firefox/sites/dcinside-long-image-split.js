(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  const MIN_LONG_IMAGE_RATIO = 2.4;
  // 분수 칸에 넣을 수 있는 아래 숫자 범위. 나중에 바꿀 값.
  const MIN_SPLIT_PARTS = 2;
  const MAX_SPLIT_PARTS = 20;
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

  // 이미 자른 상태에서 뒤늦게 크기가 잡혀 아직 현재 조각 수로 잘리지 않은 긴 이미지 수.
  function getPendingSplitCount(targetState, deps = {}) {
    const splitPartCount = targetState?.longImageSplitPartCount || 0;
    if (splitPartCount <= 0) return 0;

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
        appliedPartCounts.get(sourceIndex) !== getPartCount(item, splitPartCount)
    ).length;
  }

  function getPartCount(item, splitPartCount) {
    if (splitPartCount <= 1) return 1;
    // 원본의 세로 픽셀 수보다 많은 조각을 만들지 않는다.
    return Math.min(splitPartCount, Math.max(1, Math.floor(item.height)));
  }

  // 분수 칸에 들어온 값을 허용 범위의 정수로 맞춘다. 숫자가 아니면 fallback을 쓴다.
  function normalizeSplitPartCount(value, fallback = MIN_SPLIT_PARTS) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(MAX_SPLIT_PARTS, Math.max(MIN_SPLIT_PARTS, parsed));
  }

  function getTargetSplitPartCount(targetState) {
    return normalizeSplitPartCount(targetState?.longImageSplitTargetCount);
  }

  function createViewerSourceItems(physicalItems, splitPartCount, deps = {}) {
    const items = [];
    let splitCount = 0;

    for (let sourceIndex = 0; sourceIndex < physicalItems.length; sourceIndex += 1) {
      const sourceItem = physicalItems[sourceIndex];
      if (splitPartCount > 1 && shouldSplitLongImage(sourceItem, deps)) {
        splitCount += 1;
        const partCount = getPartCount(sourceItem, splitPartCount);

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

    return { items, splitCount };
  }

  // 조각도 원본 긴 이미지 주소를 쓰므로, 공통 메타데이터 확인을 거치면
  // 조각 크기가 원본 전체 크기로 덮어써진다. 그러면 양면 묶기가 조각을
  // 세로로 긴 페이지로 보고 단면으로 빼므로, 확인 직후 조각 크기로 되돌린다.
  function restoreSplitPartSizes(items) {
    for (const item of items || []) {
      const partCount = item?.longImageSplitCount;
      if (!partCount || !item.width || !item.height) continue;

      const expectedHeight = Math.max(1, item.longImageOriginalHeight / partCount);
      if (
        item.width === item.longImageOriginalWidth &&
        item.height === expectedHeight
      ) {
        continue;
      }

      // 조각 크기와 다르면 방금 잰 전체 이미지 크기다(고화질 원본일 수도 있다).
      item.longImageOriginalWidth = item.width;
      item.longImageOriginalHeight = item.height;
      item.height = Math.max(1, item.height / partCount);
      item.longImageSplitAspectRatio = item.width / item.height;
    }
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

  function applyViewerSourceItems(targetState, splitPartCount, deps = {}) {
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
      splitPartCount,
      deps
    );
    targetState.longImageSplitPartCount = splitPartCount;
    targetState.longImageSplitActive = splitPartCount > 1;
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
      const currentPartCount = targetState.longImageSplitPartCount || 0;
      if (!enabled && currentPartCount === 0) {
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
        // 자르기가 실행되지 않으면 설정 메뉴와 HUD를 그대로 유지한다.
        if (options.notify !== false && options.notifyIfNoSplit !== false) {
          deps.showEdgeToast?.("자를 긴 이미지를 찾지 못했습니다.", 2000);
        }
        return null;
      }

      // 분수 칸에서 고른 조각 수로 자른다. 이미 같은 조각 수로 잘려 있어도
      // 뒤늦게 크기가 잡힌 긴 이미지가 있으면 그 이미지들까지 따라 자른다.
      const nextPartCount = enabled ? getTargetSplitPartCount(targetState) : 0;
      const pendingCount = enabled && nextPartCount === currentPartCount
        ? getPendingSplitCount(targetState, deps)
        : 0;
      if (enabled && nextPartCount === currentPartCount && pendingCount === 0) {
        if (options.notify !== false) {
          deps.showEdgeToast?.(`이미 1/${nextPartCount}로 잘려 있습니다.`, 2000);
        }
        if (options.closeMenu !== false) deps.toggleSettingsMenu?.(false);
        return null;
      }

      const result = applyViewerSourceItems(targetState, nextPartCount, deps);
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
          deps.showEdgeToast?.(`새로 불러온 긴 이미지 ${pendingCount}장을 잘랐습니다.`, 2400);
        } else if (result.splitCount > 0) {
          deps.showEdgeToast?.(
            `긴 이미지 ${result.splitCount}장을 각각 ${nextPartCount}페이지로 나눴습니다.`,
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
    normalizeSplitPartCount,
    getTargetSplitPartCount,
    createViewerSourceItems,
    restoreSplitPartSizes,
    findViewerIndexForSource,
    getRenderAspectRatioOverride,
    decorateRenderBox,
    shouldAttachImageComments,
    setActive
  };
})();
