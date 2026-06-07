(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});

  modules.navigation = {
    bindEvents(targetState, deps) {
      const escHandler = (e) => {
        const state = deps.getState();
        if (!state) return;

        if (e.key === "Escape") {
          state.lastEscapeKeyAt = Date.now();
          e.preventDefault();
          e.stopPropagation();
          deps.closeViewer();
        }
      };

      const escKeyupHandler = (e) => {
        const state = deps.getState();
        if (!state) return;

        if (e.key === "Escape") {
          state.lastEscapeKeyAt = Date.now();
          e.preventDefault();
          e.stopPropagation();
          deps.closeViewer();
        }
      };

      const markFullscreenExitGestureIntent = () => {
        const state = deps.getState();
        if (!state) return;
        if (!(document.fullscreenElement || document.webkitFullscreenElement)) return;
        state.lastFullscreenExitGestureAt = Date.now();
      };

      const keydown = (e) => {
        const state = deps.getState();
        if (!state) return;
        if (deps.shouldIgnoreKeydown(e)) return;

        if (state.isPagePickerOpen) {
          if (deps.handlePagePickerKeydown(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        if (handleViewerShortcut(e)) return;

        const logicalNav = deps.getLogicalNavigationForKey(e);
        if (!logicalNav) return;

        e.preventDefault();

        if (logicalNav === "next") {
          deps.goNext();
          return;
        }

        deps.goPrev();
      };

      const wheel = (e) => {
        const state = deps.getState();
        if (!state) return;
        if (e.isTrusted === false) return;

        if (canScrollInsideCommentPanel(e.target, e.deltaY)) {
          e.stopPropagation();
          return;
        }

        if (state.isPagePickerOpen) {
          if (state.pagePicker.contains(e.target)) {
            e.stopPropagation();
            return;
          }

          e.preventDefault();
          return;
        }

        const insideHudZone = deps.isPointerInsideHudTrigger(e.clientX, e.clientY);
        deps.updateHudHoverState(insideHudZone);

        if (insideHudZone) {
          clearTimeout(state.cursorHideTimer);
          deps.showCursor();
        }

        e.preventDefault();

        if (Math.abs(e.deltaY) < 4) return;

        if (e.deltaY > 0) deps.goNext();
        else deps.goPrev();
      };

      const mousemove = (e) => {
        if (!deps.getState()) return;

        const movedSignificantly = deps.hasPointerMovedSignificantly(
          e.clientX,
          e.clientY
        );

        if (movedSignificantly) {
          deps.showCursor();
        }

        deps.rememberPointerPosition(e.clientX, e.clientY);
        deps.scheduleCursorHide();

        const inside = deps.isPointerInsideHudTrigger(e.clientX, e.clientY);
        deps.updateHudHoverState(inside);
      };

      const docMouseleave = () => {
        if (!deps.getState()) return;
        deps.updateHudHoverState(false);
      };

      const resize = () => {
        if (!deps.getState()) return;
        deps.refreshCurrentStepRenderBoxes?.();
        deps.syncHudTrigger();
        deps.syncImageLoadingBarPosition();
      };

      const fullscreenchange = () => {
        const state = deps.getState();
        if (!state) return;

        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (!isFullscreen && state.ignoreNextFullscreenExitClose) {
          state.ignoreNextFullscreenExitClose = false;
        } else if (
          !isFullscreen &&
          state.autoFullscreen !== false &&
          !state.wasAlreadyFullscreen
        ) {
          const now = Date.now();
          const escapedRecently = now - (state.lastEscapeKeyAt || 0) < 1500;
          const gestureRecently = now - (state.lastFullscreenExitGestureAt || 0) < 1500;

          // 브라우저가 전체화면 ESC를 먼저 먹으면 keydown이 안 올 수 있다.
          // 최근 포인터/터치 입력이 없던 전체화면 해제만 ESC로 보고 뷰어까지 닫는다.
          if (escapedRecently || !gestureRecently) {
            deps.closeViewer();
            return;
          }
        }

        deps.refreshCurrentStepRenderBoxes?.();
        deps.syncHudTrigger();
        deps.syncImageLoadingBarPosition();
      };

      const hudMouseenter = (e) => {
        if (!deps.getState()) return;
        deps.rememberPointerPosition(e.clientX, e.clientY);
        deps.updateHudHoverState(deps.isPointerInsideHudTrigger(e.clientX, e.clientY));
        clearTimeout(deps.getState().cursorHideTimer);
        deps.showCursor();
      };

      const hudMouseleave = (e) => {
        if (!deps.getState()) return;
        deps.rememberPointerPosition(e.clientX, e.clientY);
        deps.updateHudHoverState(deps.isPointerInsideHudTrigger(e.clientX, e.clientY));
        deps.scheduleCursorHide();
      };

      const hideSettingsUpdateNotice = () => {
        const state = deps.getState();
        if (!state?.settingsUpdateNotice) return;
        deps.markSettingsUpdateNoticeSeen?.();
        state.settingsUpdateNotice.classList.add("dcmv-settings-update-notice-hidden");
        deps.syncHudVisibility?.();
      };

      const settingsNoticeMouseleave = () => {
        hideSettingsUpdateNotice();
      };

      const toggleFullscreen = (actionEl) => {
        const state = deps.getState();
        if (!state) return;
        actionEl?.blur?.();
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          state.ignoreNextFullscreenExitClose = true;
          (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch(() => {});
          return;
        }

        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (typeof req === "function") {
          req.call(el).catch(() => {});
        }
      };

      const resetPairingFromCurrent = (actionEl) => {
        const state = deps.getState();
        if (!state) return;
        const anchor = deps.getCurrentAnchorIndex();
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
        deps.saveManualPairingResetIndices(resetIndices);
        deps.syncManualResetClearVisibility();
        actionEl?.blur?.();
        deps.toggleSettingsMenu(false);
        deps.rebuildStepsKeepingAnchor(anchor);
        deps.renderCurrentStep();
        deps.syncHudTrigger();
        deps.showEdgeToast(
          isSameResetPoint
            ? "현재 페이지부터 단면 재설정을 해제했습니다."
            : "현재 페이지부터 단면 재설정을 적용했습니다.",
          2000
        );
      };

      const toggleSpread = (actionEl) => {
        const state = deps.getState();
        if (!state) return;

        const anchor = deps.getCurrentAnchorIndex();
        state.spreadEnabled = !state.spreadEnabled;
        actionEl?.blur?.();
        deps.syncToggleVisuals();

        deps.saveSettings({ spreadEnabled: state.spreadEnabled }).then(() => {
          if (!deps.getState()) return;
          deps.rebuildStepsKeepingAnchor(anchor);
          deps.renderCurrentStep();
          deps.syncHudTrigger();
        });
      };

      const handleViewerShortcut = (e) => {
        const state = deps.getState();
        if (!state) return false;

        const shortcut = getShortcutFromEvent(e);
        if (!shortcut) return false;

        if (shortcut === state.fullscreenShortcut) {
          e.preventDefault();
          e.stopPropagation();
          toggleFullscreen();
          return true;
        }

        if (shortcut === state.spreadShortcut) {
          e.preventDefault();
          e.stopPropagation();
          toggleSpread();
          return true;
        }

        if (shortcut === state.resetPairingShortcut) {
          e.preventDefault();
          e.stopPropagation();
          resetPairingFromCurrent();
          return true;
        }

        return false;
      };

      const click = (e) => {
        const state = deps.getState();
        if (!state) return;
        if (!(e.target instanceof Element)) return;

        if (state.isPagePickerOpen && !e.target.closest(".dcmv-page-picker-wrap")) {
          deps.togglePagePicker(false);
        }

        if (state.isSettingsMenuOpen && !e.target.closest(".dcmv-settings-wrap")) {
          deps.toggleSettingsMenu(false);
        }

        const actionEl = e.target.closest("[data-dcmv-action]");
        if (!actionEl) return;

        const action = actionEl.getAttribute("data-dcmv-action");

        if (action === "prev" || action === "next") {
          const direction = deps.getLogicalNavigationForOverlayButton(action);
          if (direction === "next") {
            deps.goNext(true);
          } else {
            deps.goPrev(true);
          }
        } else if (action === "refresh") {
          deps.runManualRefresh().catch(() => {});
        } else if (action === "toggle-fullscreen") {
          toggleFullscreen(actionEl);
        } else if (action === "toggle-spread") {
          toggleSpread(actionEl);
        } else if (action === "toggle-rtl") {
          state.readingDirectionRTL = !state.readingDirectionRTL;
          actionEl.blur();
          deps.syncToggleVisuals();

          deps.saveSettings({ readingDirectionRTL: state.readingDirectionRTL }).then(() => {
            if (!deps.getState()) return;
            deps.renderCurrentStep();
            deps.syncHudTrigger();
          });
        } else if (action === "toggle-first-single") {
          const anchor = deps.getCurrentAnchorIndex();
          state.firstPageSingle = !state.firstPageSingle;
          state.hasUserAdjustedFirstPageSingle = true;
          actionEl.blur();
          deps.syncToggleVisuals();

          deps.saveSettings({ firstPageSingle: state.firstPageSingle }).then(() => {
            if (!deps.getState()) return;
            deps.rebuildStepsKeepingAnchor(anchor);
            deps.renderCurrentStep();
            deps.syncHudTrigger();
          });
        } else if (action === "toggle-page-picker") {
          deps.togglePagePicker();
        } else if (action === "toggle-settings-menu") {
          hideSettingsUpdateNotice();
          deps.toggleSettingsMenu();
        } else if (action === "toggle-use-wasd") {
          state.useWasd = !state.useWasd;
          actionEl.blur();
          deps.syncToggleVisuals();
          deps.saveSettings({ useWasd: state.useWasd });
        } else if (action === "toggle-auto-first-page-adjust") {
          state.autoFirstPageAdjust = !state.autoFirstPageAdjust;
          actionEl.blur();
          deps.syncToggleVisuals();
          deps.saveSettings({ autoFirstPageAdjust: state.autoFirstPageAdjust });
        } else if (action === "toggle-corner-counter") {
          state.showCornerPageCounter = !state.showCornerPageCounter;
          actionEl.blur();
          deps.syncToggleVisuals();
          deps.updateCornerPageCounter?.();
          deps.saveSettings({ showCornerPageCounter: state.showCornerPageCounter });
        } else if (action === "toggle-auto-fullscreen") {
          state.autoFullscreen = !state.autoFullscreen;
          actionEl.blur();
          deps.syncToggleVisuals();
          deps.saveSettings({ autoFullscreen: state.autoFullscreen });
          // 설정 변경 시 전체화면 상태 동기화
          if (state.autoFullscreen) {
            deps.requestFullscreen?.();
          } else {
            deps.exitFullscreen?.();
          }
        } else if (action === "toggle-image-comments") {
          state.showImageComments = !state.showImageComments;
          actionEl.blur();
          deps.syncToggleVisuals();
          deps.syncDcImageCommentsForViewer?.();

          deps.saveSettings({ showImageComments: state.showImageComments }).then(() => {
            if (!deps.getState()) return;
            deps.renderCurrentStep();
            deps.syncHudTrigger();
          });
        } else if (action === "toggle-advanced-settings") {
          const settingsSlider = state.settingsMenu.querySelector(".dcmv-settings-slider");
          if (settingsSlider) {
            settingsSlider.classList.toggle("dcmv-settings-show-advanced");
          }
          actionEl.blur();
        } else if (action === "open-extension-options") {
          actionEl.blur();
          chrome.runtime?.sendMessage?.({ type: "DCMV_OPEN_OPTIONS" });
        } else if (action === "reset-pairing-from-current") {
          resetPairingFromCurrent(actionEl);
        } else if (action === "reset-pairing-from-current-clear") {
          const anchor = deps.getCurrentAnchorIndex();
          const hadManualPairingReset =
            Array.isArray(state.manualPairingResetIndices) &&
            state.manualPairingResetIndices.length > 0;
          state.manualPairingResetIndices = [];
          deps.clearSavedManualPairingResetIndices();
          deps.syncManualResetClearVisibility();
          actionEl.blur();
          deps.toggleSettingsMenu(false);
          deps.rebuildStepsKeepingAnchor(anchor);
          deps.renderCurrentStep();
          deps.syncHudTrigger();
          if (hadManualPairingReset) {
            deps.showEdgeToast("단면 재설정을 모두 초기화했습니다.", 2000);
          }
        } else if (action === "close") {
          deps.closeViewer();
        } else if (action === "go-to-page") {
          const pageIndex = Number(actionEl.getAttribute("data-dcmv-page-index"));
          if (!Number.isInteger(pageIndex)) return;
          deps.goToPageIndex(pageIndex);
        }
      };

      const imageClick = (e) => {
        if (!deps.getState()) return;
        if (!(e.target instanceof Element)) return;
        if (!e.target.closest(".dcmv-image")) return;

        const direction = deps.getLogicalNavigationForViewportSide(e.clientX, {
          ignoreDeadZone: true
        });
        if (!direction) return;

        deps.scheduleCursorHide();
        if (direction === "next") {
          deps.goNext(true);
          return;
        }

        deps.goPrev(true);
      };

      targetState.handlers = {
        escHandler,
        escKeyupHandler,
        keydown,
        wheel,
        mousemove,
        docMouseleave,
        resize,
        fullscreenchange,
        markFullscreenExitGestureIntent,
        hudMouseenter,
        hudMouseleave,
        settingsNoticeMouseleave,
        click,
        imageClick
      };

      window.addEventListener("keydown", escHandler, true);
      window.addEventListener("keyup", escKeyupHandler, true);
      document.addEventListener("keydown", keydown, true);
      document.addEventListener("mousemove", mousemove, true);
      document.addEventListener("mouseleave", docMouseleave, true);
      window.addEventListener("resize", resize, true);
      document.addEventListener("fullscreenchange", fullscreenchange, true);
      window.addEventListener("pointerdown", markFullscreenExitGestureIntent, true);
      window.addEventListener("touchstart", markFullscreenExitGestureIntent, true);
      window.addEventListener("mousedown", markFullscreenExitGestureIntent, true);

      targetState.overlay.addEventListener("wheel", wheel, { passive: false });
      targetState.overlay.addEventListener("click", click, true);
      targetState.overlay.addEventListener("click", imageClick, true);
      targetState.hud.addEventListener("mouseenter", hudMouseenter);
      targetState.hud.addEventListener("mouseleave", hudMouseleave);
      targetState.settingsButton?.addEventListener("mouseleave", settingsNoticeMouseleave);
    },

    shouldIgnoreKeydown(e) {
      if (e.defaultPrevented) return true;

      const target = e.target;
      if (!(target instanceof Element)) return false;

      return !!target.closest("input, textarea, select, [contenteditable=\"true\"]");
    },

    getLogicalNavigationForKey(targetState, e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return null;

      const key = String(e.key || "").toLowerCase();

      if (key === " " || key === "spacebar") {
        return e.shiftKey ? "prev" : "next";
      }

      if (key === "arrowdown" || (targetState?.useWasd && key === "s")) return "next";
      if (key === "arrowup" || (targetState?.useWasd && key === "w")) return "prev";

      if (key === "arrowright" || (targetState?.useWasd && key === "d")) {
        return targetState?.readingDirectionRTL ? "prev" : "next";
      }

      if (key === "arrowleft" || (targetState?.useWasd && key === "a")) {
        return targetState?.readingDirectionRTL ? "next" : "prev";
      }

      return null;
    },

    getLogicalNavigationForViewportSide(targetState, clientX, options = {}, deps) {
      const viewportCenterX = window.innerWidth / 2;
      const halfDeadZone = options.ignoreDeadZone
        ? 0
        : deps.getViewportClickDeadZoneWidth() / 2;

      if (Math.abs(clientX - viewportCenterX) <= halfDeadZone) {
        return null;
      }

      const isLeftSide = clientX < viewportCenterX;

      if (isLeftSide) {
        return targetState?.readingDirectionRTL ? "next" : "prev";
      }

      return targetState?.readingDirectionRTL ? "prev" : "next";
    },

    getViewportClickDeadZoneWidth(targetState, deps) {
      const baseWidth = Math.max(
        deps.clickDeadZoneMinPx,
        Math.min(deps.clickDeadZoneMaxPx, window.innerWidth * deps.clickDeadZoneRatio)
      );

      if (deps.isSinglePortraitStep()) {
        return Math.round(baseWidth * deps.singlePortraitDeadZoneScale);
      }

      return baseWidth;
    },

    getLogicalNavigationForOverlayButton(targetState, action) {
      const isLeftButton = action === "prev";

      if (isLeftButton) {
        return targetState?.readingDirectionRTL ? "next" : "prev";
      }

      return targetState?.readingDirectionRTL ? "prev" : "next";
    },

    togglePagePicker(targetState, forceOpen, deps) {
      if (!targetState) return;

      const nextOpen =
        typeof forceOpen === "boolean" ? forceOpen : !targetState.isPagePickerOpen;

      targetState.isPagePickerOpen = nextOpen;
      targetState.pagePicker.classList.toggle("dcmv-page-picker-open", nextOpen);
      targetState.pageCounter.classList.toggle("dcmv-page-counter-open", nextOpen);

      if (nextOpen) {
        deps.toggleSettingsMenu(false);
        targetState.pagePickerSelectedIndex = deps.getCurrentDisplayPageIndex();
        deps.renderPagePicker();
        deps.scrollCurrentPagePickerItemIntoView();
        targetState.hud.classList.add(deps.hudVisibleClass);
        clearTimeout(targetState.hudHideTimer);
        targetState.pageCounter.focus();
      }
    },

    toggleSettingsMenu(targetState, forceOpen, deps) {
      if (!targetState) return;

      const nextOpen =
        typeof forceOpen === "boolean" ? forceOpen : !targetState.isSettingsMenuOpen;

      targetState.isSettingsMenuOpen = nextOpen;
      targetState.settingsMenu.classList.toggle("dcmv-settings-menu-open", nextOpen);
      targetState.settingsButton.classList.toggle("dcmv-page-counter-open", nextOpen);

      if (nextOpen) {
        // Reset to basic settings when opening menu
        const settingsSlider = targetState.settingsMenu.querySelector(".dcmv-settings-slider");
        if (settingsSlider) {
          settingsSlider.classList.remove("dcmv-settings-show-advanced");
        }
        deps.syncManualResetClearVisibility();
        deps.togglePagePicker(false);
        targetState.hud.classList.add(deps.hudVisibleClass);
        clearTimeout(targetState.hudHideTimer);
        targetState.settingsButton.focus();
        return;
      }

      if (!deps.refreshHudPointerState()) {
        clearTimeout(targetState.hudHideTimer);
        targetState.hud.classList.remove(deps.hudVisibleClass);
      }
    },

    renderPagePicker(targetState, deps) {
      if (!targetState) return;

      const currentPageIndex = targetState.isPagePickerOpen
        ? targetState.pagePickerSelectedIndex
        : deps.getCurrentDisplayPageIndex();
      const fragment = document.createDocumentFragment();

      for (const item of targetState.sourceItems) {
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

      targetState.pagePickerList.replaceChildren(fragment);
    },

    scrollCurrentPagePickerItemIntoView(targetState) {
      if (!targetState || !targetState.isPagePickerOpen) return;

      const activeItem = targetState.pagePickerList.querySelector(
        ".dcmv-page-picker-item-active"
      );

      if (!(activeItem instanceof Element)) return;

      activeItem.scrollIntoView({
        block: "center"
      });
    },

    handlePagePickerKeydown(targetState, e, deps) {
      if (!targetState) return false;

      const key = String(e.key || "").toLowerCase();
      const currentPageIndex = targetState.pagePickerSelectedIndex;

      if (key === "arrowdown" || key === "s") {
        if (key === "s" && !targetState.useWasd) return false;
        targetState.pagePickerSelectedIndex = Math.min(
          currentPageIndex + 1,
          targetState.sourceItems.length - 1
        );
        deps.renderPagePicker();
        deps.scrollCurrentPagePickerItemIntoView();
        return true;
      }

      if (key === "arrowup" || key === "w") {
        if (key === "w" && !targetState.useWasd) return false;
        targetState.pagePickerSelectedIndex = Math.max(currentPageIndex - 1, 0);
        deps.renderPagePicker();
        deps.scrollCurrentPagePickerItemIntoView();
        return true;
      }

      if (
        key === "arrowleft" ||
        key === "arrowright" ||
        (targetState.useWasd && key === "a") ||
        (targetState.useWasd && key === "d")
      ) {
        return true;
      }

      if (key === "enter" || key === " " || key === "spacebar") {
        deps.goToPageIndex(targetState.pagePickerSelectedIndex);
        return true;
      }

      return false;
    },

    goNext(targetState, force, deps) {
      return modules.layout?.goNext?.(targetState, force, deps);
    },

    goPrev(targetState, force, deps) {
      return modules.layout?.goPrev?.(targetState, force, deps);
    },

    goToPageIndex(targetState, pageIndex, options, deps) {
      return modules.layout?.goToPageIndex?.(targetState, pageIndex, options, deps);
    }
  };

  function canScrollInsideCommentPanel(target, deltaY) {
    if (!(target instanceof Element)) return false;

    const panel =
      target.closest(".dcmv-dc-comment-panel-list") ||
      target.closest(".dcmv-dc-comment-host");
    if (!(panel instanceof HTMLElement)) return false;
    return true;
  }

  function getShortcutFromEvent(e) {
    const key = String(e.key || "");
    if (!key) return "";
    if (["Control", "Alt", "Shift", "Meta"].includes(key)) return "";

    const parts = [];
    if (e.ctrlKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey) parts.push("shift");
    if (e.metaKey) parts.push("meta");

    if (key.length === 1) {
      parts.push(key.toLowerCase());
      return parts.join("+");
    }

    const normalized = key.toLowerCase();
    if (normalized === " ") parts.push("space");
    else if (normalized === "spacebar") parts.push("space");
    else parts.push(normalized);
    return parts.join("+");
  }
})();
