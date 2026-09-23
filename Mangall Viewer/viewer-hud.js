(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  const MAX_EDGE_TOASTS = 10;

  function clearToastTimers(targetState, toast) {
    const timers = targetState?.edgeToastTimers?.get(toast);
    if (!timers) return;
    clearTimeout(timers.hideTimer);
    clearTimeout(timers.removeTimer);
    targetState.edgeToastTimers.delete(toast);
  }

  function removeToast(targetState, toast) {
    clearToastTimers(targetState, toast);
    toast?.remove?.();
  }

  modules.hud = {
    syncHudTrigger(targetState, deps) {
      if (!targetState) return;

      if (!targetState.hud.dataset.dcmvBaseBottom) {
        const initialHudStyle = window.getComputedStyle(targetState.hud);
        targetState.hud.dataset.dcmvBaseBottom = `${Number.parseFloat(initialHudStyle.bottom) || 0}`;
      }

      const baseBottom = Number.parseFloat(targetState.hud.dataset.dcmvBaseBottom || "0") || 0;
      const commentOffset =
        Number.parseFloat(
          window.getComputedStyle(document.documentElement)
            .getPropertyValue("--dcmv-hud-bottom-offset")
            .trim() || "0"
        ) || 0;
      const bottom = baseBottom + commentOffset;
      targetState.hud.style.bottom = `${bottom}px`;
      const width = targetState.hud.offsetWidth;
      const height = targetState.hud.offsetHeight;
      const left = Math.max(0, (window.innerWidth - width) / 2);
      const top = Math.max(0, window.innerHeight - bottom - height);
      const rect = { left, top, width, height };
      const trigger = targetState.hudTrigger;

      const triggerLeft = Math.max(0, rect.left - deps.hudTriggerMarginX);
      const triggerTop = Math.max(0, rect.top - deps.hudTriggerMarginY);
      const triggerWidth = Math.min(
        window.innerWidth - triggerLeft,
        rect.width + deps.hudTriggerMarginX * 2
      );
      const triggerHeight = Math.min(
        window.innerHeight - triggerTop,
        rect.height + deps.hudTriggerMarginY * 2
      );

      trigger.style.left = `${triggerLeft}px`;
      trigger.style.top = `${triggerTop}px`;
      trigger.style.width = `${triggerWidth}px`;
      trigger.style.height = `${triggerHeight}px`;

      if (targetState.lastPointerX == null || targetState.lastPointerY == null) {
        if (isSettingsUpdateNoticeVisible(targetState)) {
          targetState.hud.classList.add(deps.hudVisibleClass);
          clearTimeout(targetState.hudHideTimer);
        }
        return;
      }

      const inside = deps.isPointerInsideHudTrigger(
        targetState.lastPointerX,
        targetState.lastPointerY
      );
      targetState.isPointerOverHudZone = inside;

      if (inside || isSettingsUpdateNoticeVisible(targetState)) {
        targetState.hud.classList.add(deps.hudVisibleClass);
        clearTimeout(targetState.hudHideTimer);
      }
    },

    isPointerInsideHudTrigger(targetState, x, y) {
      if (!targetState) return false;

      const rect = targetState.hudTrigger.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    },

    syncHudVisibility(targetState, deps) {
      if (!targetState) return;

      const shouldShow =
        !!targetState.isPointerOverHudZone ||
        !!targetState.isPagePickerOpen ||
        !!targetState.isSettingsMenuOpen ||
        isSettingsUpdateNoticeVisible(targetState);

      targetState.hud.classList.toggle(deps.hudVisibleClass, shouldShow);
    },

    updateHudHoverState(targetState, nextInside, deps) {
      if (!targetState) return;
      targetState.isPointerOverHudZone = !!nextInside;
      deps.syncHudVisibility();
    },

    refreshHudPointerState(targetState, deps) {
      if (!targetState) return false;
      if (targetState.lastPointerX == null || targetState.lastPointerY == null) {
        deps.syncHudVisibility();
        return !!targetState.isPointerOverHudZone;
      }

      const inside = deps.isPointerInsideHudTrigger(
        targetState.lastPointerX,
        targetState.lastPointerY
      );
      deps.updateHudHoverState(inside);
      return inside;
    },

    scheduleHudHide(targetState, deps) {
      if (!targetState) return;
      deps.refreshHudPointerState();
    },

    showHudTemporarily(targetState, deps) {
      if (!targetState) return;
      targetState.hud.classList.add(deps.hudVisibleClass);
      clearTimeout(targetState.hudHideTimer);
      targetState.hudHideTimer = setTimeout(() => {
        deps.syncHudVisibility?.();
      }, deps.hudInitialShowDelay);
    },

    showEdgeToast(targetState, message, durationMs, options = {}) {
      const stack = targetState?.edgeToastStack;
      if (!(stack instanceof HTMLElement)) return;

      const toastKey = String(
        options.key || `${options.isError ? "error" : "info"}:${message}`
      );
      let toast = Array.from(stack.children).find(
        (child) => child instanceof HTMLElement && child.dataset.dcmvToastKey === toastKey
      );

      if (!(toast instanceof HTMLElement)) {
        toast = document.createElement("div");
        toast.className = "dcmv-edge-toast";
        toast.dataset.dcmvToastKey = toastKey;
        stack.appendChild(toast);
      } else {
        clearToastTimers(targetState, toast);
        stack.appendChild(toast);
      }

      toast.textContent = message;
      toast.classList.toggle("dcmv-edge-toast-error", !!options.isError);
      requestAnimationFrame(() => {
        if (toast?.isConnected) {
          toast.classList.add("dcmv-edge-toast-visible");
        }
      });

      while (stack.children.length > MAX_EDGE_TOASTS) {
        removeToast(targetState, stack.firstElementChild);
      }

      const timers = {
        hideTimer: setTimeout(() => {
          if (!(toast instanceof HTMLElement)) return;
          toast.classList.remove("dcmv-edge-toast-visible");
          timers.removeTimer = setTimeout(() => {
            removeToast(targetState, toast);
          }, 200);
        }, durationMs),
        removeTimer: null
      };
      targetState.edgeToastTimers.set(toast, timers);
    },

    clearEdgeToasts(targetState) {
      const stack = targetState?.edgeToastStack;
      if (!(stack instanceof HTMLElement)) return;
      for (const toast of Array.from(stack.children)) {
        removeToast(targetState, toast);
      }
    },

    scheduleCursorHide(targetState, deps) {
      if (!targetState) return;

      clearTimeout(targetState.cursorHideTimer);
      targetState.cursorHideTimer = setTimeout(() => {
        if (!targetState) return;
        if (
          targetState.isPointerOverHudZone ||
          targetState.isPagePickerOpen ||
          targetState.isSettingsMenuOpen ||
          isSettingsUpdateNoticeVisible(targetState)
        ) {
          return;
        }
        deps.hideCursor();
      }, deps.cursorHideDelayMs);
    },

    showCursor(targetState, deps) {
      if (!targetState || !targetState.isCursorHidden) return;

      targetState.isCursorHidden = false;
      targetState.overlay.classList.remove(deps.cursorHiddenClass);
    },

    hideCursor(targetState, deps) {
      if (!targetState || targetState.isCursorHidden) return;

      targetState.isCursorHidden = true;
      targetState.overlay.classList.add(deps.cursorHiddenClass);
    },

    rememberPointerPosition(targetState, x, y) {
      if (!targetState) return;

      targetState.lastPointerX = x;
      targetState.lastPointerY = y;
    },

    hasPointerMovedSignificantly(targetState, x, y, deps) {
      if (!targetState) return false;
      if (targetState.lastPointerX == null || targetState.lastPointerY == null) {
        return true;
      }

      return (
        Math.hypot(x - targetState.lastPointerX, y - targetState.lastPointerY) >=
        deps.cursorMoveThresholdPx
      );
    }
  };

  function isSettingsUpdateNoticeVisible(targetState) {
    return !!(
      targetState?.settingsUpdateNotice &&
      !targetState.settingsUpdateNotice.classList.contains(
        "dcmv-settings-update-notice-hidden"
      )
    );
  }
})();
