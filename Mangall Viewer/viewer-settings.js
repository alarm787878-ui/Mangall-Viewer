(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  const DEFAULT_SETTINGS = {
    readingDirectionRTL: true,
    spreadEnabled: true,
    firstPageSingle: true,
    useWasd: true,
    autoFirstPageAdjust: false,
    showImageComments: false,
    alwaysShowComments: true,
    autoFullscreen: false,
    forceBelowMode: false,
    showCornerPageCounter: false
  };
  const SETTING_FIELDS = [
    "readingDirectionRTL",
    "spreadEnabled",
    "firstPageSingle",
    "useWasd",
    "autoFirstPageAdjust",
    "showImageComments",
    "alwaysShowComments",
    "autoFullscreen",
    "forceBelowMode",
    "showCornerPageCounter"
  ];

  modules.settings = {
    getStorageArea() {
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.local
      ) {
        return null;
      }

      return chrome.storage.local;
    },

    loadSettings(storageKeys) {
      return new Promise((resolve) => {
        const storageArea = this.getStorageArea();
        if (!storageArea) {
          resolve({ ...DEFAULT_SETTINGS });
          return;
        }

        storageArea.get(
          [
            storageKeys.readingDirectionRTL,
            storageKeys.spreadEnabled,
            storageKeys.firstPageSingle,
            storageKeys.useWasd,
            storageKeys.autoFirstPageAdjust,
            storageKeys.showImageComments,
            storageKeys.alwaysShowComments,
            storageKeys.autoFullscreen,
            storageKeys.forceBelowMode,
            storageKeys.showCornerPageCounter
          ],
          (result) => {
            const nextSettings = {};

            for (const field of SETTING_FIELDS) {
              const storageKey = storageKeys[field];
              if (!storageKey) continue;
              const savedValue = result[storageKey];
              const nextValue =
                savedValue === undefined ? DEFAULT_SETTINGS[field] : !!savedValue;

              nextSettings[field] = nextValue;
            }

            resolve(nextSettings);
          }
        );
      });
    },

    saveSettings(storageKeys, settings) {
      return new Promise((resolve) => {
        const storageArea = this.getStorageArea();
        if (!storageArea) {
          resolve();
          return;
        }

        // 부분 업데이트: 전달된 키-값만 저장, 기존 값은 건드리지 않음
        const dataToSave = {};
        for (const [field, value] of Object.entries(settings)) {
          const storageKey = storageKeys[field];
          if (!storageKey) continue;
          // undefined가 아닌 값만 저장 (의도적인 삭제가 아닌 이상)
          if (value !== undefined) {
            dataToSave[storageKey] = !!value;
          }
        }

        // 전달된 값이 없으면 아무것도 하지 않음
        if (Object.keys(dataToSave).length === 0) {
          resolve();
          return;
        }

        storageArea.set(dataToSave, () => resolve());
      });
    },

    // 초기화/마이그레이션용: 전체 설정을 DEFAULT_SETTINGS와 병합하여 통째로 저장
    saveAllSettings(storageKeys, settings) {
      return new Promise((resolve) => {
        const storageArea = this.getStorageArea();
        if (!storageArea) {
          resolve();
          return;
        }

        const dataToSave = {};
        for (const field of SETTING_FIELDS) {
          const storageKey = storageKeys[field];
          if (!storageKey) continue;
          const value = settings[field];
          dataToSave[storageKey] =
            value === undefined ? DEFAULT_SETTINGS[field] : !!value;
        }

        storageArea.set(dataToSave, () => resolve());
      });
    },

    syncToggleVisuals(targetState, deps) {
      if (!targetState) return;

      targetState.spreadToggle.classList.toggle(
        deps.toggleActiveClass,
        targetState.spreadEnabled
      );
      targetState.spreadToggle.querySelector(".dcmv-toggle-label").textContent =
        targetState.spreadEnabled ? "양면으로 보기" : "단면으로 보기";
      targetState.firstSingleCheckbox.checked = targetState.firstPageSingle;
      targetState.firstSingleToggle.classList.toggle(
        deps.toggleActiveClass,
        targetState.firstPageSingle
      );
      targetState.settingsRtlValue.textContent = targetState.readingDirectionRTL
        ? "좌←우"
        : "좌→우";
      targetState.settingsRtlButton.classList.toggle(
        deps.toggleActiveClass,
        targetState.readingDirectionRTL
      );
      targetState.settingsUseWasdButton.querySelector(
        ".dcmv-settings-item-label"
      ).textContent = "wasd로 이동";
      targetState.settingsUseWasdButton.classList.toggle(
        deps.toggleActiveClass,
        targetState.useWasd
      );
      targetState.settingsUseWasdButton.setAttribute(
        "aria-pressed",
        targetState.useWasd ? "true" : "false"
      );
      targetState.settingsAutoFirstPageButton.querySelector(
        ".dcmv-settings-item-label"
      ).textContent = "첫 페이지가 단면 자동 조정";
      targetState.settingsAutoFirstPageButton.classList.toggle(
        deps.toggleActiveClass,
        targetState.autoFirstPageAdjust
      );
      targetState.settingsAutoFirstPageButton?.setAttribute(
        "aria-pressed",
        targetState.autoFirstPageAdjust ? "true" : "false"
      );
      if (targetState.settingsCornerCounterButton) {
        targetState.settingsCornerCounterButton.querySelector(
          ".dcmv-settings-item-label"
        ).textContent = "페이지 수 항상 표시";
        targetState.settingsCornerCounterButton.classList.toggle(
          deps.toggleActiveClass,
          !!targetState.showCornerPageCounter
        );
        targetState.settingsCornerCounterButton.setAttribute(
          "aria-pressed",
          targetState.showCornerPageCounter ? "true" : "false"
        );
      }
      targetState.settingsAutoFullscreenButton?.classList.toggle(
        deps.toggleActiveClass,
        targetState.autoFullscreen !== false
      );
      targetState.settingsAutoFullscreenButton?.setAttribute(
        "aria-pressed",
        targetState.autoFullscreen !== false ? "true" : "false"
      );
      if (targetState.settingsImageCommentsButton) {
        const shouldShowImageCommentsSetting = !!targetState.isDcinsideSite;
        targetState.settingsImageCommentsButton.hidden = !shouldShowImageCommentsSetting;
        targetState.settingsImageCommentsButton.querySelector(
          ".dcmv-settings-item-label"
        ).textContent = "이미지 댓글 표시";
        targetState.settingsImageCommentsButton.classList.toggle(
          deps.toggleActiveClass,
          !!targetState.showImageComments
        );
        targetState.settingsImageCommentsButton.setAttribute(
          "aria-pressed",
          targetState.showImageComments ? "true" : "false"
        );
      }

      deps.syncManualResetClearVisibility();
      deps.syncNavButtonLabels();
    },

    syncManualResetClearVisibility(targetState) {
      if (!targetState?.settingsManualResetClearButton) return;

      const hasAnyManualReset =
        Array.isArray(targetState.manualPairingResetIndices) &&
        targetState.manualPairingResetIndices.length > 0;

      targetState.settingsManualResetClearButton.hidden = !hasAnyManualReset;
    },

    syncNavButtonLabels(targetState) {
      if (!targetState) return;

      targetState.prevButton.querySelector(".dcmv-nav-btn-label").textContent =
        targetState.readingDirectionRTL ? "다음" : "이전";
      targetState.nextButton.querySelector(".dcmv-nav-btn-label").textContent =
        targetState.readingDirectionRTL ? "이전" : "다음";
    },

    getCurrentPageKey() {
      return `${location.origin}${location.pathname}${location.search}`;
    },

    loadSavedReopenedViewerPageKey(sessionKey) {
      try {
        const raw = window.sessionStorage.getItem(sessionKey);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed?.pageKey || "";
      } catch {
        return "";
      }
    },

    hasReopenedViewerPageKey(reopenedViewerPageKey, pageKey, deps) {
      if (reopenedViewerPageKey === pageKey) return true;
      return deps.loadSavedReopenedViewerPageKey() === pageKey;
    },

    rememberReopenedViewerPageKey(pageKey, deps) {
      deps.setReopenedViewerPageKey(pageKey);

      try {
        window.sessionStorage.setItem(
          deps.reopenedViewerPageSessionKey,
          JSON.stringify({ pageKey })
        );
      } catch {
      }
    },

    loadSavedManualPairingResetIndices(pageKey, sessionKey) {
      try {
        const raw = window.sessionStorage.getItem(sessionKey);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || parsed.pageKey !== pageKey) return null;
        return Array.isArray(parsed.indices)
          ? parsed.indices.filter((index) => Number.isInteger(index) && index >= 0)
          : null;
      } catch {
        return null;
      }
    },

    saveManualPairingResetIndices(pageKey, sessionKey, indices) {
      try {
        window.sessionStorage.setItem(
          sessionKey,
          JSON.stringify({
            pageKey,
            indices: Array.isArray(indices) ? indices : []
          })
        );
      } catch {
      }
    },

    clearSavedManualPairingResetIndices(targetState, sessionKey) {
      if (targetState) {
        targetState.manualPairingResetIndices = [];
      }
      try {
        window.sessionStorage.removeItem(sessionKey);
      } catch {
      }
    },

    loadAutoFirstPageSingleSession(sessionKey) {
      try {
        const raw = window.sessionStorage.getItem(sessionKey);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },

    loadSavedAutoFirstPageSingleValue(pageKey, deps) {
      const saved = deps.loadAutoFirstPageSingleSession();
      if (!saved || saved.pageKey !== pageKey) return null;
      if (typeof saved.value !== "boolean") return null;
      return saved.value;
    },

    shouldApplyInitialFirstPageSingleAuto(pageKey, deps) {
      try {
        const saved = deps.loadAutoFirstPageSingleSession();
        return !saved || saved.pageKey !== pageKey;
      } catch {
        return true;
      }
    },

    saveAutoAdjustedFirstPageSingleValue(pageKey, sessionKey, value) {
      try {
        window.sessionStorage.setItem(
          sessionKey,
          JSON.stringify({
            pageKey,
            value: !!value
          })
        );
      } catch {
        // 자동 조정 결과 저장에 실패해도 뷰어 동작은 유지한다.
      }
    },

    chooseInitialFirstPageSinglePreference(targetState, preferredValue, options, deps) {
      if (!targetState?.spreadEnabled) return preferredValue;
      const isInitialPhase = options.phase === "1차 판정";
      const rawEvaluationItems = options.evaluationItems || targetState.sourceItems;
      const evaluationItems = isInitialPhase
        ? rawEvaluationItems.map((item) =>
            deps.isDcPlaceholderSize(item)
              ? { ...item, width: 0, height: 0 }
              : item
          )
        : rawEvaluationItems;
      const landscapeItems = evaluationItems.filter((item) => deps.isLandscape(item));
      if (!landscapeItems.length) {
        return preferredValue;
      }
      if (
        landscapeItems.length === 1 &&
        landscapeItems[0].index === evaluationItems.length - 1
      ) {
        return preferredValue;
      }

      const stepsWithSingle = deps.buildAllSteps(true, evaluationItems);
      const stepsWithoutSingle = deps.buildAllSteps(false, evaluationItems);

      const scoreWithSingle = deps.countLandscapeAdjacentSinglePortraitSteps(
        stepsWithSingle,
        evaluationItems
      );
      const scoreWithoutSingle = deps.countLandscapeAdjacentSinglePortraitSteps(
        stepsWithoutSingle,
        evaluationItems
      );

      if (scoreWithSingle === scoreWithoutSingle) {
        return preferredValue;
      }
      return scoreWithSingle < scoreWithoutSingle;
    },

    applyInitialFirstPageSingleAuto(targetState, preferredValue, deps) {
      if (
        !targetState ||
        !targetState.autoFirstPageAdjust ||
        targetState.hasUserAdjustedFirstPageSingle ||
        !deps.shouldApplyInitialFirstPageSingleAuto()
      ) {
        return false;
      }

      const evaluationItems = targetState.sourceItems.slice(0, deps.initialAutoEvalPageLimit);
      const nextValue = deps.chooseInitialFirstPageSinglePreference(preferredValue, {
        phase: "1차 판정",
        evaluationItems
      });
      targetState.firstPageSingle = nextValue;

      if (nextValue === preferredValue) {
        return false;
      }

      targetState.didAutoAdjustFirstPageSingle = true;
      deps.saveAutoAdjustedFirstPageSingleValue(nextValue);
      return true;
    },

    countLandscapeAdjacentSinglePortraitSteps(steps, sourceItems, deps) {
      if (!Array.isArray(steps)) return 0;

      let count = 0;
      const lastIndex = Math.max(0, sourceItems.length - 1 || 0);
      const leadingBoundaryIndex = deps.getLeadingBoundaryExclusionIndex(sourceItems);

      for (const step of steps) {
        if (!step || step.displayType !== "single" || step.images.length !== 1) {
          continue;
        }

        const item = step.images[0];
        if (!item || deps.isLandscape(item)) continue;
        if (item.index === leadingBoundaryIndex || item.index === lastIndex) continue;

        const prevItem = sourceItems[item.index - 1] || null;
        const nextItem = sourceItems[item.index + 1] || null;
        const hasLandscapeNeighbor =
          (!!prevItem && deps.isLandscape(prevItem)) ||
          (!!nextItem && deps.isLandscape(nextItem));

        if (hasLandscapeNeighbor) count += 1;
      }

      return count;
    },

    getLeadingBoundaryExclusionIndex(items, deps) {
      const maxIndex = Math.min(2, items.length - 1);

      for (let i = 0; i <= maxIndex; i += 1) {
        if (!deps.isLandscape(items[i])) {
          return i;
        }
      }

      return 0;
    }
  };
})();
