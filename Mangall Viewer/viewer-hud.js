(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});

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
        return;
      }

      const inside = deps.isPointerInsideHudTrigger(
        targetState.lastPointerX,
        targetState.lastPointerY
      );
      targetState.isPointerOverHudZone = inside;

      if (inside) {
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
        !!targetState.isSettingsMenuOpen;

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
    },

    showEdgeToast(targetState, message, durationMs, options = {}) {
      if (!targetState || !targetState.edgeToast) return;

      clearTimeout(targetState.edgeToastTimer);
      targetState.edgeToast.textContent = message;
      targetState.edgeToast.classList.toggle(
        "dcmv-edge-toast-error",
        !!options.isError
      );
      targetState.edgeToast.classList.add("dcmv-edge-toast-visible");

      targetState.edgeToastTimer = setTimeout(() => {
        if (!targetState?.edgeToast) return;
        targetState.edgeToast.classList.remove("dcmv-edge-toast-visible");
        setTimeout(() => {
          if (!targetState?.edgeToast) return;
          targetState.edgeToast.classList.remove("dcmv-edge-toast-error");
        }, 200);
      }, durationMs);
    },

    scheduleCursorHide(targetState, deps) {
      if (!targetState) return;

      clearTimeout(targetState.cursorHideTimer);
      targetState.cursorHideTimer = setTimeout(() => {
        if (!targetState) return;
        if (
          targetState.isPointerOverHudZone ||
          targetState.isPagePickerOpen ||
          targetState.isSettingsMenuOpen
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
})();
