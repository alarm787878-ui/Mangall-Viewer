(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  const MAX_EDGE_TOASTS = 10;
  const DEFAULT_VIEWER_NOTICE_SECONDS = 5;
  const VIEWER_NOTICE_HIDDEN_CLASS = "dcmv-viewer-notice-hidden";
  const VIEWER_NOTICE_RUNNING_CLASS = "dcmv-viewer-notice-running";
  const VIEWER_NOTICE_PAUSED_CLASS = "dcmv-viewer-notice-paused";

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
          isViewerNoticeVisible(targetState)
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
    },

    // ───────── 안내 말풍선 (화면 오른쪽 아래) ─────────
    // options: {
    //   title: 맨 위 가운데 제목,
    //   message: 말풍선 문구,
    //   items: 점(•)을 붙여 한 줄씩 보여줄 항목 목록,
    //   seconds: 몇 초 뒤 자동으로 닫을지 (기본 5초),
    //   linkLabel / onLink: 바로가기 버튼 글자와 눌렀을 때 할 일 (둘 다 있어야 버튼이 보임),
    //   onClose(reason): 말풍선이 실제로 닫혔을 때 할 일.
    //     reason은 "timeout"(시간 끝), "close"(X 버튼), "link"(바로가기 버튼) 중 하나.
    // }
    // 뷰어를 닫아서 사라질 때는 onClose를 부르지 않는다. (clearViewerNotice 참고)
    showViewerNotice(targetState, options = {}) {
      const notice = targetState?.viewerNotice;
      const title = String(options.title || "");
      const message = String(options.message || "");
      const items = (Array.isArray(options.items) ? options.items : [])
        .map((item) => String(item || ""))
        .filter(Boolean);
      if (!notice || (!title && !message && !items.length)) return false;

      // 이미 떠 있는 안내가 있으면 조용히 정리하고 새로 띄운다.
      stopViewerNotice(targetState);

      const titleEl = notice.querySelector(".dcmv-viewer-notice-title");
      const textEl = notice.querySelector(".dcmv-viewer-notice-text");
      const itemsEl = notice.querySelector(".dcmv-viewer-notice-items");
      const linkEl = notice.querySelector(".dcmv-viewer-notice-link");
      const linkLabelEl = notice.querySelector(".dcmv-viewer-notice-link-label");
      const closeEl = notice.querySelector(".dcmv-viewer-notice-close");
      const progressFillEl = notice.querySelector(".dcmv-viewer-notice-progress-fill");

      const hasLink = !!options.linkLabel && typeof options.onLink === "function";
      if (titleEl) {
        titleEl.textContent = title;
        titleEl.hidden = !title;
      }
      if (textEl) {
        textEl.textContent = message;
        textEl.hidden = !message;
      }
      if (itemsEl) {
        itemsEl.textContent = "";
        for (const item of items) {
          const itemEl = document.createElement("li");
          itemEl.className = "dcmv-viewer-notice-item";
          itemEl.textContent = item;
          itemsEl.appendChild(itemEl);
        }
        itemsEl.hidden = !items.length;
      }
      // 제목이 없으면 첫 줄 글자가 X 버튼과 겹치지 않게 오른쪽을 비운다. (style.css 참고)
      notice.classList.toggle("dcmv-viewer-notice-has-title", !!title);
      if (linkLabelEl) linkLabelEl.textContent = hasLink ? String(options.linkLabel) : "";
      if (linkEl) linkEl.hidden = !hasLink;
      // 버튼이 있으면 말풍선 폭을 버튼 폭에 맞춘다. (style.css 참고)
      notice.classList.toggle("dcmv-viewer-notice-has-link", hasLink);

      const durationMs = Math.max(1, Number(options.seconds) || DEFAULT_VIEWER_NOTICE_SECONDS) * 1000;
      const run = {
        remainingMs: durationMs,
        startedAt: 0,
        timer: null,
        // 카운트다운을 멈추게 한 이유들. ("hover": 마우스를 올림, "tab": 다른 탭을 보는 중)
        // 이유가 하나도 남지 않아야 다시 흐른다.
        pauseReasons: new Set(),
        removeListeners: []
      };
      targetState.viewerNoticeRun = run;

      const isCurrentRun = () => targetState.viewerNoticeRun === run;
      const listen = (target, type, handler) => {
        if (!target) return;
        target.addEventListener(type, handler);
        run.removeListeners.push(() => target.removeEventListener(type, handler));
      };

      const finish = (reason) => {
        if (!isCurrentRun()) return;
        stopViewerNotice(targetState);
        try {
          options.onClose?.(reason);
        } catch {
        }
      };

      const startTimer = () => {
        if (!isCurrentRun() || run.timer || run.pauseReasons.size) return;
        run.startedAt = Date.now();
        run.timer = setTimeout(() => finish("timeout"), run.remainingMs);
        notice.classList.remove(VIEWER_NOTICE_PAUSED_CLASS);
      };

      const pause = (reason) => {
        if (!isCurrentRun()) return;
        run.pauseReasons.add(reason);
        // 줄어드는 막대도 같이 멈춘다.
        notice.classList.add(VIEWER_NOTICE_PAUSED_CLASS);
        if (!run.timer) return;
        clearTimeout(run.timer);
        run.timer = null;
        run.remainingMs = Math.max(0, run.remainingMs - (Date.now() - run.startedAt));
      };

      const resume = (reason) => {
        if (!isCurrentRun()) return;
        run.pauseReasons.delete(reason);
        // 남은 시간부터 다시 흐른다. (처음부터 다시 세지 않는다)
        startTimer();
      };

      listen(notice, "mouseenter", () => pause("hover"));
      listen(notice, "mouseleave", () => resume("hover"));
      listen(document, "visibilitychange", () => {
        if (document.hidden) {
          pause("tab");
        } else {
          resume("tab");
        }
      });
      listen(closeEl, "click", (event) => {
        event.stopPropagation();
        closeEl.blur();
        finish("close");
      });
      if (hasLink) {
        listen(linkEl, "click", (event) => {
          event.stopPropagation();
          linkEl.blur();
          try {
            options.onLink();
          } catch {
          }
          finish("link");
        });
      }

      // 줄어드는 막대 애니메이션을 처음부터 다시 시작한다.
      if (progressFillEl) {
        progressFillEl.style.animationDuration = `${durationMs}ms`;
      }
      notice.classList.remove(VIEWER_NOTICE_RUNNING_CLASS);
      void notice.offsetWidth; // 브라우저가 애니메이션을 새로 시작하도록 한 번 다시 계산시키는 요령
      notice.classList.add(VIEWER_NOTICE_RUNNING_CLASS);
      notice.classList.remove(VIEWER_NOTICE_HIDDEN_CLASS);

      if (document.hidden) {
        pause("tab");
      }
      startTimer();
      return true;
    },

    // 뷰어를 닫을 때 부른다. 말풍선을 조용히 치우고, "봤음"으로 기록하지 않는다.
    clearViewerNotice(targetState) {
      stopViewerNotice(targetState);
    },

    isViewerNoticeVisible(targetState) {
      return isViewerNoticeVisible(targetState);
    }
  };

  function stopViewerNotice(targetState) {
    const run = targetState?.viewerNoticeRun;
    if (run) {
      clearTimeout(run.timer);
      run.timer = null;
      for (const removeListener of run.removeListeners) removeListener();
      run.removeListeners = [];
      targetState.viewerNoticeRun = null;
    }

    const notice = targetState?.viewerNotice;
    if (!notice) return;
    notice.classList.add(VIEWER_NOTICE_HIDDEN_CLASS);
    notice.classList.remove(VIEWER_NOTICE_PAUSED_CLASS);
  }

  function isViewerNoticeVisible(targetState) {
    return !!(
      targetState?.viewerNotice &&
      !targetState.viewerNotice.classList.contains(VIEWER_NOTICE_HIDDEN_CLASS)
    );
  }
})();
