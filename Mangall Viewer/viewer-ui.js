(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  // 뷰어를 열었을 때 화면 오른쪽 아래에 한 번 띄우는 안내 말풍선 설정.
  // 다음 안내를 띄우고 싶으면 이 안의 값만 바꾸면 된다.
  const VIEWER_NOTICE = {
    // 안내의 이름. 이 값을 새로 바꾸면 예전 안내를 본 사람에게도 다시 한 번 뜬다.
    id: "update-1.7.1",
    // 이 버전에서만 띄운다. 빈 글자("")로 두면 버전과 상관없이 띄운다.
    onlyVersion: "1.7.1",
    // 맨 위 가운데에 굵게 보이는 제목. 빈 글자("")면 제목 줄이 없다.
    title: "업데이트",
    // 제목 밑에 점(•)을 붙여 한 줄씩 보여줄 항목들. 필요 없으면 빈 목록([])으로 둔다.
    items: ["PgDn, PgUp 으로 페이지 이동", "로컬 파일도 뷰어 지원"],
    // 항목 대신(또는 항목 위에) 그냥 문장으로 보여줄 문구. \n 자리에서 줄이 바뀐다.
    // 제목·항목·문구가 모두 비어 있으면 안내를 띄우지 않는다.
    message: "",
    // 바로가기 버튼 글자. 빈 글자("")로 두면 버튼이 생기지 않는다.
    linkLabel: "업데이트 안내",
    // 버튼을 누르면 열릴 설정 페이지의 탭 이름 (예: "update-info", "local-viewer")
    linkTarget: "update-info",
    // 몇 초 뒤에 자동으로 닫을지
    seconds: 5
  };

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

      function fullscreenIcon() {
        const wrapper = el("span", "dcmv-fullscreen-icon");
        wrapper.setAttribute("aria-hidden", "true");

        const svg = document.createElementNS(svgNs, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("focusable", "false");
        svg.setAttribute("aria-hidden", "true");

        // 4 corner arrows (L-shape with rounded corners + diagonal)
        const paths = [
          "M9 3H4Q3 3 3 4V9",       // Top-left L (rounded)
          "M3 3L10 10",             // Top-left diagonal
          "M15 3H20Q21 3 21 4V9",   // Top-right L (rounded)
          "M21 3L14 10",            // Top-right diagonal
          "M3 15V20Q3 21 4 21H9",   // Bottom-left L (rounded)
          "M3 21L10 14",            // Bottom-left diagonal
          "M15 21H20Q21 21 21 20V15", // Bottom-right L (rounded)
          "M21 21L14 14"            // Bottom-right diagonal
        ];

        paths.forEach(d => {
          const path = document.createElementNS(svgNs, "path");
          path.setAttribute("d", d);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", "rgba(255, 255, 255, 0.92)");
          path.setAttribute("stroke-width", "2.5");
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("stroke-linejoin", "round");
          svg.appendChild(path);
        });
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

      function externalLinkIcon() {
        const wrapper = el("span", "dcmv-settings-external-icon");
        wrapper.setAttribute("aria-hidden", "true");

        const svg = document.createElementNS(svgNs, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("focusable", "false");
        svg.setAttribute("aria-hidden", "true");

        [
          "M15 3h6v6",
          "M10 14 21 3",
          "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
        ].forEach((pathData) => {
          const path = document.createElementNS(svgNs, "path");
          path.setAttribute("d", pathData);
          svg.appendChild(path);
        });

        wrapper.appendChild(svg);
        return wrapper;
      }

      const stage = el("div", "dcmv-stage");
      const cornerPageCounter = el("div", "dcmv-corner-page-counter");
      cornerPageCounter.setAttribute("aria-hidden", "true");
      const imageLoadingBar = el("div", "dcmv-image-loading-bar");
      const imageLoadingBarFill = el("div", "dcmv-image-loading-bar-fill");
      imageLoadingBar.appendChild(imageLoadingBarFill);
      const edgeToastStack = el("div", "dcmv-edge-toast-stack");
      edgeToastStack.setAttribute("aria-live", "polite");
      edgeToastStack.setAttribute("aria-atomic", "false");
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

      const fullscreenButton = button("dcmv-btn dcmv-fullscreen-btn", "toggle-fullscreen");
      fullscreenButton.setAttribute("aria-label", "전체화면");
      fullscreenButton.appendChild(fullscreenIcon());

      const settingsWrap = el("div", "dcmv-settings-wrap");
      const settingsButton = button("dcmv-btn dcmv-settings-btn", "toggle-settings-menu");
      settingsButton.setAttribute("aria-label", "설정");
      settingsButton.appendChild(settingsGearIcon());

      // 안내 말풍선: 메뉴 줄과 따로 화면 오른쪽 아래에 뜬다.
      // 버튼에는 data-dcmv-action을 달지 않는다. (뷰어의 다른 버튼 동작과 섞이지 않게,
      // 누르는 동작은 viewer-hud.js의 말풍선 관리 코드가 직접 처리한다)
      const viewerNotice = el("div", "dcmv-viewer-notice dcmv-viewer-notice-hidden");
      viewerNotice.setAttribute("role", "status");
      const viewerNoticeClose = el("button", "dcmv-viewer-notice-close", "×");
      viewerNoticeClose.type = "button";
      viewerNoticeClose.setAttribute("aria-label", "안내 닫기");
      const viewerNoticeLink = el("button", "dcmv-viewer-notice-link");
      viewerNoticeLink.type = "button";
      viewerNoticeLink.append(
        el("span", "dcmv-viewer-notice-link-label"),
        externalLinkIcon()
      );
      const viewerNoticeActions = el("div", "dcmv-viewer-notice-actions");
      viewerNoticeActions.appendChild(viewerNoticeLink);
      // 남은 시간을 보여주는 막대 (점점 줄어든다)
      const viewerNoticeProgress = el("div", "dcmv-viewer-notice-progress");
      viewerNoticeProgress.appendChild(el("div", "dcmv-viewer-notice-progress-fill"));
      viewerNotice.append(
        viewerNoticeClose,
        el("div", "dcmv-viewer-notice-title"),
        el("div", "dcmv-viewer-notice-text"),
        el("ul", "dcmv-viewer-notice-items"),
        viewerNoticeActions,
        viewerNoticeProgress
      );

      const settingsMenu = el("div", "dcmv-settings-menu");

      // Basic settings container
      const basicSettings = el("div", "dcmv-settings-basic");

      const rtlButton = button("dcmv-settings-item dcmv-settings-rtl", "toggle-rtl");
      rtlButton.append(
        el("span", "dcmv-settings-item-label", "페이지 읽는 순서"),
        el("span", "dcmv-settings-item-value dcmv-settings-rtl-value", "좌←우")
      );

      const autoFullscreenButton = button(
        "dcmv-settings-item dcmv-settings-auto-fullscreen",
        "toggle-auto-fullscreen"
      );
      const autoFullscreenSwitch = el(
        "span",
        "dcmv-settings-switch dcmv-settings-auto-fullscreen-switch"
      );
      autoFullscreenSwitch.setAttribute("aria-hidden", "true");
      autoFullscreenButton.append(
        el("span", "dcmv-settings-item-label", "자동 전체화면"),
        autoFullscreenSwitch
      );

      const imageCommentsButton = button(
        "dcmv-settings-item dcmv-settings-image-comments",
        "toggle-image-comments"
      );
      const imageCommentsSwitch = el(
        "span",
        "dcmv-settings-switch dcmv-settings-image-comments-switch"
      );
      imageCommentsSwitch.setAttribute("aria-hidden", "true");
      imageCommentsButton.append(
        el("span", "dcmv-settings-item-label", "이미지 댓글 표시"),
        imageCommentsSwitch
      );

      const manualResetDivider = el("div", "dcmv-settings-divider dcmv-settings-divider-manual");
      const longImageSplitWrap = el(
        "div",
        "dcmv-settings-item dcmv-settings-item-split dcmv-settings-long-image-split-wrap"
      );
      const longImageSplitButton = button(
        "dcmv-settings-item-main dcmv-settings-long-image-split",
        "split-long-images"
      );
      longImageSplitButton.appendChild(
        el("span", "dcmv-settings-item-label", "긴 이미지 자르기")
      );
      const longImageSplitClearButton = button(
        "dcmv-settings-item-subaction dcmv-settings-long-image-split-clear",
        "clear-long-image-split"
      );
      longImageSplitClearButton.setAttribute("aria-label", "긴 이미지 자르기 해제");
      longImageSplitClearButton.title = "긴 이미지 자르기 해제";
      longImageSplitClearButton.hidden = true;
      longImageSplitClearButton.appendChild(manualResetClearIcon());
      longImageSplitWrap.append(longImageSplitButton, longImageSplitClearButton);
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

      // Toggle button between basic and advanced (inside basic settings)
      const advancedToggleButton = button(
        "dcmv-settings-item dcmv-settings-advanced-toggle",
        "toggle-advanced-settings"
      );
      advancedToggleButton.append(
        el("span", "dcmv-settings-item-label", "추가 설정"),
        arrowIcon("M4.25 2.25 8 6l-3.75 3.75")
      );

      basicSettings.append(
        rtlButton,
        autoFullscreenButton,
        imageCommentsButton,
        advancedToggleButton,
        manualResetDivider,
        longImageSplitWrap,
        manualPairingResetButton
      );

      // Advanced settings container (hidden by default via CSS)
      const advancedSettings = el("div", "dcmv-settings-advanced");

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

      const autoLongImageSplitButton = button(
        "dcmv-settings-item dcmv-settings-auto-long-image-split",
        "toggle-auto-long-image-split"
      );
      const autoLongImageSplitSwitch = el(
        "span",
        "dcmv-settings-switch dcmv-settings-auto-long-image-split-switch"
      );
      autoLongImageSplitSwitch.setAttribute("aria-hidden", "true");
      autoLongImageSplitButton.append(
        el("span", "dcmv-settings-item-label", "자동으로 긴 이미지 자르기"),
        autoLongImageSplitSwitch
      );

      const cornerCounterButton = button(
        "dcmv-settings-item dcmv-settings-corner-counter",
        "toggle-corner-counter"
      );
      const cornerCounterSwitch = el(
        "span",
        "dcmv-settings-switch dcmv-settings-corner-counter-switch"
      );
      cornerCounterSwitch.setAttribute("aria-hidden", "true");
      cornerCounterButton.append(
        el("span", "dcmv-settings-item-label", "페이지 수 항상 표시"),
        cornerCounterSwitch
      );

      const openExtensionOptionsButton = button(
        "dcmv-settings-item dcmv-settings-open-extension-options",
        "open-extension-options"
      );
      openExtensionOptionsButton.append(
        el("span", "dcmv-settings-item-label", "확장프로그램 옵션"),
        externalLinkIcon()
      );

      // Back button at the bottom of advanced panel
      const backToBasicButton = button(
        "dcmv-settings-item dcmv-settings-back-to-basic",
        "toggle-advanced-settings"
      );
      backToBasicButton.append(
        arrowIcon("M7.75 2.25 4 6l3.75 3.75"),
        el("span", "dcmv-settings-item-label", "기본 설정")
      );

      advancedSettings.append(
        wasdButton,
        autoFirstPageButton,
        autoLongImageSplitButton,
        cornerCounterButton,
        openExtensionOptionsButton,
        backToBasicButton
      );

      // Wrap both panels in a slider container for animation
      const settingsSlider = el("div", "dcmv-settings-slider");
      settingsSlider.append(basicSettings, advancedSettings);

      settingsMenu.append(settingsSlider);
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
        fullscreenButton,
        settingsWrap,
        closeButton,
        nextButton
      );
      overlay.append(
        stage,
        cornerPageCounter,
        imageLoadingBar,
        edgeToastStack,
        hudTrigger,
        hud,
        viewerNotice
      );

      return overlay;
    },

    // 위 VIEWER_NOTICE 설정을 다른 파일(content.js)에서 읽을 수 있게 내보낸다.
    getViewerNoticeConfig() {
      return { ...VIEWER_NOTICE };
    },

    setRefreshButtonState(targetState, isRunning) {
      if (!targetState || !targetState.refreshButton) return;

      targetState.refreshButton.disabled = !!isRunning;
      targetState.refreshButton.textContent = isRunning ? "갱신 중..." : "새로고침";
    }
  };
})();
