(function () {
  const globalRoot =
    typeof globalThis !== "undefined"
      ? globalThis
      : typeof self !== "undefined"
        ? self
        : this;
  const modules = (globalRoot.__dcmvModules = globalRoot.__dcmvModules || {});

  const moduleState = {
    styleInjected: false,
    resizeBound: false,
    collapsedCommentKeys: new Set(),
    emptyCommentStates: new Map(),
    // 작성란을 펼쳐둔 댓글창 키 (화면을 다시 그려도 열린 상태 유지)
    writeOpenKeys: new Set(),
    // 방금 등록 버튼을 누른 댓글창 키 (실패해서 글이 남아 있으면 작성란을 다시 연다)
    writeSubmitKeys: new Set(),
    // 접힌 창에서 연필을 눌러 펼친 경우, 다시 그려진 뒤 입력칸에 커서를 줄 댓글창 키
    focusWriteKey: ""
  };
  const COMMENT_EXPAND_EVENT = "dcmv:dcinside-comment-expanded";
  const COMMENT_LAYOUT_EVENT = "dcmv:dcinside-comment-layout-updated";
  const SIDE_COMMENT_BELOW_EM = 8;
  const SIDE_COMMENT_MAX_WIDTH = 320;
  const EMPTY_COMMENT_TRIGGER_SIZE = 200;
  const BELOW_PREVIEW_MAX_COMMENTS = 3;
  const BELOW_PREVIEW_LINE_HEIGHT = 1.35;
  const BELOW_PREVIEW_VERTICAL_PADDING_EM = 0.9;
  const BELOW_PREVIEW_ROW_GAP_EM = 0.2;

  // 눈 아이콘 설정: true = 항상 표시, false = 마우스 올려야 표시
  // 외부(viewer-settings.js)에서 설정값 주입 및 저장 콜백 제공
  let alwaysShowComments = true;
  let saveAlwaysShowCommentsCallback = null;

  function setAlwaysShowComments(value) {
    alwaysShowComments = !!value;
  }

  function setSaveAlwaysShowCommentsCallback(callback) {
    saveAlwaysShowCommentsCallback = callback;
  }

  function saveAlwaysShowComments(enabled) {
    alwaysShowComments = !!enabled;
    if (typeof saveAlwaysShowCommentsCallback === "function") {
      saveAlwaysShowCommentsCallback(enabled);
    }
  }

  // 댓글창 below 모드 강제 설정
  let forceBelowMode = false;
  let saveForceBelowModeCallback = null;

  function setForceBelowMode(value) {
    forceBelowMode = !!value;
    syncForceBelowGlobalClass();
  }

  function setSaveForceBelowModeCallback(callback) {
    saveForceBelowModeCallback = callback;
  }

  function saveForceBelowMode(enabled) {
    forceBelowMode = !!enabled;
    if (typeof saveForceBelowModeCallback === "function") {
      saveForceBelowModeCallback(enabled);
    }
  }

  function isForceBelowMode() {
    return forceBelowMode;
  }

  // 항상 펼치기: 켜져 있으면 접힌 이미지 댓글을 전부 자동으로 펼친다
  // 외부(content.js)에서 저장된 값 주입 및 저장 콜백 제공
  let alwaysExpandComments = false;
  let saveAlwaysExpandCommentsCallback = null;
  // 디시는 한꺼번에 몰린 요청 일부에 빈 응답을 준다 (10개 동시 → 2개 실패 확인)
  const AUTO_EXPAND_BATCH_SIZE = 5; // 한 번에 보내는 디시 요청 수
  const AUTO_EXPAND_BATCH_GAP_MS = 500; // 묶음 사이 쉬는 시간
  const AUTO_EXPAND_FAIL_EXTRA_GAP_MS = 1000; // 묶음에 실패가 있으면 추가로 더 쉬는 시간
  const AUTO_EXPAND_WAIT_MS = 1500; // 한 묶음이 펼쳐질 때까지 기다리는 최대 시간 (정상 응답은 0.1초 안팎)
  const AUTO_EXPAND_MAX_TRIES = 2; // 같은 댓글창 최대 시도 횟수 (무한 반복 방지)
  const autoExpandRun = { running: false, rerun: false, timer: 0 };
  const autoExpandTries = new Map();
  // 자동 펼치기로 열린 댓글창 키: 이것만 눈 아이콘 숨김 모드를 따른다
  const autoExpandedKeys = new Set();

  function setAlwaysExpandComments(value) {
    alwaysExpandComments = !!value;
    syncAlwaysExpandButtons();
    scheduleAutoExpandAll();
  }

  function setSaveAlwaysExpandCommentsCallback(callback) {
    saveAlwaysExpandCommentsCallback = callback;
  }

  function isHasCommentsPanel(panel) {
    return (
      panel instanceof HTMLElement &&
      !panel.classList.contains("dcmv-dc-comment-panel-empty") &&
      !panel.classList.contains("dcmv-dc-comment-panel-collapsed-empty")
    );
  }

  function setAllPanelsVisibility(enabled) {
    // hover → always로 전환 시: 마우스가 올라가 있어도 일단 닫고 시작
    document.querySelectorAll(".dcmv-dc-comment-panel").forEach((panel) => {
      if (!isHasCommentsPanel(panel)) return;
      if (enabled) {
        panel.dataset.commentVisible = "true";
      } else {
        // hover 모드로 전환: 즉시 숨김 (마우스 흔들면 다시 뜸)
        panel.dataset.commentVisible = "false";
      }
    });
  }

  // 댓글창 아이콘 공통 규칙
  // - 모든 그림은 세로 24칸 기준으로 그리고 화면에서는 18px 높이로 표시 (같은 크기·선 굵기)
  // - 가로는 그림이 실제로 차지하는 만큼만 쓴다: x = 그림 왼쪽 끝, width = 그림 폭 (선 굵기 포함)
  // - 버튼 사이 간격은 CSS(버튼 좌우 여백 + 줄 간격) 한 곳에서만 정하므로,
  //   새 아이콘은 여기에 그림과 x/width만 적으면 간격이 자동으로 맞는다
  // - 선 굵기는 그림 크기와 상관없이 화면에서 항상 1.5px (non-scaling-stroke)
  const ICON_STROKE =
    'stroke="rgba(255,255,255,0.92)" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"';
  const ICON_HEIGHT_PX = 18;
  const COMMENT_ICONS = {
    // 댓글창 아래로: 화살표 + 바닥 줄
    down: { x: 4, width: 16, body: `<path d="M12 3v12M7 10l5 5 5-5M5 20h14" ${ICON_STROKE}/>` },
    // 댓글창 옆으로 되돌리기: 아래로 아이콘을 위아래 뒤집은 모양 (윗줄 + 위 화살표)
    up: { x: 4, width: 16, body: `<path d="M12 21V9M7 14l5-5 5 5M5 4h14" ${ICON_STROKE}/>` },
    eye: {
      x: 1,
      width: 22,
      body: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" ${ICON_STROKE}/><circle cx="12" cy="12" r="3" ${ICON_STROKE}/>`
    },
    // 항상 펼치기: 목록 + 아래 화살표
    alwaysExpand: {
      x: 2,
      width: 21,
      body: `<path d="M3 6h11M3 12h11M3 18h11M19 5v13M16 15l3 3 3-3" ${ICON_STROKE}/>`
    },
    // 연필: 댓글 쓰기
    pencil: { x: 3, width: 18, body: `<path d="M16 4l4 4L8 20H4v-4L16 4ZM13 7l4 4" ${ICON_STROKE}/>` },
    // 말풍선: 둥근 사각형 + 왼쪽 아래 꼬리
    bubble: {
      x: 2,
      width: 20,
      body: `<path d="M6 4h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-7l-4 3.5V16H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" ${ICON_STROKE}/>`
    }
  };

  // 꺼짐 상태는 그림 폭에 맞춰 왼쪽 위 → 오른쪽 아래 사선
  function createIconSvg(name, slashed = false) {
    const { x, width, body } = COMMENT_ICONS[name];
    const slashLine = slashed
      ? `<line x1="${x + 1}" y1="2" x2="${x + width - 1}" y2="22" ${ICON_STROKE}/>`
      : "";
    const widthPx = (width * ICON_HEIGHT_PX) / 24;
    return `<svg width="${widthPx}" height="${ICON_HEIGHT_PX}" viewBox="${x} 0 ${width} 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;pointer-events:none;">${body}${slashLine}</svg>`;
  }

  function createEyeIconSvg(slashed) {
    return createIconSvg("eye", slashed);
  }

  function createDownArrowIconSvg() {
    return createIconSvg("down");
  }

  function createUpArrowIconSvg() {
    return createIconSvg("up");
  }

  function createAlwaysExpandIconSvg(slashed) {
    return createIconSvg("alwaysExpand", slashed);
  }

  function createCommentBubbleIconSvg() {
    return createIconSvg("bubble");
  }

  function toAbsoluteUrl(url) {
    if (!url) return "";

    try {
      return new URL(url, location.href).href;
    } catch {
      return url;
    }
  }

  function getCommentText(el) {
    if (!(el instanceof Element)) return "";

    return Array.from(el.childNodes)
      .map((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || "";
        }

        if (!(node instanceof Element)) {
          return "";
        }

        if (node.tagName === "BR") {
          return "\n";
        }

        return getCommentText(node);
      })
      .join("")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function extractImageCommentsFromImageArea(imageArea) {
    if (!(imageArea instanceof Element)) return [];

    const commentItems = Array.from(
      imageArea.querySelectorAll(".img_comment .comment_box.img_comment_box li.ub-content")
    );

    return commentItems
      .map((item, index) => {
        const writerEl = item.querySelector(".cmt_nickbox .nickname");
        const dateEl = item.querySelector(".date_time");
        const textEl = item.querySelector(".cmt_txtbox .usertxt");
        const imageEl = item.querySelector(
          ".cmt_txtbox .comment_dccon img, .cmt_txtbox .coment_dccon_img img, .cmt_txtbox img.written_dccon"
        );

        const writer = writerEl?.textContent?.replace(/\s+/g, " ").trim() || "";
        const dateText = dateEl?.textContent?.trim() || "";
        const text = getCommentText(textEl);
        const imageUrl = toAbsoluteUrl(
          imageEl?.getAttribute("data-original") ||
            imageEl?.getAttribute("data-src") ||
            imageEl?.getAttribute("src") ||
            ""
        );
        const imageAlt =
          imageEl?.getAttribute("title") ||
          imageEl?.getAttribute("alt") ||
          "";

        if (!writer && !dateText && !text && !imageUrl) {
          return null;
        }

        return {
          id: item.id || `dcinside-image-comment-${index + 1}`,
          writer,
          dateText,
          text,
          imageUrl,
          imageAlt
        };
      })
      .filter(Boolean);
  }

  function collectImageCommentsForSourceItem(imageElement) {
    if (!(imageElement instanceof Element)) return [];

    const imageArea = imageElement.closest(".img_area");
    return extractImageCommentsFromImageArea(imageArea);
  }

  function getCommentSourceKey(imageElement) {
    if (!(imageElement instanceof Element)) return "";

    return (
      imageElement.getAttribute("data-fileno") ||
      imageElement.getAttribute("data-tempno") ||
      imageElement.getAttribute("data-image-no") ||
      imageElement.getAttribute("src") ||
      ""
    );
  }

  function isCommentCollapsedForSource(imageElement) {
    const commentKey = getCommentSourceKey(imageElement);
    return !!commentKey && moduleState.collapsedCommentKeys.has(commentKey);
  }

  function isSelectableCommentRoot(el) {
    if (!(el instanceof HTMLElement)) return false;
    return window.getComputedStyle(el).display !== "none";
  }

  function findCollapsedCommentRoot(imageArea) {
    if (!(imageArea instanceof Element)) return null;

    const candidates = [
      imageArea.querySelector(".fold.getMoreComment.img_comment_preview"),
      imageArea.querySelector(".comment_box.img_comment_box"),
      imageArea.querySelector(".img_comment:not(.open)")
    ];
    const collapsedRoot = candidates.find((el) => isSelectableCommentRoot(el));
    return collapsedRoot instanceof HTMLElement ? collapsedRoot : null;
  }

  function findExpandedCommentRoot(imageArea) {
    if (!(imageArea instanceof Element)) return null;

    const expandedRoot = Array.from(
      imageArea.querySelectorAll(".img_comment.open")
    )
      .reverse()
      .find((el) => isSelectableCommentRoot(el));
    return expandedRoot instanceof HTMLElement ? expandedRoot : null;
  }

  function findOriginalCommentRoot(imageElement) {
    if (!(imageElement instanceof Element)) return null;

    const imageArea = imageElement.closest(".img_area");
    const commentKey = getCommentSourceKey(imageElement);
    const preferCollapsed =
      !!commentKey && moduleState.collapsedCommentKeys.has(commentKey);
    const emptyCommentButton = findEmptyCommentOpenButton(imageElement);
    const collapsedRoot = findCollapsedCommentRoot(imageArea);
    const expandedRoot = findExpandedCommentRoot(imageArea);

    if (preferCollapsed && collapsedRoot instanceof HTMLElement) {
      return collapsedRoot;
    }

    if (expandedRoot instanceof HTMLElement) {
      return expandedRoot;
    }

    if (collapsedRoot instanceof HTMLElement) {
      return collapsedRoot;
    }

    if (isEmptyCommentHidden(commentKey) && emptyCommentButton) {
      return null;
    }

    return null;
  }

  function findEmptyCommentOpenButton(imageElement) {
    if (!(imageElement instanceof Element)) return null;

    const imageArea = imageElement.closest(".img_area");
    if (!(imageArea instanceof Element)) return null;

    const button = imageArea.querySelector(".btn_imgcmtopen[data-has-comment='N']");
    return button instanceof HTMLButtonElement ? button : null;
  }

  function getSourceImageArea(panel) {
    const sourceElement = panel?.__dcmvSourceElement;
    return sourceElement instanceof Element ? sourceElement.closest(".img_area") : null;
  }

  function getSourceCommentRoot(panel, options = {}) {
    if (!(panel instanceof HTMLElement)) return null;
    const imageArea = getSourceImageArea(panel);
    if (!(imageArea instanceof Element)) return null;

    const { preferExpanded = false } = options;
    const expandedRoot = findExpandedCommentRoot(imageArea);
    const collapsedRoot = findCollapsedCommentRoot(imageArea);

    if (preferExpanded) {
      return expandedRoot instanceof HTMLElement ? expandedRoot : null;
    }

    return expandedRoot || collapsedRoot;
  }

  function moveOriginalCommentRoot(commentRoot, panel) {
    if (!(commentRoot instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
      return false;
    }

    const host = document.createElement("div");
    host.className = "img_area dcmv-dc-comment-host";
    const imageWrap = commentRoot.parentElement?.querySelector?.(":scope > .imgwrap");
    if (imageWrap instanceof HTMLElement) {
      const imageWrapClone = imageWrap.cloneNode(true);
      imageWrapClone.classList.add("dcmv-dc-comment-host-imgwrap");
      imageWrapClone.querySelector(".btn_imgcmtopen")?.remove();
      host.appendChild(imageWrapClone);
    }

    const commentRootClone = commentRoot.cloneNode(true);
    panel.classList.add("dcmv-dc-comment-panel-original");
    panel.dataset.commentExpanded =
      commentRoot.classList.contains("open") ||
      !!commentRoot.closest(".img_comment.open")
        ? "true"
        : "false";
    host.appendChild(commentRootClone);
    panel.appendChild(host);
    return true;
  }

  function getHostedCommentRoot(panel) {
    if (!(panel instanceof HTMLElement)) return null;

    const commentRoot = panel.querySelector(
      ".dcmv-dc-comment-host > .img_comment, .dcmv-dc-comment-host > .comment_box.img_comment_box"
    );
    return commentRoot instanceof HTMLElement ? commentRoot : null;
  }

  function dispatchCommentRefresh(delay = 0) {
    if (delay > 0) {
      window.setTimeout(requestCommentRefresh, delay);
      return;
    }

    requestCommentRefresh();
  }

  function setCommentCollapsedState(commentKey, collapsed) {
    if (!commentKey) return;

    if (collapsed) {
      moduleState.collapsedCommentKeys.add(commentKey);
      return;
    }

    moduleState.collapsedCommentKeys.delete(commentKey);
  }

  function resetViewerCommentUiState() {
    moduleState.collapsedCommentKeys.clear();
    moduleState.emptyCommentStates.clear();
    document.documentElement?.style?.removeProperty?.("--dcmv-hud-bottom-offset");
  }

  function getEmptyCommentState(commentKey) {
    if (!commentKey) return "";
    return moduleState.emptyCommentStates.get(commentKey) || "";
  }

  function isEmptyCommentMode(commentKey) {
    return getEmptyCommentState(commentKey) !== "";
  }

  function setEmptyCommentMode(commentKey, enabled) {
    if (!commentKey) return;

    if (enabled) {
      moduleState.emptyCommentStates.set(commentKey, "open");
      return;
    }

    moduleState.emptyCommentStates.delete(commentKey);
  }

  function isEmptyCommentHidden(commentKey) {
    return getEmptyCommentState(commentKey) === "hidden";
  }

  function setEmptyCommentHiddenState(commentKey, hidden) {
    if (!commentKey) return;

    if (hidden) {
      moduleState.emptyCommentStates.set(commentKey, "hidden");
      return;
    }

    moduleState.emptyCommentStates.set(commentKey, "open");
  }

  function isEmptyCommentPanel(panel, commentKey = "") {
    if (!(panel instanceof HTMLElement)) return false;

    if (isEmptyCommentMode(commentKey)) {
      return true;
    }

    return findEmptyCommentOpenButton(panel.__dcmvSourceElement) instanceof HTMLButtonElement;
  }

  function triggerOriginalFoldExpand(panel) {
    if (!(panel instanceof HTMLElement)) return false;

    const commentRoot = getSourceCommentRoot(panel);
    if (!(commentRoot instanceof HTMLElement)) return false;

    const imageArea = commentRoot.closest(".img_area");
    const trigger = commentRoot.querySelector("li:last-child .cmt_txtbox") || commentRoot;
    if (!(trigger instanceof HTMLElement)) return false;

    try {
      if (typeof globalRoot.jQuery === "function") {
        globalRoot.jQuery(trigger).trigger("click");
      } else {
        trigger.click();
      }

      // 고정 타임아웃(80ms) 대신 DOM 변화를 감지한 뒤 refresh하도록 변경.
      // 디시인사이드의 댓글 로딩이 네트워크 상태나 JS 처리 속도에 따라 느릴 수 있어서
      // 80ms 안에 DOM 변화가 없으면 두 번째 클릭에서야 펼쳐지는 증상이 발생했었다.
      refreshCommentsAfterDomMutation(imageArea || commentRoot);
      return true;
    } catch {
      // 디시 원본 더보기 클릭이 실패하면 현재 상태를 그대로 유지한다.
      return false;
    }
  }

  function triggerOriginalPagingAction(panel, clickedControl) {
    if (!(panel instanceof HTMLElement) || !(clickedControl instanceof HTMLElement)) {
      return false;
    }

    const paging = clickedControl.closest(".cmt_paging");
    if (!(paging instanceof HTMLElement)) return false;

    const commentRoot = getSourceCommentRoot(panel, { preferExpanded: true });
    if (!(commentRoot instanceof HTMLElement)) return false;
    const imageArea = commentRoot.closest(".img_area");

    const clickedText = clickedControl.textContent?.replace(/\s+/g, " ").trim() || "";
    const clickedOnclick = clickedControl.getAttribute("onclick") || "";
    const controls = Array.from(paging.querySelectorAll("a, button")).filter(
      (el) => el instanceof HTMLElement
    );
    const controlIndex = controls.indexOf(clickedControl);

    const originalPaging = commentRoot.querySelector(".cmt_paging");
    if (!(originalPaging instanceof HTMLElement)) return false;

    const originalControls = Array.from(originalPaging.querySelectorAll("a, button")).filter(
      (el) => el instanceof HTMLElement
    );
    const originalTarget =
      originalControls.find((control) => {
        const controlText = control.textContent?.replace(/\s+/g, " ").trim() || "";
        const controlOnclick = control.getAttribute("onclick") || "";
        if (clickedOnclick && controlOnclick && clickedOnclick === controlOnclick) {
          return true;
        }

        return clickedText && controlText === clickedText;
      }) || (controlIndex >= 0 ? originalControls[controlIndex] : null);

    if (!(originalTarget instanceof HTMLElement)) return false;

    try {
      originalTarget.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window
        })
      );

      refreshCommentsAfterDomMutation(imageArea || commentRoot);
      return true;
    } catch {
      // 디시 원본 더보기 클릭이 실패하면 현재 상태를 그대로 유지한다.
      return false;
    }
  }

  function requestCommentRefresh() {
    document.dispatchEvent(new CustomEvent(COMMENT_EXPAND_EVENT));
  }

  function notifyCommentLayoutUpdated() {
    document.dispatchEvent(new CustomEvent(COMMENT_LAYOUT_EVENT));
  }

  function refreshCommentsAfterDomMutation(target, fallbackDelay = 240) {
    if (!(target instanceof Node)) {
      dispatchCommentRefresh(fallbackDelay);
      return;
    }

    let done = false;
    let observer = null;
    const finish = (delay = 0) => {
      if (done) return;
      done = true;
      observer?.disconnect?.();
      dispatchCommentRefresh(delay);
    };

    observer = new MutationObserver(() => {
      finish(20);
    });

    observer.observe(target, {
      childList: true,
      subtree: true
    });

    window.setTimeout(() => {
      finish(0);
    }, fallbackDelay);
  }

  function expandCollapsedComment(panel) {
    if (!(panel instanceof HTMLElement)) return false;

    const commentRoot = getSourceCommentRoot(panel);
    if (!(commentRoot instanceof HTMLElement)) return false;

    const imageArea = commentRoot.closest(".img_area");
    if (!(imageArea instanceof HTMLElement)) return false;

    const expandedRoot = findExpandedCommentRoot(imageArea);

    if (expandedRoot instanceof HTMLElement) {
      requestCommentRefresh();
      return true;
    }

    return triggerOriginalFoldExpand(panel);
  }

  function triggerOriginalEmptyCommentButton(panel) {
    if (!(panel instanceof HTMLElement)) return false;

    const trigger =
      panel.__dcmvEmptyCommentButton ||
      findEmptyCommentOpenButton(panel.__dcmvSourceElement);
    if (!(trigger instanceof HTMLButtonElement)) return false;

    try {
      trigger.click();
      dispatchCommentRefresh(180);
      return true;
    } catch {
      return false;
    }
  }

  function setEmptyCommentPanelExpanded(panel, expanded) {
    if (!(panel instanceof HTMLElement)) return;

    panel.dataset.commentExpanded = expanded ? "true" : "false";
    panel.classList.toggle("dcmv-dc-comment-panel-collapsed-empty", !expanded);

    const host = panel.querySelector(":scope > .dcmv-dc-comment-host");
    if (host instanceof HTMLElement) {
      host.hidden = !expanded;
    }

    updateCommentActionButton(panel);
    updateCommentLayoutSize(panel.closest(".dcmv-dc-comment-layout"));
  }

  function normalizeOriginalCommentWriteBox(panel) {
    if (!(panel instanceof HTMLElement)) return;

    const writeBoxes = panel.querySelectorAll(".cmt_write_box");
    for (const writeBox of writeBoxes) {
      if (!(writeBox instanceof HTMLElement)) continue;
      if (writeBox.dataset.dcmvWriteNormalized === "true") continue;

      const userInfo = writeBox.querySelector(":scope > .fl");
      const textContainer = writeBox.querySelector(":scope > .cmt_txt_cont");
      const writeArea = textContainer?.querySelector?.(":scope > .cmt_write");
      const submitRow = textContainer?.querySelector?.(":scope > .cmt_cont_bottm");

      if (
        !(userInfo instanceof HTMLElement) ||
        !(textContainer instanceof HTMLElement) ||
        !(writeArea instanceof HTMLElement) ||
        !(submitRow instanceof HTMLElement)
      ) {
        continue;
      }

      const topRow = document.createElement("div");
      topRow.className = "dcmv-cmt-write-top";
      topRow.appendChild(userInfo);
      topRow.appendChild(submitRow);

      writeBox.replaceChildren(topRow, writeArea);
      writeBox.dataset.dcmvWriteNormalized = "true";
    }
  }

  // 작성란 접기: 평소엔 작성란을 숨기고, 버튼 줄 왼쪽의 연필 버튼으로 열고 닫는다
  function setupCompactWriteBox(panel, commentKey) {
    if (!(panel instanceof HTMLElement)) return;

    const writeBox = panel.querySelector(".cmt_write_box");
    if (!(writeBox instanceof HTMLElement)) return;

    let isOpen = !!commentKey && moduleState.writeOpenKeys.has(commentKey);
    // 등록 직후 다시 그려질 때: 글이 남아 있으면(등록 실패) 열어두고, 비었으면(성공) 닫는다
    if (commentKey && moduleState.writeSubmitKeys.has(commentKey)) {
      moduleState.writeSubmitKeys.delete(commentKey);
      isOpen = hasWriteDraft(panel);
      if (isOpen) moduleState.writeOpenKeys.add(commentKey);
    }
    panel.dataset.writeOpen = isOpen ? "true" : "false";

    if (isOpen && commentKey && moduleState.focusWriteKey === commentKey) {
      moduleState.focusWriteKey = "";
      // 패널이 화면에 붙은 뒤에 커서를 준다
      window.setTimeout(() => panel.querySelector(".cmt_write_box textarea")?.focus(), 0);
    }
  }

  // 연필 버튼: 버튼 줄 왼쪽 구석
  function addWriteToggleButton(panel) {
    const actionBox = panel.querySelector(":scope > .dcmv-dc-comment-action-box");
    if (!(actionBox instanceof HTMLElement)) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dcmv-dc-comment-icon-btn dcmv-dc-comment-write-btn";
    button.innerHTML = createIconSvg("pencil");
    actionBox.prepend(button);
    syncWriteToggleButton(panel);
  }

  function syncWriteToggleButton(panel) {
    const button = panel.querySelector(".dcmv-dc-comment-write-btn");
    if (!(button instanceof HTMLButtonElement)) return;

    const isOpen = panel.dataset.writeOpen === "true";
    button.title = isOpen ? "댓글 쓰기 닫기" : "댓글 쓰기";
    button.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  function hasWriteDraft(panel) {
    const textarea = panel.querySelector(".cmt_write_box textarea");
    return textarea instanceof HTMLTextAreaElement && textarea.value.trim() !== "";
  }

  function setWriteBoxOpen(panel, open) {
    if (!(panel instanceof HTMLElement) || panel.dataset.writeOpen === undefined) return;

    const nextValue = open ? "true" : "false";
    if (panel.dataset.writeOpen === nextValue) return;
    panel.dataset.writeOpen = nextValue;

    const commentKey = panel.dataset.commentKey || "";
    if (commentKey) {
      if (open) {
        moduleState.writeOpenKeys.add(commentKey);
      } else {
        moduleState.writeOpenKeys.delete(commentKey);
      }
    }

    syncWriteToggleButton(panel);
    updateCommentLayoutSize(panel.closest(".dcmv-dc-comment-layout"));
  }

  function findMatchingSourceControl(panel, clonedControl) {
    const sourceRoot = getSourceCommentRoot(panel) || getSourceCommentRoot(panel, { preferExpanded: true });
    if (!(sourceRoot instanceof HTMLElement) || !(clonedControl instanceof HTMLElement)) {
      return null;
    }

    const id = clonedControl.getAttribute("id");
    if (id) {
      const byId = sourceRoot.querySelector(`#${CSS.escape(id)}`);
      if (byId instanceof HTMLElement) return byId;
    }

    const name = clonedControl.getAttribute("name");
    const type = clonedControl.getAttribute("type");
    if (name) {
      const selector = `[name="${name}"]${type ? `[type="${type}"]` : ""}`;
      const byName = sourceRoot.querySelector(selector);
      if (byName instanceof HTMLElement) return byName;
    }

    const className = clonedControl.className?.trim?.() || "";
    if (className) {
      const selector = className
        .split(/\s+/)
        .filter(Boolean)
        .map((classToken) => `.${classToken}`)
        .join("");
      if (selector) {
        const byClass = sourceRoot.querySelector(selector);
        if (byClass instanceof HTMLElement) return byClass;
      }
    }

    return null;
  }

  function updateCommentActionButton(panel) {
    if (!(panel instanceof HTMLElement)) return;

    const button = panel.querySelector(".dcmv-dc-comment-more-btn");
    if (!(button instanceof HTMLButtonElement)) return;
    const icon = button.querySelector(".dcmv-dc-comment-more-icon");

    if (
      panel.classList.contains("dcmv-dc-comment-panel-empty") ||
      panel.classList.contains("dcmv-dc-comment-panel-collapsed-empty")
    ) {
      const actionBox = button.closest(".dcmv-dc-comment-action-box");
      if (actionBox instanceof HTMLElement) {
        Array.from(actionBox.children).forEach((child) => {
          if (child !== button) {
            child.remove();
          }
        });
      }

      button.textContent = "댓글";
      if (icon instanceof HTMLElement) {
        button.appendChild(icon);
      }
      button.dataset.actionState = "empty";
      button.setAttribute("aria-label", "댓글 열기");
      button.title = "댓글 열기";
      return;
    }

    const isExpanded = panel.dataset.commentExpanded === "true";
    button.textContent = isExpanded ? "접기" : "더보기";
    if (icon instanceof HTMLElement) {
      button.appendChild(icon);
    }
    button.dataset.actionState = isExpanded ? "collapse" : "expand";
    button.setAttribute("aria-label", isExpanded ? "접기" : "더보기");
    button.title = isExpanded ? "접기" : "더보기";
  }

  function getPanelCommentContext(panel) {
    const commentRoot = getHostedCommentRoot(panel);
    const commentKey = panel?.dataset?.commentKey || "";
    const imageArea = getSourceImageArea(panel);
    const hasExpandedRoot =
      imageArea instanceof Element && !!findExpandedCommentRoot(imageArea);

    return {
      commentRoot,
      commentKey,
      hasExpandedRoot,
      isExpanded: panel?.dataset?.commentExpanded === "true",
      isEmptyMode: isEmptyCommentPanel(panel, commentKey)
    };
  }

  function handleEmptyCommentCollapsedPanelClick(panel) {
    const commentKey = panel.dataset.commentKey || "";
    const sourceElement = panel.__dcmvSourceElement;
    const imageArea =
      sourceElement instanceof Element ? sourceElement.closest(".img_area") : null;
    const hasExpandedRoot =
      imageArea instanceof Element && !!findExpandedCommentRoot(imageArea);

    if (isEmptyCommentHidden(commentKey)) {
      setEmptyCommentMode(commentKey, true);
      setEmptyCommentHiddenState(commentKey, false);

      if (commentKey && hasExpandedRoot) {
        requestCommentRefresh();
      } else {
        triggerOriginalEmptyCommentButton(panel);
        waitForCommentRootAndRefresh(imageArea, commentKey);
      }
      return;
    }

    if (commentKey && hasExpandedRoot) {
      setEmptyCommentMode(commentKey, true);
      setEmptyCommentHiddenState(commentKey, false);
      setCommentCollapsedState(commentKey, false);
      requestCommentRefresh();
      return;
    }

    setEmptyCommentMode(commentKey, true);
    setEmptyCommentHiddenState(commentKey, false);
    triggerOriginalEmptyCommentButton(panel);
  }

  function handleEmptyCommentOriginalPanelClick(panel) {
    const { commentRoot, commentKey, hasExpandedRoot, isExpanded } = getPanelCommentContext(panel);

    if (isExpanded) {
      setEmptyCommentMode(commentKey, true);
      setEmptyCommentHiddenState(commentKey, true);
      setCommentCollapsedState(commentKey, false);
      setEmptyCommentPanelExpanded(panel, false);
      return;
    }

    setEmptyCommentMode(commentKey, true);
    setEmptyCommentHiddenState(commentKey, false);
    setCommentCollapsedState(commentKey, false);

    if (commentRoot instanceof HTMLElement) {
      setEmptyCommentPanelExpanded(panel, true);
      return;
    }

    if (commentKey && hasExpandedRoot) {
      requestCommentRefresh();
      return;
    }

    triggerOriginalEmptyCommentButton(panel);
    const imageArea = getSourceImageArea(panel);
    waitForCommentRootAndRefresh(imageArea, commentKey);
  }

  function waitForCommentRootAndRefresh(imageArea, commentKey) {
    if (!(imageArea instanceof Element)) return;

    let observer = null;
    let pollTimer = null;
    let timeout = null;
    let done = false;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const checkAndRefresh = () => {
      if (done) return true;

      if (findExpandedCommentRoot(imageArea)) {
        done = true;
        cleanup();
        requestCommentRefresh();
        return true;
      }
      return false;
    };

    if (checkAndRefresh()) return;

    observer = new MutationObserver(checkAndRefresh);
    observer.observe(imageArea, {
      childList: true,
      subtree: true,
      attributes: true
    });

    pollTimer = setInterval(checkAndRefresh, 120);

    timeout = setTimeout(cleanup, 1500);
  }

  function bindOriginalCommentPanelInteractions(panel) {
    if (!(panel instanceof HTMLElement)) return;
    if (
      !panel.classList.contains("dcmv-dc-comment-panel-original") &&
      !panel.classList.contains("dcmv-dc-comment-panel-empty")
    ) {
      return;
    }
    // 중복 바인딩 방지
    if (panel.dataset.dcmvBound === "true") return;

    panel.dataset.dcmvBound = "true";

    // ─── hover 모드용 마우스 이벤트 (댓글 있는 패널 자체에만) ───
    if (isHasCommentsPanel(panel)) {
      panel.addEventListener("mouseenter", () => {
        if (!alwaysShowComments) {
          panel.dataset.commentVisible = "true";
        }
      });

      panel.addEventListener("mouseleave", () => {
        if (!alwaysShowComments) {
          panel.dataset.commentVisible = "false";
        }
      });
    }

    panel.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLSelectElement)) {
        return;
      }

      const sourceControl = findMatchingSourceControl(panel, target);
      if (
        !(sourceControl instanceof HTMLInputElement) &&
        !(sourceControl instanceof HTMLTextAreaElement) &&
        !(sourceControl instanceof HTMLSelectElement)
      ) {
        return;
      }

      sourceControl.value = target.value;
      if ("checked" in target && "checked" in sourceControl) {
        sourceControl.checked = target.checked;
      }
    });

    panel.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      // 눈 아이콘 버튼 클릭
      const eyeBtn = target.closest(".dcmv-dc-comment-eye-btn");
      if (eyeBtn instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();

        const nextEnabled = !alwaysShowComments;
        saveAlwaysShowComments(nextEnabled);
        syncEyeButtons();
        // 즉시 전체 패널에 적용 (전환 직후 현재 마우스 위치 무관하게 닫기)
        setAllPanelsVisibility(nextEnabled);
        return;
      }

      // 항상 펼치기 버튼 클릭
      const alwaysExpandBtn = target.closest(".dcmv-dc-comment-always-expand-btn");
      if (alwaysExpandBtn instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        toggleAlwaysExpandComments();
        return;
      }

      // 연필 버튼 클릭 → 작성란 열기/닫기 (닫아도 쓰던 글은 남아 있음)
      const writeBtn = target.closest(".dcmv-dc-comment-write-btn");
      if (writeBtn instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        // 접힌 창에는 작성란이 없으므로, 펼치면서(더보기와 같음) 작성란을 열어둔다
        if (panel.dataset.writeOpen === undefined) {
          const { commentKey, hasExpandedRoot } = getPanelCommentContext(panel);
          if (commentKey) {
            moduleState.writeOpenKeys.add(commentKey);
            moduleState.focusWriteKey = commentKey;
          }
          autoExpandedKeys.delete(commentKey);
          setCommentCollapsedState(commentKey, false);
          if (commentKey && hasExpandedRoot) {
            requestCommentRefresh();
          } else {
            expandCollapsedComment(panel);
          }
          return;
        }

        const willOpen = panel.dataset.writeOpen !== "true";
        setWriteBoxOpen(panel, willOpen);
        if (willOpen) panel.querySelector(".cmt_write_box textarea")?.focus();
        return;
      }

      // 아래 화살표 버튼 클릭 (댓글창 아래로) - 전체 적용
      const downBtn = target.closest(".dcmv-dc-comment-move-down-btn");
      if (downBtn instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        forceBelowAll();
        return;
      }

      const pagingControl = target.closest(".cmt_paging a, .cmt_paging button");
      if (pagingControl instanceof HTMLAnchorElement || pagingControl instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        triggerOriginalPagingAction(panel, pagingControl);
        return;
      }

      const sourceButton =
        target.closest(".btn_image_comment, .btn_gallnickuse, .btn_circledel, .btn_blue");
      if (sourceButton instanceof HTMLButtonElement) {
        const originalButton = findMatchingSourceControl(panel, sourceButton);
        if (originalButton instanceof HTMLButtonElement) {
          event.preventDefault();
          event.stopPropagation();
          originalButton.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window
            })
          );
          // 댓글 submit 후 상태만 초기화 (뷰어가 알아서 rebuild 하도록)
          const commentKey = panel.dataset.commentKey || "";
          const imageArea = getSourceImageArea(panel);
          if (commentKey) {
            moduleState.emptyCommentStates.delete(commentKey);
            setCommentCollapsedState(commentKey, false);
            // 항상 펼치기가 켜져 있으면 등록 뒤 다시 열린 창도 자동 펼침으로 본다.
            // (수동 펼침으로 남으면 "마우스 올렸을 때만 보이기"를 무시하고 계속 보인다)
            if (alwaysExpandComments) autoExpandedKeys.add(commentKey);
            // 등록 후에는 작성란을 닫는다 (실패해서 글이 남아 있으면 열린 채로 유지됨)
            if (sourceButton.classList.contains("btn_image_comment")) {
              moduleState.writeOpenKeys.delete(commentKey);
              moduleState.writeSubmitKeys.add(commentKey);
            }
          }
          // btn_imgcmtopen 버튼을 'Y'로 변경 (이제 댓글 있다고 표시)
          const emptyBtn = panel.__dcmvEmptyCommentButton || findEmptyCommentOpenButton(panel.__dcmvSourceElement);
          if (emptyBtn instanceof HTMLButtonElement) {
            emptyBtn.setAttribute("data-has-comment", "Y");
          }
          const sourceEl = panel.__dcmvSourceElement;
          // 0.5초 후 디시 새로고침 → 댓글창 펼치기 → .img_comment.open 생성 확인 → 뷰어 refresh
          if (imageArea instanceof Element) {
            window.setTimeout(() => {
              const refreshBtn = imageArea.querySelector(".btn_img_cmt_refresh, .btn_cmt_refresh");
              if (refreshBtn instanceof HTMLButtonElement) {
                refreshBtn.click();
              }
              // 새로고침 후 댓글창이 접혀있으면 펼치기
              window.setTimeout(() => {
                const openBtn = imageArea.querySelector(".btn_imgcmtopen:not([style*='display: none'])");
                if (openBtn instanceof HTMLButtonElement) {
                  openBtn.click();
                }
                // .img_comment.open이 실제로 생성될 때까지 대기
                let checkCount = 0;
                const maxChecks = 20;  // 최대 2초 (100ms * 20)
                const checkInterval = window.setInterval(() => {
                  checkCount++;
                  const expandedRoot = imageArea.querySelector(".img_comment.open");
                  if (expandedRoot instanceof HTMLElement || checkCount >= maxChecks) {
                    window.clearInterval(checkInterval);
                    // 뷰어 refresh (wrapImageWithComments에서 자동으로 바인딩됨)
                    dispatchCommentRefresh();
                  }
                }, 100);
              }, 400);
            }, 500);
          } else {
            dispatchCommentRefresh(2500);
          }
        }
        return;
      }

      const moreButton = target.closest(".dcmv-dc-comment-more-btn");
      if (moreButton instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();

        if (panel.classList.contains("dcmv-dc-comment-panel-empty")) {
          handleEmptyCommentCollapsedPanelClick(panel);
          return;
        }

        const { commentKey, hasExpandedRoot, isExpanded, isEmptyMode } =
          getPanelCommentContext(panel);

        if (isEmptyMode) {
          handleEmptyCommentOriginalPanelClick(panel);
          return;
        }

        if (isExpanded) {
          setCommentCollapsedState(commentKey, true);
          panel.dataset.commentExpanded = "false";
          requestCommentRefresh();
        } else {
          // 직접 더보기로 연 건 수동 펼침으로 취급 (숨김 모드에서도 항상 보임)
          autoExpandedKeys.delete(commentKey);
          if (commentKey && hasExpandedRoot) {
            setCommentCollapsedState(commentKey, false);
            panel.dataset.commentExpanded = "true";
            requestCommentRefresh();
          } else {
            setCommentCollapsedState(commentKey, false);
            expandCollapsedComment(panel);
          }
        }
        return;
      }
    });
  }

  function syncForceBelowGlobalClass() {
    if (forceBelowMode) {
      document.body.classList.add("dcmv-force-below-global");
    } else {
      document.body.classList.remove("dcmv-force-below-global");
    }
  }

  function applyForceBelowModeToAllLayouts() {
    syncForceBelowGlobalClass();
    const layouts = document.querySelectorAll(".dcmv-dc-comment-layout");
    for (const layout of layouts) {
      if (!(layout instanceof HTMLElement)) continue;

      const { renderBox: imageElement, panel } = getCommentLayoutParts(layout);
      if (!(imageElement instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
        continue;
      }

      if (forceBelowMode) {
        // below 패널로 전환
        ensureBelowCommentPanel(layout);
        layout.dataset.commentPlacement = "below";
        layout.style.removeProperty("--dcmv-dc-comment-width");
        layout.style.setProperty(
          "--dcmv-dc-comment-below-width",
          `${Math.floor(imageElement.getBoundingClientRect().width)}px`
        );
        syncBelowPanelHeight(layout);
      } else {
        // side 패널로 복귀
        ensureSideCommentPanel(layout);
        layout.dataset.commentPlacement = "side";
        layout.style.removeProperty("--dcmv-dc-comment-below-width");
        layout.style.removeProperty("--dcmv-dc-below-panel-height");
        updateCommentLayoutSize(layout);
      }
    }
    updateHudBottomOffset();
    notifyCommentLayoutUpdated();
  }

  function forceBelowAll() {
    saveForceBelowMode(true);
    applyForceBelowModeToAllLayouts();
    // 레이아웃 변경 후 전체 리플로우 트리거
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }

  function unforceBelowAll() {
    saveForceBelowMode(false);
    applyForceBelowModeToAllLayouts();
    // 레이아웃 변경 후 전체 리플로우 트리거
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }

  function ensureStyles() {
    if (moduleState.styleInjected) return;
    if (document.getElementById("dcmv-dcinside-comments-style")) {
      moduleState.styleInjected = true;
      return;
    }

    const style = document.createElement("style");
    style.id = "dcmv-dcinside-comments-style";
    style.textContent = `
.dcmv-dc-comment-layout {
  --dcmv-dc-comment-gap: 12px;
  --dcmv-dc-below-panel-height: 1em;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  max-width: 100%;
}

/* 펼친 댓글의 강제 표시 스타일이 있어도 준비 중인 이미지와 댓글은 함께 숨긴다.
   크기 계산은 유지하고, 페이지 교체 시 대기 표시가 해제되면 함께 나타난다. */
.dcmv-page-wrap[data-dcmv-pending="1"] .dcmv-dc-comment-layout {
  opacity: 0 !important;
  pointer-events: none !important;
}

.dcmv-dc-comment-layout > .dcmv-image-render-box {
  position: relative;
  display: block;
  flex: 0 0 auto;
  max-width: 100%;
}

.dcmv-dc-comment-layout > .dcmv-image-render-box > .dcmv-image {
  display: block;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
}

.dcmv-dc-comment-layout[data-comment-placement="below"] {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  max-height: 100vh;
}

.dcmv-page-pair > .dcmv-dc-comment-layout {
  max-width: 50vw;
}

.dcmv-dc-comment-panel {
  position: absolute;
  top: 50%;
  width: var(--dcmv-dc-comment-width);
  min-width: 0;
  box-sizing: border-box;
  max-height: min(72vh, 920px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  background: rgba(25, 25, 25, 1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #f5f5f5;
  overflow: hidden;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
  z-index: 1;
}

.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-panel {
  position: static;
  width: var(--dcmv-dc-comment-below-width, 100%);
  max-width: var(--dcmv-dc-comment-below-width, 100%);
  flex: 0 0 auto;
  min-height: var(--dcmv-dc-below-panel-height);
  max-height: var(--dcmv-dc-below-panel-height);
  margin-top: 0.5em;
  transform: none !important;
}

.dcmv-dc-comment-layout[data-comment-placement="below"] > .dcmv-image-render-box {
  flex: 0 1 auto;
  max-height: calc(100vh - var(--dcmv-dc-below-panel-height) - 0.75em);
  max-width: 100%;
  width: fit-content !important;
  margin: 0 auto;
}

.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-panel-below-preview {
  border: 0;
  box-shadow: none;
  overflow: hidden;
}

.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-panel-list-below-preview {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: ${BELOW_PREVIEW_ROW_GAP_EM}em;
  height: 100%;
  padding: ${BELOW_PREVIEW_VERTICAL_PADDING_EM / 2}em 0.7em;
  box-sizing: border-box;
}

.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-item-below-preview {
  padding: 0;
  min-height: 0;
}

.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-item-preview-line {
  display: grid;
  grid-template-columns: minmax(0, var(--dcmv-dc-below-preview-nick-width, 0px)) minmax(0, 1fr);
  column-gap: 0.45em;
  align-items: baseline;
  min-width: 0;
  font-size: 0.75rem;
  line-height: ${BELOW_PREVIEW_LINE_HEIGHT};
}

.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-item-preview-writer,
.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-item-preview-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-item-preview-writer {
  color: rgba(255, 255, 255, 0.78);
}

.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-item-preview-text {
  color: #f5f5f5;
}

.dcmv-dc-comment-layout[data-comment-side="left"] .dcmv-dc-comment-panel {
  right: calc(100% + var(--dcmv-dc-comment-gap));
  transform: translateY(-50%);
}

.dcmv-dc-comment-layout[data-comment-side="right"] .dcmv-dc-comment-panel {
  left: calc(100% + var(--dcmv-dc-comment-gap));
  transform: translateY(-50%);
}

.dcmv-dc-comment-layout[data-comment-side="left"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty,
.dcmv-dc-comment-layout[data-comment-side="left"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty {
  right: 100%;
}

.dcmv-dc-comment-layout[data-comment-side="right"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty,
.dcmv-dc-comment-layout[data-comment-side="right"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty {
  left: 100%;
}

.dcmv-dc-comment-layout[data-comment-inset="inside-left"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty,
.dcmv-dc-comment-layout[data-comment-inset="inside-left"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty {
  left: 4px;
  right: auto;
}

.dcmv-dc-comment-layout[data-comment-inset="inside-right"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty,
.dcmv-dc-comment-layout[data-comment-inset="inside-right"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty {
  left: auto;
  right: 4px;
}

.dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${EMPTY_COMMENT_TRIGGER_SIZE}px;
  min-width: ${EMPTY_COMMENT_TRIGGER_SIZE}px;
  max-width: ${EMPTY_COMMENT_TRIGGER_SIZE}px;
  height: 30%;
  min-height: 30%;
  max-height: none;
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty .dcmv-dc-comment-action-box,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-action-box {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.dcmv-dc-comment-layout[data-comment-side="left"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty .dcmv-dc-comment-action-box,
.dcmv-dc-comment-layout[data-comment-side="left"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-action-box {
  justify-content: flex-end;
}

.dcmv-dc-comment-layout[data-comment-side="right"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty .dcmv-dc-comment-action-box,
.dcmv-dc-comment-layout[data-comment-side="right"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-action-box {
  justify-content: flex-start;
}

.dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty .dcmv-dc-comment-more-btn,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-more-btn {
  margin-top: auto;
  margin-bottom: auto;
}

.dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty .dcmv-dc-comment-more-btn,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-more-btn {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: transparent !important;
  font-size: 0 !important;
  line-height: 0 !important;
  text-indent: -9999px;
  padding: 0;
  cursor: pointer;
  position: relative;
  white-space: nowrap;
  overflow: hidden;
  box-shadow: none;
}

.dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty .dcmv-dc-comment-more-btn:hover,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-more-btn:hover {
  background: transparent;
}

.dcmv-dc-comment-panel-original .dcmv-dc-comment-more-icon {
  display: flex;
  align-items: center;
  text-indent: 0;
  pointer-events: none;
}

/* 댓글 없는 이미지의 "댓글" 버튼은 이미지 위 가운데에 뜨므로 같은 그림을 조금 크게(24px 높이) */
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty .dcmv-dc-comment-more-icon,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-more-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  text-indent: 0;
  pointer-events: none;
}

.dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty .dcmv-dc-comment-more-icon svg,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-more-icon svg {
  width: auto;
  height: 24px;
}

.dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty .dcmv-dc-comment-more-icon,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-more-icon {
  opacity: 0;
  transition: opacity 0.14s ease;
}

.dcmv-dc-comment-panel-original .dcmv-dc-comment-more-icon::after,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty .dcmv-dc-comment-more-icon::after,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-more-icon::after {
  content: none;
}

.dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty:hover .dcmv-dc-comment-more-icon,
.dcmv-dc-comment-panel.dcmv-dc-comment-panel-collapsed-empty:hover .dcmv-dc-comment-more-icon {
  opacity: 1;
}

.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-panel.dcmv-dc-comment-panel-empty {
  display: block;
  visibility: hidden;
  pointer-events: none;
  min-height: var(--dcmv-dc-below-panel-height);
}

.dcmv-dc-comment-panel-title {
  box-sizing: border-box;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
}

.dcmv-dc-comment-panel-list {
  min-width: 0;
  overflow-y: auto;
  max-height: inherit;
}

.dcmv-dc-comment-item {
  min-width: 0;
  box-sizing: border-box;
  padding: 10px 14px 12px;
}

.dcmv-dc-comment-item + .dcmv-dc-comment-item {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.dcmv-dc-comment-item-meta {
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.dcmv-dc-comment-item-text {
  margin-top: 5px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.5;
}

.dcmv-dc-comment-item-image {
  display: block;
  max-width: min(100%, 220px);
  max-height: 180px;
  margin-top: 8px;
  border-radius: 10px;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.04);
}

.dcmv-dc-comment-panel-original {
  padding: 0;
  border: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dcmv-dc-comment-panel-original .dcmv-dc-comment-host {
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.dcmv-dc-comment-panel-original .dcmv-dc-comment-action-box {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 10px 10px;
}

.dcmv-dc-comment-panel-original .dcmv-dc-comment-more-btn {
  width: auto;
  height: 24px;
  min-width: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: transparent !important;
  font-size: 0 !important;
  line-height: 0 !important;
  text-indent: -9999px;
  padding: 0 4px;
  cursor: pointer;
  position: relative;
  white-space: nowrap;
  overflow: hidden;
  box-shadow: none;
}

.dcmv-dc-comment-panel-original .dcmv-dc-comment-more-btn:hover {
  background: transparent;
}

.dcmv-dc-comment-panel-original .dcmv-dc-comment-host-imgwrap {
  display: none !important;
}

.dcmv-dc-comment-panel-original .img_comment {
  display: block !important;
  filter: none !important;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  color: #f3f3f3;
}

.dcmv-dc-comment-panel-original .image_comment,
.dcmv-dc-comment-panel-original .view_comment,
.dcmv-dc-comment-panel-original .comment_wrap,
.dcmv-dc-comment-panel-original .comment_box,
.dcmv-dc-comment-panel-original .cmt_list {
  background: transparent !important;
  border-top: 0 !important;
  border-bottom: 0 !important;
  max-width: 100% !important;
  box-sizing: border-box;
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.dcmv-dc-comment-panel-original .comment_box.img_comment_box {
  border: 0;
}

.dcmv-dc-comment-panel-original .comment_wrap,
.dcmv-dc-comment-panel-original .comment_box,
.dcmv-dc-comment-panel-original .cmt_list.add,
.dcmv-dc-comment-panel-original .img_comment {
  border-bottom: 0 !important;
  border-top: 0 !important;
}

.dcmv-dc-comment-panel-original .cmt_list.add > li + li,
.dcmv-dc-comment-panel-original .cmt_info,
.dcmv-dc-comment-panel-original .reply {
  border-color: rgba(255, 255, 255, 0.14) !important;
}

.dcmv-dc-comment-panel-original .cmt_list.add > li {
  padding-left: 12px !important;
  padding-right: 12px !important;
  box-sizing: border-box;
}

.dcmv-dc-comment-panel-original .cmt_list.add > li:first-child,
.dcmv-dc-comment-panel-original .cmt_list.add > li:first-child .cmt_info {
  border-top: 0 !important;
}

.dcmv-dc-comment-panel-original .comment_count .num_box {
  padding-left: 12px !important;
  box-sizing: border-box;
}

.dcmv-dc-comment-panel-original .comment_count {
  display: none;
}

.dcmv-dc-comment-panel-original .cmt_nickbox,
.dcmv-dc-comment-panel-original .nickname,
.dcmv-dc-comment-panel-original .nickname em,
.dcmv-dc-comment-panel-original .date_time,
.dcmv-dc-comment-panel-original .ip,
.dcmv-dc-comment-panel-original .nick_id {
  color: rgba(255, 255, 255, 0.78) !important;
}

.dcmv-dc-comment-panel-original .cmt_txtbox,
.dcmv-dc-comment-panel-original .cmt_txtbox .usertxt,
.dcmv-dc-comment-panel-original .cmt_txtbox p,
.dcmv-dc-comment-panel-original .ub-word {
  color: #f5f5f5 !important;
  white-space: pre-wrap !important;
  word-break: break-word !important;
  overflow-wrap: anywhere !important;
}

.dcmv-dc-comment-panel-original .cmt_info,
.dcmv-dc-comment-panel-original .addbox,
.dcmv-dc-comment-panel-original .cmt_txtbox,
.dcmv-dc-comment-panel-original .cmt_txtbox .usertxt,
.dcmv-dc-comment-panel-original .cmt_txtbox p {
  min-width: 0 !important;
  max-width: 100% !important;
  box-sizing: border-box;
}

.dcmv-dc-comment-panel-original .cmt_info,
.dcmv-dc-comment-panel-original .cmt_txtbox,
.dcmv-dc-comment-panel-original .reply {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

/* 비로그인 댓글의 삭제(X) 버튼: 시간 오른쪽에 있으면 시간이 19px 밀려나서 왼쪽으로 옮긴다.
   어두운 바탕에서 안 보이던 회색 그림은 밝게, 그 댓글에 마우스를 올렸을 때만 보이게 */
.dcmv-dc-comment-panel-original .cmt_info .fr {
  display: flex !important;
  align-items: center;
}

.dcmv-dc-comment-panel-original .cmt_info .fr .cmt_mdf_del {
  order: -1;
  float: none !important;
  margin: 0 6px 0 0 !important;
  visibility: hidden;
}

.dcmv-dc-comment-panel-original .cmt_list > li:hover .cmt_mdf_del {
  visibility: visible;
}

.dcmv-dc-comment-panel-original .cmt_mdf_del .btn_cmt_delete {
  filter: brightness(0) invert(1);
  opacity: 0.55;
}

.dcmv-dc-comment-panel-original .cmt_mdf_del .btn_cmt_delete:hover {
  opacity: 0.9;
}

/* 댓글 본문 글자 크기 고정: 디시의 13px 규칙은 comment_wrap 안에서만 걸려서,
   접힌 창(미리보기 목록만 복사)에서는 12px로 작아지던 문제 */
.dcmv-dc-comment-panel-original .cmt_txtbox .usertxt {
  font-size: 13px !important;
}

/* 닉네임 칸이 13px로 잘려 아랫부분이 흐려 보이던 문제: 높이만 15px로 */
.dcmv-dc-comment-panel-original .cmt_nickbox,
.dcmv-dc-comment-panel-original .cmt_nickbox .nickname {
  height: 15px !important;
  line-height: 15px !important;
}

/* 페이지 번호가 없으면(댓글 1페이지뿐) 빈 페이지 영역과 그 위 구분선을 숨긴다 */
.dcmv-dc-comment-panel-original .bottom_paging_box:not(:has(.cmt_paging > *)) {
  display: none !important;
}

.dcmv-dc-comment-panel-original .cmt_paging {
  display: flex !important;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 12px;
  white-space: normal !important;
}

.dcmv-dc-comment-panel-original .cmt_paging a,
.dcmv-dc-comment-panel-original .cmt_paging button,
.dcmv-dc-comment-panel-original .cmt_paging .page_num,
.dcmv-dc-comment-panel-original .cmt_paging .num_box,
.dcmv-dc-comment-panel-original .cmt_paging .btn_box {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  white-space: nowrap !important;
  float: none !important;
}

.dcmv-dc-comment-panel-original .cmt_paging .btn_box {
  gap: 6px;
}

.dcmv-dc-comment-panel-original .cmt_write_box {
  margin: 8px 10px 0;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05) !important;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* 작성란 접기: 평소엔 숨기고 연필 버튼으로 연다 */
.dcmv-dc-comment-panel[data-write-open="false"] .cmt_write_box {
  display: none !important;
}

/* 연필 버튼은 버튼 줄 왼쪽 구석에 */
.dcmv-dc-comment-action-box .dcmv-dc-comment-write-btn {
  margin-right: auto;
}

.dcmv-dc-comment-panel-original .cmt_write_box,
.dcmv-dc-comment-panel-original .cmt_write_box * {
  color: #f5f5f5 !important;
}

.dcmv-dc-comment-panel-original .cmt_write_box .dcmv-cmt-write-top {
  display: contents;
}

.dcmv-dc-comment-panel-original .cmt_write_box .dcmv-cmt-write-top > .fl,
.dcmv-dc-comment-panel-original .cmt_write_box .dcmv-cmt-write-top > .cmt_cont_bottm,
.dcmv-dc-comment-panel-original .cmt_write_box .cmt_write {
  min-width: 0;
}

.dcmv-dc-comment-panel-original .cmt_write_box .fl {
  order: 1;
  float: none !important;
  width: 100% !important;
  max-width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 10px;
  box-sizing: border-box;
}

.dcmv-dc-comment-panel-original .cmt_write_box .cmt_write {
  order: 2;
}

.dcmv-dc-comment-panel-original .cmt_write_box .user_info_input,
.dcmv-dc-comment-panel-original .cmt_write_box .cmt_write,
.dcmv-dc-comment-panel-original .cmt_write_box .cmt_cont_bottm {
  background: transparent !important;
  border: 0 !important;
}

.dcmv-dc-comment-panel-original .cmt_write_box .user_info_input {
  max-width: 100%;
  min-width: 0;
}

.dcmv-dc-comment-panel-original .cmt_write_box .user_info_input input {
  max-width: 100% !important;
  min-width: 0 !important;
}

.dcmv-dc-comment-panel-original .cmt_write_box .cmt_cont_bottm {
  order: 3;
  display: flex !important;
  align-items: center;
  justify-content: flex-end;
  gap: 0;
  min-width: 0;
  width: 100% !important;
  float: none !important;
}

.dcmv-dc-comment-panel-original .cmt_write_box .cmt_cont_bottm .fr {
  float: none !important;
  display: flex;
  justify-content: flex-end;
  flex: 0 0 auto;
  width: 100%;
}

.dcmv-dc-comment-panel-original .cmt_write_box input,
.dcmv-dc-comment-panel-original .cmt_write_box textarea {
  background: rgba(0, 0, 0, 0.35) !important;
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  color: #f5f5f5 !important;
  box-sizing: border-box;
  max-width: 100% !important;
  min-width: 0 !important;
}

.dcmv-dc-comment-panel-original .cmt_write_box textarea {
  display: block;
  width: 100% !important;
  min-height: 84px;
}

.dcmv-dc-comment-panel-original .cmt_write_box .cmt_textarea_label {
  display: none !important;
}

.dcmv-dc-comment-panel-original .cmt_write_box .btn_blue,
.dcmv-dc-comment-panel-original .cmt_write_box .btn_gallnickuse,
.dcmv-dc-comment-panel-original .cmt_write_box .btn_circledel {
  background: rgba(255, 255, 255, 0.08) !important;
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  color: #f5f5f5 !important;
}

.dcmv-dc-comment-panel-original .cmt_write_box .btn_blue {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  flex: 0 1 auto;
  min-width: 48px;
  min-height: 32px;
  padding: 0 clamp(6px, 2vw, 12px);
  font-size: clamp(11px, 2vw, 12px) !important;
  white-space: nowrap;
}

.dcmv-dc-comment-panel-original .cmt_paging .btn_box,
.dcmv-dc-comment-panel-original .cmt_paging .btn_img_cmt_refresh,
.dcmv-dc-comment-panel-original .cmt_paging .btn_img_cmt_delete,
.dcmv-dc-comment-panel-original .cmt_paging .btn_cmt_refresh,
.dcmv-dc-comment-panel-original .cmt_paging .btn_cmt_close,
.dcmv-dc-comment-panel-original button.btn_cmt_refresh.image_comment.btn_img_cmt_refresh,
.dcmv-dc-comment-panel-original button.btn_cmt_close.image_comment.btn_img_cmt_toggle,
.dcmv-dc-comment-panel-original .cmt_paging .btn_imgcmtopen {
  display: none !important;
}

@media (max-width: 900px) {
  .dcmv-dc-comment-layout {
    width: fit-content;
  }

  .dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-panel {
    width: 100%;
    max-width: 100%;
    min-height: var(--dcmv-dc-below-panel-height);
    max-height: var(--dcmv-dc-below-panel-height);
  }
}

/* 댓글창 아이콘 버튼 공통: 같은 높이·밝기·마우스 반응
   폭은 그림 폭 + 좌우 여백 4px라서, 그림 사이 거리가 아이콘 모양과 상관없이 항상 같다 */
.dcmv-dc-comment-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: 24px;
  min-width: 0;
  padding: 0 4px;
  margin: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  vertical-align: middle;
  opacity: 0.72;
  transition: opacity 0.14s ease;
}

.dcmv-dc-comment-icon-btn:hover {
  opacity: 1;
}

/* 누르는 순간 살짝 어둡게 */
.dcmv-dc-comment-icon-btn:active {
  opacity: 0.5;
}

/* hover 모드: data-comment-visible="false" 이면 내부 콘텐츠만 숨김, 패널 배경은 유지 */
.dcmv-dc-comment-panel[data-comment-visible="false"] {
  opacity: 1;
}

.dcmv-dc-comment-panel[data-comment-visible="false"] > * {
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.12s ease, visibility 0.12s ease;
}

.dcmv-dc-comment-panel[data-comment-visible="true"] > * {
  opacity: 1;
  visibility: visible;
  transition: opacity 0.12s ease, visibility 0.12s ease;
}

/* 더보기 상태일 때는 hover 모드에서도 항상 표시
   (자동 펼치기로 열린 건 제외, 입력 중일 때는 항상 표시) */
.dcmv-dc-comment-panel[data-comment-expanded="true"]:not([data-auto-expanded="true"]),
.dcmv-dc-comment-panel[data-comment-expanded="true"]:not([data-auto-expanded="true"]) > *,
.dcmv-dc-comment-panel:has(textarea:focus, input:focus) > * {
  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
}

/* collapsed-empty 패널은 action-box 항상 표시 */
.dcmv-dc-comment-panel-collapsed-empty .dcmv-dc-comment-action-box {
  opacity: 1 !important;
  visibility: visible !important;
}

.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-panel > * {
  opacity: 1 !important;
  visibility: visible !important;
}

/* below 모드: action-box 완전히 숨김 */
.dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-action-box {
  display: none;
}

/* 위 화살표 버튼 (below 패널 우측 하단)
   크기·밝기 규칙은 다른 아이콘 버튼과 같고, 글 위에 겹치므로 어두운 바탕만 깔아둔다 */
.dcmv-dc-comment-move-up-btn {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.5);
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.14s ease;
}

/* below 패널 아무데나 마우스 올리면 화살표 보임 → 버튼에 올리면 더 밝게 → 누르면 살짝 어둡게 */
.dcmv-dc-comment-panel-below-preview:hover .dcmv-dc-comment-move-up-btn,
.dcmv-dc-comment-panel:hover .dcmv-dc-comment-move-up-btn {
  opacity: 0.72;
}

.dcmv-dc-comment-panel-below-preview:hover .dcmv-dc-comment-move-up-btn:hover,
.dcmv-dc-comment-panel:hover .dcmv-dc-comment-move-up-btn:hover {
  opacity: 1;
}

.dcmv-dc-comment-panel-below-preview:hover .dcmv-dc-comment-move-up-btn:active,
.dcmv-dc-comment-panel:hover .dcmv-dc-comment-move-up-btn:active {
  opacity: 0.5;
}

/* 전역 forceBelowMode가 켜져있을 때만 위 화살표 표시 (사용자가 강제로 아래로 내린 경우에만) */
.dcmv-force-below-global .dcmv-dc-comment-layout[data-comment-placement="below"] .dcmv-dc-comment-move-up-btn {
  display: flex;
}
`;

    document.head.appendChild(style);
    moduleState.styleInjected = true;
  }

  function getImageCommentToggleButton() {
    const button = document.querySelector(".img_comment_toggle");
    return button instanceof HTMLButtonElement ? button : null;
  }

  function isImageCommentDisabled() {
    const button = getImageCommentToggleButton();
    if (!(button instanceof HTMLButtonElement)) return false;
    return button.classList.contains("daesgeuloff");
  }

  function ensureImageCommentVisibility(enabled) {
    const button = getImageCommentToggleButton();
    if (!(button instanceof HTMLButtonElement)) return false;

    const isDisabled = button.classList.contains("daesgeuloff");
    const shouldClick =
      (enabled && isDisabled) ||
      (!enabled && !isDisabled);

    if (!shouldClick) return true;

    button.click();
    return true;
  }

  function createCommentActionBox(hasComments = false) {
    const actionBox = document.createElement("div");
    actionBox.className = "dcmv-dc-comment-action-box";

    // 댓글 있는 패널에만 아래 화살표 + 눈 아이콘 추가 (말풍선 버튼 왼쪽)
    if (hasComments) {
      // 아래 화살표 버튼 (댓글창 아래로)
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "dcmv-dc-comment-icon-btn dcmv-dc-comment-move-down-btn";
      downBtn.title = "댓글창 아래로 내리기";
      downBtn.innerHTML = createDownArrowIconSvg();
      actionBox.appendChild(downBtn);

      // 눈 아이콘 버튼
      const eyeBtn = document.createElement("button");
      eyeBtn.type = "button";
      eyeBtn.className = "dcmv-dc-comment-icon-btn dcmv-dc-comment-eye-btn";
      eyeBtn.title = alwaysShowComments ? "마우스 올려야 표시로 전환" : "항상 표시로 전환";
      eyeBtn.innerHTML = createEyeIconSvg(!alwaysShowComments);
      actionBox.appendChild(eyeBtn);

      // 항상 펼치기 버튼
      const alwaysExpandBtn = document.createElement("button");
      alwaysExpandBtn.type = "button";
      alwaysExpandBtn.className = "dcmv-dc-comment-icon-btn dcmv-dc-comment-always-expand-btn";
      applyAlwaysExpandButtonState(alwaysExpandBtn);
      actionBox.appendChild(alwaysExpandBtn);
    }

    const moreButton = document.createElement("button");
    moreButton.type = "button";
    moreButton.className = "dcmv-dc-comment-icon-btn dcmv-dc-comment-more-btn";

    const moreIcon = document.createElement("span");
    moreIcon.className = "dcmv-dc-comment-more-icon";
    moreIcon.innerHTML = createCommentBubbleIconSvg();
    moreButton.appendChild(moreIcon);

    actionBox.appendChild(moreButton);
    return actionBox;
  }

  function setCommentPanelRenderData(panel, comments, titleText) {
    if (!(panel instanceof HTMLElement)) return panel;
    panel.__dcmvPreviewComments = Array.isArray(comments) ? comments.slice() : [];
    panel.__dcmvTitleText = titleText || "";
    return panel;
  }

  function normalizeBelowPreviewWriter(writer) {
    if (!writer) return "";

    return String(writer)
      .replace(/\s*\((?:\d{1,3}\.){2,3}\d{1,3}\)\s*$/u, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function truncateBelowPreviewWriter(writer, maxLength = 5) {
    const normalizedWriter = normalizeBelowPreviewWriter(writer);
    if (!normalizedWriter) return "";

    const chars = Array.from(normalizedWriter);
    if (chars.length <= maxLength) {
      return normalizedWriter;
    }

    return `${chars.slice(0, maxLength).join("")}...`;
  }

  function getBelowPreviewCommentText(comment) {
    if (!comment || typeof comment !== "object") return "";

    return comment.text || (comment.imageUrl ? comment.imageAlt || "이미지 댓글" : "") || "";
  }

  function getBelowPreviewNickWidthEm(comments) {
    const previewComments = Array.isArray(comments)
      ? comments.slice(0, BELOW_PREVIEW_MAX_COMMENTS)
      : [];
    const maxLength = previewComments.reduce((maxValue, comment) => {
      const displayWriter = truncateBelowPreviewWriter(comment?.writer || "");
      return Math.max(maxValue, Array.from(displayWriter).length);
    }, 0);

    if (!maxLength) {
      return 0;
    }

    return Math.min(6.2, Math.max(2.2, maxLength * 0.82 + 0.5));
  }

  function createBelowPreviewPanel(comments, titleText) {
    const panel = document.createElement("aside");
    panel.className = "dcmv-dc-comment-panel dcmv-dc-comment-panel-below-preview";
    setCommentPanelRenderData(panel, comments, titleText);

    const list = document.createElement("div");
    list.className = "dcmv-dc-comment-panel-list dcmv-dc-comment-panel-list-below-preview";

    const previewComments = Array.isArray(comments)
      ? comments.slice(0, BELOW_PREVIEW_MAX_COMMENTS)
      : [];
    panel.style.setProperty(
      "--dcmv-dc-below-preview-line-count",
      `${Math.max(previewComments.length, 1)}`
    );
    const nickWidthEm = getBelowPreviewNickWidthEm(previewComments);
    if (nickWidthEm > 0) {
      panel.style.setProperty("--dcmv-dc-below-preview-nick-width", `${nickWidthEm}em`);
    } else {
      panel.style.removeProperty("--dcmv-dc-below-preview-nick-width");
    }

    for (const comment of previewComments) {
      const item = document.createElement("article");
      item.className = "dcmv-dc-comment-item dcmv-dc-comment-item-below-preview";

      const line = document.createElement("div");
      line.className = "dcmv-dc-comment-item-preview-line";

      const writer = truncateBelowPreviewWriter(comment?.writer || "");
      if (writer) {
        const writerSpan = document.createElement("span");
        writerSpan.className = "dcmv-dc-comment-item-preview-writer";
        writerSpan.textContent = writer;
        line.appendChild(writerSpan);
      }

      const textSpan = document.createElement("span");
      textSpan.className = "dcmv-dc-comment-item-preview-text";
      textSpan.textContent = getBelowPreviewCommentText(comment) || "이미지 댓글";
      line.appendChild(textSpan);

      item.appendChild(line);

      list.appendChild(item);
    }

    panel.appendChild(list);

    // 위 화살표 버튼 (댓글창 위로 - 사용자 강제 below 모드에서만 표시)
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "dcmv-dc-comment-icon-btn dcmv-dc-comment-move-up-btn";
    upBtn.title = "댓글창 위로 올리기";
    upBtn.innerHTML = createUpArrowIconSvg();
    panel.appendChild(upBtn);

    return panel;
  }

  function applyAlwaysExpandButtonState(button) {
    button.innerHTML = createAlwaysExpandIconSvg(!alwaysExpandComments);
    button.title = alwaysExpandComments ? "댓글 항상 펼치기" : "댓글 항상 접기";
    button.setAttribute("aria-pressed", alwaysExpandComments ? "true" : "false");
  }

  function syncAlwaysExpandButtons() {
    document
      .querySelectorAll(".dcmv-dc-comment-always-expand-btn")
      .forEach((btn) => applyAlwaysExpandButtonState(btn));
  }

  function toggleAlwaysExpandComments() {
    alwaysExpandComments = !alwaysExpandComments;
    if (typeof saveAlwaysExpandCommentsCallback === "function") {
      saveAlwaysExpandCommentsCallback(alwaysExpandComments);
    }
    syncAlwaysExpandButtons();
    if (!alwaysExpandComments) {
      // 끄면 전부 접어서, 켜고 끈 차이가 바로 보이게 한다 (다시 켜면 요청 없이 그대로 펼쳐짐)
      collapseAllExpandedComments();
      requestCommentRefresh();
      return;
    }

    // 버튼으로 켤 때는 직접 접어둔 것과 이전 실패 기록도 비우고 전부 다시 펼친다
    moduleState.collapsedCommentKeys.clear();
    autoExpandTries.clear();
    requestCommentRefresh();
    scheduleAutoExpandAll(0);
  }

  function scheduleAutoExpandAll(delay = 150) {
    if (!alwaysExpandComments) return;
    window.clearTimeout(autoExpandRun.timer);
    autoExpandRun.timer = window.setTimeout(runAutoExpandAll, delay);
  }

  function getImageAreaCommentKey(imageArea) {
    const imageElement =
      imageArea.querySelector(".imgwrap img") || imageArea.querySelector("img");
    return getCommentSourceKey(imageElement);
  }

  // 펼쳐진 댓글창을 전부 접는다 ("접기"를 누른 것과 같음, "더보기"로 직접 연 것도 포함)
  function collapseAllExpandedComments() {
    document.querySelectorAll(".img_area").forEach((imageArea) => {
      if (imageArea.closest(".dcmv-dc-comment-panel")) return;
      if (!findExpandedCommentRoot(imageArea)) return;
      // 댓글 없는 이미지에서 첫 댓글을 쓰려고 연 창은 건드리지 않는다
      if (findEmptyCommentOpenButton(imageArea.querySelector("img"))) return;

      const commentKey = getImageAreaCommentKey(imageArea);
      if (commentKey) setCommentCollapsedState(commentKey, true);
    });
  }

  // 자동으로 펼칠 대상: 접힌 댓글이 있고, 사용자가 직접 접지 않았고, 시도 횟수가 남은 이미지
  function collectAutoExpandTargets() {
    const targets = [];
    document.querySelectorAll(".img_area").forEach((imageArea) => {
      // 뷰어 댓글창 안의 복제본은 제외
      if (imageArea.closest(".dcmv-dc-comment-panel")) return;
      if (findExpandedCommentRoot(imageArea)) return;

      const commentRoot = imageArea.querySelector(".img_comment.getMoreComment:not(.open)");
      if (!isSelectableCommentRoot(commentRoot)) return;

      const commentKey = getImageAreaCommentKey(imageArea);
      if (commentKey && moduleState.collapsedCommentKeys.has(commentKey)) return;

      const triesKey = commentKey || commentRoot;
      if ((autoExpandTries.get(triesKey) || 0) >= AUTO_EXPAND_MAX_TRIES) return;

      targets.push({ imageArea, commentRoot, commentKey, triesKey });
    });
    return targets;
  }

  function clickOriginalFoldExpand({ commentRoot, triesKey }) {
    autoExpandTries.set(triesKey, (autoExpandTries.get(triesKey) || 0) + 1);
    const trigger = commentRoot.querySelector("li:last-child .cmt_txtbox") || commentRoot;

    try {
      if (typeof globalRoot.jQuery === "function") {
        globalRoot.jQuery(trigger).trigger("click");
      } else {
        trigger.click();
      }
    } catch {
      // 클릭이 실패하면 다음 시도에서 다시 해본다
    }
  }

  function waitForCommentsExpanded(imageAreas, timeoutMs) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const allExpanded = imageAreas.every((area) => !!findExpandedCommentRoot(area));
        if (allExpanded || Date.now() - startedAt >= timeoutMs) {
          resolve();
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function runAutoExpandAll() {
    if (!alwaysExpandComments) return;
    if (autoExpandRun.running) {
      autoExpandRun.rerun = true;
      return;
    }

    autoExpandRun.running = true;
    let expandedAny = false;
    let isFirstBatch = true;
    let lastBatchFailed = false;

    try {
      // 1회차는 전부, 2회차는 동시에 보내다 빠진 것만 다시 시도
      for (let round = 0; round < AUTO_EXPAND_MAX_TRIES; round++) {
        const targets = collectAutoExpandTargets();
        if (!targets.length) break;

        for (let i = 0; i < targets.length; i += AUTO_EXPAND_BATCH_SIZE) {
          // 묶음 사이에 쉬고, 직전 묶음에 실패가 있었으면 더 쉰다
          if (!isFirstBatch) {
            await sleep(
              AUTO_EXPAND_BATCH_GAP_MS + (lastBatchFailed ? AUTO_EXPAND_FAIL_EXTRA_GAP_MS : 0)
            );
          }
          isFirstBatch = false;
          lastBatchFailed = false;
          if (!alwaysExpandComments) return;

          const batch = targets.slice(i, i + AUTO_EXPAND_BATCH_SIZE);
          batch.forEach(clickOriginalFoldExpand);
          await waitForCommentsExpanded(
            batch.map((target) => target.imageArea),
            AUTO_EXPAND_WAIT_MS
          );

          batch.forEach(({ imageArea, commentKey, triesKey }) => {
            if (findExpandedCommentRoot(imageArea)) {
              // 성공한 건 기록을 지워서, 나중에 디시가 다시 접어도 또 펼칠 수 있게 한다
              autoExpandTries.delete(triesKey);
              if (commentKey) autoExpandedKeys.add(commentKey);
              expandedAny = true;
            } else {
              lastBatchFailed = true;
            }
          });
        }
      }
    } finally {
      autoExpandRun.running = false;
      if (!alwaysExpandComments) {
        // 펼치는 도중에 꺼졌으면, 끈 뒤에 늦게 펼쳐진 것까지 다시 접는다
        collapseAllExpandedComments();
        requestCommentRefresh();
      } else if (expandedAny) {
        // 하나씩 펼칠 때마다가 아니라 다 끝난 뒤 화면을 한 번만 다시 그린다
        requestCommentRefresh();
      }
      if (autoExpandRun.rerun) {
        autoExpandRun.rerun = false;
        scheduleAutoExpandAll();
      }
    }
  }

  function syncEyeButtons() {
    document.querySelectorAll(".dcmv-dc-comment-eye-btn").forEach((btn) => {
      const slashed = !alwaysShowComments;
      btn.innerHTML = createEyeIconSvg(slashed);
      btn.title = slashed ? "항상 표시로 전환" : "마우스 올려야 표시로 전환";
    });
  }

  function createCommentPanel(comments, titleText) {
    const panel = document.createElement("aside");
    panel.className = "dcmv-dc-comment-panel";
    setCommentPanelRenderData(panel, comments, titleText);
    const hasComments = Array.isArray(comments) && comments.length > 0;

    if (!hasComments) {
      panel.classList.add("dcmv-dc-comment-panel-empty");
      panel.appendChild(createCommentActionBox());
      updateCommentActionButton(panel);
      return panel;
    }

    const title = document.createElement("div");
    title.className = "dcmv-dc-comment-panel-title";
    title.textContent = titleText || `이미지 댓글 ${comments.length}개`;
    panel.appendChild(title);

    const list = document.createElement("div");
    list.className = "dcmv-dc-comment-panel-list";

    for (const comment of comments) {
      const item = document.createElement("article");
      item.className = "dcmv-dc-comment-item";

      const metaText = [comment.writer, comment.dateText].filter(Boolean).join(" · ");
      if (metaText) {
        const meta = document.createElement("div");
        meta.className = "dcmv-dc-comment-item-meta";
        meta.textContent = metaText;
        item.appendChild(meta);
      }

      if (comment.text) {
        const text = document.createElement("div");
        text.className = "dcmv-dc-comment-item-text";
        text.textContent = comment.text;
        item.appendChild(text);
      }

      if (comment.imageUrl) {
        const image = document.createElement("img");
        image.className = "dcmv-dc-comment-item-image";
        image.src = comment.imageUrl;
        image.alt = comment.imageAlt || "이미지 댓글";
        image.loading = "lazy";
        item.appendChild(image);
      }

      list.appendChild(item);
    }

    panel.appendChild(list);
    return panel;
  }

  function applyCommentPanelMeta(panel, options = {}) {
    if (!(panel instanceof HTMLElement)) return panel;

    const {
      commentKey = "",
      sourceElement = null,
      emptyCommentButton = null
    } = options;

    panel.dataset.commentKey = commentKey || "";
    panel.__dcmvEmptyCommentButton = emptyCommentButton;
    panel.__dcmvSourceElement = sourceElement;
    return panel;
  }

  function getCommentLayoutParts(layout) {
    if (!(layout instanceof HTMLElement)) return {};
    const renderBox = layout.querySelector(":scope > .dcmv-image-render-box");
    const panel = layout.querySelector(":scope > .dcmv-dc-comment-panel");
    const imageElement =
      renderBox instanceof HTMLElement
        ? renderBox.querySelector(":scope > .dcmv-image")
        : null;
    return {
      renderBox: renderBox instanceof HTMLElement ? renderBox : null,
      imageElement: imageElement instanceof HTMLElement ? imageElement : null,
      panel: panel instanceof HTMLElement ? panel : null
    };
  }

  function getSideCommentPanel(layout) {
    return layout?.__dcmvSideCommentPanel instanceof HTMLElement
      ? layout.__dcmvSideCommentPanel
      : null;
  }

  function getBelowCommentPanel(layout) {
    return layout?.__dcmvBelowCommentPanel instanceof HTMLElement
      ? layout.__dcmvBelowCommentPanel
      : null;
  }

  function replaceLayoutPanel(layout, nextPanel) {
    if (!(layout instanceof HTMLElement) || !(nextPanel instanceof HTMLElement)) return nextPanel;

    const currentPanel = layout.querySelector(":scope > .dcmv-dc-comment-panel");
    if (currentPanel === nextPanel) return nextPanel;

    if (currentPanel instanceof HTMLElement) {
      currentPanel.replaceWith(nextPanel);
    } else {
      layout.appendChild(nextPanel);
    }

    return nextPanel;
  }

  function ensureBelowCommentPanel(layout) {
    if (!(layout instanceof HTMLElement)) return null;

    const currentPanel = layout.querySelector(":scope > .dcmv-dc-comment-panel");
    if (
      currentPanel instanceof HTMLElement &&
      currentPanel.classList.contains("dcmv-dc-comment-panel-empty")
    ) {
      return currentPanel;
    }

    let belowPanel = getBelowCommentPanel(layout);
    if (!(belowPanel instanceof HTMLElement)) {
      const sidePanel = getSideCommentPanel(layout);
      if (!(sidePanel instanceof HTMLElement)) {
        return currentPanel instanceof HTMLElement ? currentPanel : null;
      }

      belowPanel = createBelowPreviewPanel(sidePanel.__dcmvPreviewComments || [], sidePanel.__dcmvTitleText || "");
      applyCommentPanelMeta(belowPanel, {
        commentKey: sidePanel.dataset.commentKey || "",
        sourceElement: sidePanel.__dcmvSourceElement || null,
        emptyCommentButton: sidePanel.__dcmvEmptyCommentButton || null
      });
      layout.__dcmvBelowCommentPanel = belowPanel;
    }

    const finalPanel = replaceLayoutPanel(layout, belowPanel);

    // 위 화살표 버튼 이벤트 핸들러 바인딩 (중복 방지)
    if (belowPanel instanceof HTMLElement && !belowPanel.dataset.dcmvUpBtnBound) {
      belowPanel.dataset.dcmvUpBtnBound = "true";
      belowPanel.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const upBtn = target.closest(".dcmv-dc-comment-move-up-btn");
        if (upBtn instanceof HTMLButtonElement) {
          event.preventDefault();
          event.stopPropagation();
          unforceBelowAll();
        }
      });
    }

    return finalPanel;
  }

  function getBelowPreviewPanelHeightPx(panel) {
    if (!(panel instanceof HTMLElement)) return 0;
    if (!panel.classList.contains("dcmv-dc-comment-panel-below-preview")) return 0;

    const list = panel.querySelector(".dcmv-dc-comment-panel-list-below-preview");
    const lines = panel.querySelectorAll(".dcmv-dc-comment-item-preview-line");
    const lineCount = Math.max(1, lines.length || 0);
    if (!(list instanceof HTMLElement)) return 0;

    const listStyle = window.getComputedStyle(list);
    const firstLine =
      lines.length > 0 && lines[0] instanceof HTMLElement ? lines[0] : null;
    const lineStyle = firstLine ? window.getComputedStyle(firstLine) : null;
    const lineHeight = lineStyle ? parseFloat(lineStyle.lineHeight || "0") : 0;
    const paddingTop = parseFloat(listStyle.paddingTop || "0") || 0;
    const paddingBottom = parseFloat(listStyle.paddingBottom || "0") || 0;
    const rowGap =
      parseFloat(listStyle.rowGap || listStyle.gap || "0") || 0;

    return Math.ceil(
      paddingTop +
      paddingBottom +
      lineCount * Math.max(lineHeight, 0) +
      Math.max(0, lineCount - 1) * rowGap
    );
  }

  function syncBelowPanelHeight(layout, forcedHeightPx = 0) {
    if (!(layout instanceof HTMLElement)) return;
    const panel = layout.querySelector(":scope > .dcmv-dc-comment-panel");
    if (!(panel instanceof HTMLElement)) return;

    if (layout.dataset.commentPlacement !== "below") {
      layout.style.removeProperty("--dcmv-dc-below-panel-height");
      return;
    }

    let heightPx = Math.max(0, forcedHeightPx || 0);
    if (!heightPx) {
      if (panel.classList.contains("dcmv-dc-comment-panel-below-preview")) {
        heightPx = getBelowPreviewPanelHeightPx(panel);
      } else if (panel.classList.contains("dcmv-dc-comment-panel-empty")) {
        heightPx = 0;
      } else {
        heightPx = Math.ceil(panel.getBoundingClientRect().height);
      }
    }

    if (heightPx > 0) {
      layout.style.setProperty("--dcmv-dc-below-panel-height", `${heightPx}px`);
    } else {
      layout.style.removeProperty("--dcmv-dc-below-panel-height");
    }
  }

  function updateHudBottomOffset() {
    const belowPanels = Array.from(
      document.querySelectorAll(
        ".dcmv-dc-comment-layout[data-comment-placement=\"below\"] > .dcmv-dc-comment-panel"
      )
    ).filter((panel) => panel instanceof HTMLElement);

    const maxOffsetPx = belowPanels.reduce((maxValue, panel) => {
      if (!(panel instanceof HTMLElement)) return maxValue;
      const panelStyle = window.getComputedStyle(panel);
      const marginTop = parseFloat(panelStyle.marginTop || "0") || 0;
      return Math.max(maxValue, Math.ceil(panel.getBoundingClientRect().height + marginTop));
    }, 0);

    const rootStyle = document.documentElement?.style;
    if (!rootStyle) return;

    if (maxOffsetPx > 0) {
      rootStyle.setProperty("--dcmv-hud-bottom-offset", `${maxOffsetPx}px`);
    } else {
      rootStyle.removeProperty("--dcmv-hud-bottom-offset");
    }

    notifyCommentLayoutUpdated();
  }

  function ensureSideCommentPanel(layout) {
    if (!(layout instanceof HTMLElement)) return null;

    const sidePanel = getSideCommentPanel(layout);
    if (!(sidePanel instanceof HTMLElement)) {
      return layout.querySelector(":scope > .dcmv-dc-comment-panel");
    }

    return replaceLayoutPanel(layout, sidePanel);
  }

  function updateCommentLayoutSize(layout) {
    if (!(layout instanceof HTMLElement)) return;

    const pairWrap = layout.parentElement;
    if (pairWrap instanceof HTMLElement && pairWrap.classList.contains("dcmv-page-pair")) {
      updatePairCommentLayouts(pairWrap);
      updateHudBottomOffset();
      return;
    }

    updateSingleCommentLayout(layout);
    updateHudBottomOffset();
  }

  function applyEmptyCommentPlacement(layout, imageElement) {
    const rect = imageElement.getBoundingClientRect();
    const side = layout.dataset.commentSide === "left" ? "left" : "right";
    
    // 남은 공간의 60%, 최소 80px
    const availableSpace = side === "left" 
      ? rect.left - 24
      : window.innerWidth - rect.right - 24;
    const size = Math.max(80, Math.floor(availableSpace * 0.6));
    
    const overflowLeft = side === "left" && rect.left - size - 12 < 0;
    const overflowRight =
      side === "right" &&
      rect.right + size + 12 > window.innerWidth;

    layout.dataset.commentPlacement = "side";
    layout.style.setProperty("--dcmv-dc-comment-width", `${size}px`);
    layout.dataset.commentInset =
      overflowLeft || overflowRight
        ? side === "left"
          ? "inside-left"
          : "inside-right"
        : "";
  }

  function applyMeasuredCommentPlacement(layout, imageElement, sideMetrics, forceBelow = false, userForcedBelow = false) {
    // 사용자가 강제로 below 모드로 전환한 경우 side로 돌아가지 않음
    if (userForcedBelow || forceBelow || sideMetrics.willClip) {
      layout.dataset.commentPlacement = "below";
      layout.style.setProperty("--dcmv-dc-comment-width", `${sideMetrics.width}px`);
      layout.style.setProperty(
        "--dcmv-dc-comment-below-width",
        `${Math.floor(imageElement.getBoundingClientRect().width)}px`
      );
      ensureBelowCommentPanel(layout);
      syncBelowPanelHeight(layout);
      return;
    }

    layout.dataset.commentPlacement = "side";
    layout.style.setProperty("--dcmv-dc-comment-width", `${sideMetrics.width}px`);
    layout.style.removeProperty("--dcmv-dc-comment-below-width");
    layout.dataset.commentInset = "";
    ensureSideCommentPanel(layout);
    layout.style.removeProperty("--dcmv-dc-below-panel-height");
  }

  function updateSingleCommentLayout(layout, options = {}) {
    if (!(layout instanceof HTMLElement)) return;

    const { renderBox: imageElement, panel } = getCommentLayoutParts(layout);
    if (!(imageElement instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
      return;
    }

    // 전역 below 모드 강제 설정이 있으면 화면 비율 조정 무시
    const globalForceBelow = isForceBelowMode();

    if (panel.classList.contains("dcmv-dc-comment-panel-empty")) {
      applyEmptyCommentPlacement(layout, imageElement);
      return;
    }

    const sideMetrics =
      options.sideMetricsOverride ||
      measureSingleSideCommentMetrics(layout, imageElement, panel);
    applyMeasuredCommentPlacement(layout, imageElement, sideMetrics, options.forceBelow, globalForceBelow);
  }

  function getSideCommentMetrics(layout, imageElement, panel) {
    const rect = imageElement.getBoundingClientRect();
    const gap = 12;
    const viewportPadding = 12;
    const side = layout.dataset.commentSide === "left" ? "left" : "right";
    const availableWidth =
      side === "left"
        ? rect.left - gap - viewportPadding
        : window.innerWidth - rect.right - gap - viewportPadding;
    const roundedAvailableWidth = Math.floor(availableWidth);
    const desiredWidth = Math.min(SIDE_COMMENT_MAX_WIDTH, roundedAvailableWidth);
    const width = Math.max(0, desiredWidth);
    const panelStyle = window.getComputedStyle(panel);
    const emThreshold = parseFloat(panelStyle.fontSize || "16") * SIDE_COMMENT_BELOW_EM;
    const willClip = desiredWidth < emThreshold;

    return {
      width,
      willClip
    };
  }

  function measureSingleSideCommentMetrics(layout, imageElement, panel) {
    const previousPlacement = layout.dataset.commentPlacement;
    const previousWidth = layout.style.getPropertyValue("--dcmv-dc-comment-width");

    prepareCommentLayoutForMeasurement(layout);

    const sideMetrics = getSideCommentMetrics(layout, imageElement, panel);

    layout.dataset.commentPlacement = previousPlacement || "side";
    if (previousWidth) {
      layout.style.setProperty("--dcmv-dc-comment-width", previousWidth);
    } else {
      layout.style.removeProperty("--dcmv-dc-comment-width");
    }

    return sideMetrics;
  }

  function prepareCommentLayoutForMeasurement(layout) {
    if (!(layout instanceof HTMLElement)) return;

    layout.dataset.commentPlacement = "side";
    layout.style.setProperty("--dcmv-dc-comment-width", "0px");
    layout.getBoundingClientRect();
  }

  function updatePairCommentLayouts(pairWrap) {
    if (!(pairWrap instanceof HTMLElement)) return;

    const layouts = Array.from(pairWrap.children).filter(
      (child) =>
        child instanceof HTMLElement &&
        child.classList.contains("dcmv-dc-comment-layout")
    );

    if (!layouts.length) return;

    for (const layout of layouts) {
      const { panel } = getCommentLayoutParts(layout);
      if (!(panel instanceof HTMLElement)) continue;
      prepareCommentLayoutForMeasurement(layout);
    }

    const measurements = [];
    let shouldForceBelow = isForceBelowMode(); // 전역 설정 먼저 체크

    for (const layout of layouts) {
      const { renderBox: imageElement, panel } = getCommentLayoutParts(layout);
      if (!(imageElement instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
        continue;
      }

      if (panel.classList.contains("dcmv-dc-comment-panel-empty")) {
        measurements.push({
          layout,
          sideMetrics: {
            width: 0,
            willClip: false
          }
        });
        continue;
      }

      const sideMetrics = getSideCommentMetrics(layout, imageElement, panel);
      measurements.push({
        layout,
        sideMetrics
      });

      // 전역 below 모드가 아닌 경우에만 willClip 체크
      if (!shouldForceBelow && sideMetrics.willClip) {
        shouldForceBelow = true;
      }
    }

    for (const measurement of measurements) {
      updateSingleCommentLayout(measurement.layout, {
        forceBelow: shouldForceBelow,
        sideMetricsOverride: measurement.sideMetrics
      });
    }

    if (shouldForceBelow) {
      for (const measurement of measurements) {
        const { renderBox: imageElement, panel } = getCommentLayoutParts(measurement.layout);
        if (
          !(panel instanceof HTMLElement) ||
          !(imageElement instanceof HTMLElement) ||
          !panel.classList.contains("dcmv-dc-comment-panel-empty")
        ) {
          continue;
        }

        applyMeasuredCommentPlacement(measurement.layout, imageElement, measurement.sideMetrics, true);
      }

      const panels = layouts
        .map((layout) => layout.querySelector(":scope > .dcmv-dc-comment-panel"))
        .filter((panel) => panel instanceof HTMLElement);
      const maxBelowHeight = panels.reduce((maxHeight, panel) => {
        if (!(panel instanceof HTMLElement)) return maxHeight;
        const previewHeightPx = getBelowPreviewPanelHeightPx(panel);
        if (previewHeightPx > 0) {
          return Math.max(maxHeight, previewHeightPx);
        }

        if (panel.classList.contains("dcmv-dc-comment-panel-empty")) return maxHeight;
        return Math.max(maxHeight, Math.ceil(panel.getBoundingClientRect().height));
      }, 0);

      for (const layout of layouts) {
        if (!(layout instanceof HTMLElement)) continue;
        syncBelowPanelHeight(layout, Math.max(maxBelowHeight, 0));
      }
    } else {
      for (const layout of layouts) {
        if (!(layout instanceof HTMLElement)) continue;
        syncBelowPanelHeight(layout, 0);
      }
    }
  }

  function updateAllCommentLayouts() {
    const layouts = document.querySelectorAll(".dcmv-dc-comment-layout");
    for (const layout of layouts) {
      updateCommentLayoutSize(layout);
    }
    updateHudBottomOffset();
  }

  function getInitialSideCommentWidth() {
    if (window.innerWidth <= 1200) {
      return Math.min(window.innerWidth * 0.3, 280);
    }

    return Math.min(window.innerWidth * 0.26, 320);
  }

  function ensureResizeBinding() {
    if (moduleState.resizeBound) return;

    window.addEventListener("resize", updateAllCommentLayouts, { passive: true });
    moduleState.resizeBound = true;
  }

  function wrapImageWithComments(options = {}) {
    const {
      imageElement,
      sourceElement = null,
      comments = [],
      side = "right",
      titleText = "",
      originalCommentRoot = null,
      emptyCommentButton = null,
      commentKey = ""
    } = options;

    if (!(imageElement instanceof HTMLElement)) {
      return null;
    }

    ensureStyles();

    const layout = document.createElement("div");
    layout.className = "dcmv-dc-comment-layout";
    layout.dataset.commentSide = side === "left" ? "left" : "right";
    layout.dataset.commentPlacement = "side";
    layout.style.setProperty(
      "--dcmv-dc-comment-width",
      `${Math.floor(getInitialSideCommentWidth())}px`
    );
    layout.style.setProperty("--dcmv-dc-below-panel-height", "1em");

    const existingRenderBox =
      imageElement.parentElement instanceof HTMLElement &&
      imageElement.parentElement.classList.contains("dcmv-image-render-box")
        ? imageElement.parentElement
        : null;
    const renderBox = existingRenderBox || document.createElement("div");
    if (!existingRenderBox) {
      renderBox.className = "dcmv-image-render-box";
      renderBox.appendChild(imageElement);
    }

    let panel = document.createElement("aside");
    panel.className = "dcmv-dc-comment-panel";
    applyCommentPanelMeta(panel, {
      commentKey,
      sourceElement,
      emptyCommentButton
    });
    setCommentPanelRenderData(panel, comments, titleText);
    const hasOriginalCommentRoot = moveOriginalCommentRoot(originalCommentRoot, panel);
    if (!hasOriginalCommentRoot) {
      panel = createCommentPanel(comments, titleText);
      applyCommentPanelMeta(panel, {
        commentKey,
        sourceElement,
        emptyCommentButton
      });
    } else {
      if (emptyCommentButton) {
        panel.dataset.commentExpanded = "true";
      }
      // 사용자가 접은 상태면 강제로 false로 설정
      if (commentKey && moduleState.collapsedCommentKeys.has(commentKey)) {
        panel.dataset.commentExpanded = "false";
      }
      // 항상 펼치기가 켜져 있는데 아직 접힌 댓글이 보이면 자동으로 펼친다
      if (alwaysExpandComments && panel.dataset.commentExpanded !== "true") {
        scheduleAutoExpandAll();
      }
      // 자동으로 펼친 댓글창은 눈 아이콘 숨김 모드를 따르도록 표시
      if (
        panel.dataset.commentExpanded === "true" &&
        commentKey &&
        autoExpandedKeys.has(commentKey)
      ) {
        panel.dataset.autoExpanded = "true";
      }
      normalizeOriginalCommentWriteBox(panel);
      // 댓글 없는 이미지에서 쓰려고 연 경우는 바로 쓸 수 있게 접지 않는다
      if (!emptyCommentButton && !isEmptyCommentMode(commentKey)) {
        setupCompactWriteBox(panel, commentKey);
      }
      // 댓글 있는 패널이므로 hasComments=true → 눈 아이콘 추가
      panel.appendChild(createCommentActionBox(true));
      // 연필 버튼은 접힌 창에도 보인다 (댓글 없는 이미지의 첫 댓글 창은 작성란이 이미 열려 있어 제외)
      if (!emptyCommentButton && !isEmptyCommentMode(commentKey)) {
        addWriteToggleButton(panel);
      }
      updateCommentActionButton(panel);
      if (isEmptyCommentMode(commentKey) && isEmptyCommentHidden(commentKey)) {
        setEmptyCommentPanelExpanded(panel, false);
      }
      // hover 모드면 초기에 숨김
      if (!alwaysShowComments) {
        panel.dataset.commentVisible = "false";
      } else {
        panel.dataset.commentVisible = "true";
      }
    }

    layout.__dcmvSideCommentPanel = panel;
    layout.__dcmvBelowCommentPanel = null;
    layout.appendChild(renderBox);
    layout.appendChild(panel);
    bindOriginalCommentPanelInteractions(panel);

    ensureResizeBinding();
    queueMicrotask(() => {
      prepareCommentLayoutForMeasurement(layout);
      updateCommentLayoutSize(layout);
    });

    if (imageElement instanceof HTMLImageElement) {
      if (imageElement.complete) {
        queueMicrotask(() => {
          prepareCommentLayoutForMeasurement(layout);
          updateCommentLayoutSize(layout);
        });
      } else {
        imageElement.addEventListener(
          "load",
          () => {
            prepareCommentLayoutForMeasurement(layout);
            updateCommentLayoutSize(layout);
          },
          { once: true }
        );
      }
    }

    return layout;
  }

  function getCommentSide(options = {}) {
    if (options.side === "left" || options.side === "right") {
      return options.side;
    }

    if (options.pagePosition === "left") {
      return "left";
    }

    return "right";
  }

  globalRoot.__dcmvDcinsideComments = {
    collectImageCommentsForSourceItem,
    extractImageCommentsFromImageArea,
    getCommentSourceKey,
    isCommentCollapsedForSource,
    findOriginalCommentRoot,
    findEmptyCommentOpenButton,
    ensureStyles,
    createCommentPanel,
    wrapImageWithComments,
    getCommentSide,
    isImageCommentDisabled,
    ensureImageCommentVisibility,
    updateAllCommentLayouts,
    resetViewerCommentUiState,
    saveAlwaysShowComments,
    setAlwaysShowComments,
    setSaveAlwaysShowCommentsCallback,
    saveForceBelowMode,
    setForceBelowMode,
    setSaveForceBelowModeCallback,
    isForceBelowMode,
    applyForceBelowModeToAllLayouts,
    setAlwaysExpandComments,
    setSaveAlwaysExpandCommentsCallback
  };
  modules.dcinsideComments = globalRoot.__dcmvDcinsideComments;
})();
