(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});

  modules.navigation = {
    bindEvents(targetState, deps) {
      const escHandler = (e) => {
        if (!deps.getState()) return;

        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          deps.closeViewer();
        }
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

        const logicalNav = deps.getLogicalNavigationForKey(e);
        if (!logicalNav) return;

        e.preventDefault();

        if (logicalNav === "next") {
          deps.goNext();
          return;
        }

        deps.goPrev();
      };

      const keyup = (e) => {
        if (!deps.getState()) return;

        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      const wheel = (e) => {
        const state = deps.getState();
        if (!state) return;

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
        } else if (action === "toggle-spread") {
          const anchor = deps.getCurrentAnchorIndex();
          state.spreadEnabled = !state.spreadEnabled;
          actionEl.blur();
          deps.syncToggleVisuals();

          deps.saveSettings(deps.getSettingsSnapshot()).then(() => {
            if (!deps.getState()) return;
            deps.rebuildStepsKeepingAnchor(anchor);
            deps.renderCurrentStep();
            deps.syncHudTrigger();
          });
        } else if (action === "toggle-rtl") {
          state.readingDirectionRTL = !state.readingDirectionRTL;
          actionEl.blur();
          deps.syncToggleVisuals();

          deps.saveSettings(deps.getSettingsSnapshot()).then(() => {
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

          deps.saveSettings(deps.getSettingsSnapshot()).then(() => {
            if (!deps.getState()) return;
            deps.rebuildStepsKeepingAnchor(anchor);
            deps.renderCurrentStep();
            deps.syncHudTrigger();
          });
        } else if (action === "toggle-page-picker") {
          deps.togglePagePicker();
        } else if (action === "toggle-settings-menu") {
          deps.toggleSettingsMenu();
        } else if (action === "toggle-use-wasd") {
          state.useWasd = !state.useWasd;
          actionEl.blur();
          deps.syncToggleVisuals();
          deps.saveSettings(deps.getSettingsSnapshot());
        } else if (action === "toggle-auto-first-page-adjust") {
          state.autoFirstPageAdjust = !state.autoFirstPageAdjust;
          actionEl.blur();
          deps.syncToggleVisuals();
          deps.saveSettings(deps.getSettingsSnapshot());
        } else if (action === "reset-pairing-from-current") {
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
          actionEl.blur();
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
        keydown,
        keyup,
        winKeydown: escHandler,
        wheel,
        mousemove,
        docMouseleave,
        resize,
        hudMouseenter,
        hudMouseleave,
        click,
        imageClick
      };

      document.addEventListener("keydown", keydown, true);
      document.addEventListener("keyup", keyup, true);
      window.addEventListener("keydown", escHandler, true);
      document.addEventListener("mousemove", mousemove, true);
      document.addEventListener("mouseleave", docMouseleave, true);
      window.addEventListener("resize", resize, true);

      targetState.overlay.addEventListener("wheel", wheel, { passive: false });
      targetState.overlay.addEventListener("click", click, true);
      targetState.overlay.addEventListener("click", imageClick, true);
      targetState.hud.addEventListener("mouseenter", hudMouseenter);
      targetState.hud.addEventListener("mouseleave", hudMouseleave);
    },

    shouldIgnoreKeydown(e) {
      if (e.defaultPrevented) return true;
      if (e.ctrlKey || e.altKey || e.metaKey) return true;

      const target = e.target;
      if (!(target instanceof Element)) return false;

      return !!target.closest("input, textarea, select, [contenteditable=\"true\"]");
    },

    getLogicalNavigationForKey(targetState, e) {
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
})();
