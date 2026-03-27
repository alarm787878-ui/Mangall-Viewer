(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});

  modules.ui = {
    buildOverlay(deps) {
      const overlay = document.createElement("div");
      overlay.id = deps.overlayId;
      overlay.className = "dcmv-overlay";

      const svgNs = "http://www.w3.org/2000/svg";

      function el(tagName, className, textContent) {
        const node = document.createElement(tagName);
        if (className) node.className = className;
        if (textContent !== undefined) node.textContent = textContent;
        return node;
      }

      function button(className, action, textContent) {
        const node = el("button", className, textContent);
        node.type = "button";
        node.dataset.dcmvAction = action;
        return node;
      }

      function arrowIcon(pathData) {
        const wrapper = el("span", "dcmv-nav-btn-arrow");
        wrapper.setAttribute("aria-hidden", "true");

        const svg = document.createElementNS(svgNs, "svg");
        svg.setAttribute("viewBox", "0 0 12 12");
        svg.setAttribute("focusable", "false");
        svg.setAttribute("aria-hidden", "true");

        const path = document.createElementNS(svgNs, "path");
        path.setAttribute("d", pathData);
        svg.appendChild(path);
        wrapper.appendChild(svg);
        return wrapper;
      }

      function settingsGearIcon() {
        const wrapper = el("span", "dcmv-settings-gear");
        wrapper.setAttribute("aria-hidden", "true");

        const svg = document.createElementNS(svgNs, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("focusable", "false");
        svg.setAttribute("aria-hidden", "true");

        const path = document.createElementNS(svgNs, "path");
        path.setAttribute(
          "d",
          "M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.58.22-1.12.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.84a.5.5 0 0 0 .49-.42l.36-2.54c.58-.22 1.12-.53 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
        );
        path.setAttribute("fill", "rgba(255, 255, 255, 0.92)");
        svg.appendChild(path);
        wrapper.appendChild(svg);
        return wrapper;
      }

      function manualResetClearIcon() {
        const wrapper = el("span", "dcmv-settings-subaction-icon");
        wrapper.setAttribute("aria-hidden", "true");

        const svg = document.createElementNS(svgNs, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("focusable", "false");
        svg.setAttribute("aria-hidden", "true");

        const path = document.createElementNS(svgNs, "path");
        path.setAttribute("d", "M12 4V1L7 6l5 5V7a5 5 0 1 1-4.89 6.06H5.05A7 7 0 1 0 12 4Z");
        svg.appendChild(path);
        wrapper.appendChild(svg);
        return wrapper;
      }

      const stage = el("div", "dcmv-stage");
      const imageLoadingBar = el("div", "dcmv-image-loading-bar");
      const imageLoadingBarFill = el("div", "dcmv-image-loading-bar-fill");
      imageLoadingBar.appendChild(imageLoadingBarFill);
      const edgeToast = el("div", "dcmv-edge-toast");
      edgeToast.setAttribute("aria-live", "polite");
      const hudTrigger = el("div", "dcmv-hud-trigger");
      const hud = el("div", "dcmv-hud");

      const prevButton = button("dcmv-btn dcmv-nav-btn", "prev");
      prevButton.append(
        arrowIcon("M7.75 2.25 4 6l3.75 3.75"),
        el("span", "dcmv-nav-btn-label", "이전")
      );

      const spreadButton = button("dcmv-toggle dcmv-toggle-spread", "toggle-spread");
      spreadButton.appendChild(el("span", "dcmv-toggle-label", "양면으로 보기"));

      const firstSingleButton = button(
        "dcmv-toggle dcmv-toggle-first-single",
        "toggle-first-single"
      );
      firstSingleButton.appendChild(el("span", "", "첫 페이지가 단면"));
      const firstSingleCheckbox = el("input", "dcmv-first-single-checkbox");
      firstSingleCheckbox.type = "checkbox";
      firstSingleCheckbox.tabIndex = -1;
      firstSingleCheckbox.setAttribute("aria-hidden", "true");
      firstSingleButton.appendChild(firstSingleCheckbox);

      const pagePickerWrap = el("div", "dcmv-page-picker-wrap");
      const pageCounter = button("dcmv-page-counter dcmv-btn", "toggle-page-picker");
      pageCounter.append(
        el("span", "dcmv-page-counter-label", "0 / 0"),
        el("span", "dcmv-page-counter-caret")
      );
      pageCounter.lastChild.setAttribute("aria-hidden", "true");
      const pagePicker = el("div", "dcmv-page-picker");
      pagePicker.appendChild(el("div", "dcmv-page-picker-list"));
      pagePickerWrap.append(pageCounter, pagePicker);

      const refreshButton = button("dcmv-btn", "refresh", "새로고침");

      const settingsWrap = el("div", "dcmv-settings-wrap");
      const settingsButton = button("dcmv-btn dcmv-settings-btn", "toggle-settings-menu");
      settingsButton.setAttribute("aria-label", "설정");
      settingsButton.appendChild(settingsGearIcon());

      const settingsMenu = el("div", "dcmv-settings-menu");
      const rtlButton = button("dcmv-settings-item dcmv-settings-rtl", "toggle-rtl");
      rtlButton.append(
        el("span", "dcmv-settings-item-label", "페이지 읽는 순서"),
        el("span", "dcmv-settings-item-value dcmv-settings-rtl-value", "좌<-우")
      );

      const wasdButton = button(
        "dcmv-settings-item dcmv-settings-use-wasd",
        "toggle-use-wasd"
      );
      const wasdSwitch = el("span", "dcmv-settings-switch dcmv-settings-use-wasd-switch");
      wasdSwitch.setAttribute("aria-hidden", "true");
      wasdButton.append(el("span", "dcmv-settings-item-label", "wasd로 이동"), wasdSwitch);

      const autoFirstPageButton = button(
        "dcmv-settings-item dcmv-settings-auto-first-page",
        "toggle-auto-first-page-adjust"
      );
      const autoFirstPageSwitch = el(
        "span",
        "dcmv-settings-switch dcmv-settings-auto-first-page-switch"
      );
      autoFirstPageSwitch.setAttribute("aria-hidden", "true");
      autoFirstPageButton.append(
        el("span", "dcmv-settings-item-label", "첫 페이지가 단면 자동 조정"),
        autoFirstPageSwitch
      );

      const manualResetDivider = el("div", "dcmv-settings-divider dcmv-settings-divider-manual");
      const manualPairingResetButton = el(
        "div",
        "dcmv-settings-item dcmv-settings-item-split dcmv-settings-manual-reset-wrap"
      );
      const manualPairingResetMainButton = button(
        "dcmv-settings-item-main dcmv-settings-manual-reset",
        "reset-pairing-from-current"
      );
      manualPairingResetMainButton.appendChild(
        el("span", "dcmv-settings-item-label", "현재 페이지부터 단면 재설정")
      );
      const manualPairingResetClearButton = button(
        "dcmv-settings-item-subaction dcmv-settings-manual-reset-clear",
        "reset-pairing-from-current-clear"
      );
      manualPairingResetClearButton.setAttribute(
        "aria-label",
        "현재 페이지부터 단면 재설정 초기화"
      );
      manualPairingResetClearButton.title = "초기화";
      manualPairingResetClearButton.hidden = true;
      manualPairingResetClearButton.appendChild(manualResetClearIcon());
      manualPairingResetButton.append(
        manualPairingResetMainButton,
        manualPairingResetClearButton
      );

      settingsMenu.append(
        rtlButton,
        wasdButton,
        autoFirstPageButton,
        manualResetDivider,
        manualPairingResetButton
      );
      settingsWrap.append(settingsButton, settingsMenu);

      const closeButton = button("dcmv-btn", "close", "닫기");

      const nextButton = button("dcmv-btn dcmv-nav-btn", "next");
      nextButton.append(
        el("span", "dcmv-nav-btn-label", "다음"),
        arrowIcon("M4.25 2.25 8 6l-3.75 3.75")
      );

      hud.append(
        prevButton,
        spreadButton,
        firstSingleButton,
        pagePickerWrap,
        refreshButton,
        settingsWrap,
        closeButton,
        nextButton
      );
      overlay.append(stage, imageLoadingBar, edgeToast, hudTrigger, hud);

      return overlay;
    },

    setRefreshButtonState(targetState, isRunning) {
      if (!targetState || !targetState.refreshButton) return;

      targetState.refreshButton.disabled = !!isRunning;
      targetState.refreshButton.textContent = isRunning ? "갱신 중..." : "새로고침";
    }
  };
})();
