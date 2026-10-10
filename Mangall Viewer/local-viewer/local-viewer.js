(function () {
  const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|jpe?g|jfif|png|svg|webp)$/i;
  const ARCHIVE_FILE_PATTERN = /\.(cbz|zip)$/i;

  // 기존 뷰어(content.js)가 쓰는 이름들. content.js 쪽 이름이 바뀌면 여기도 같이 바꿔야 한다.
  const VIEWER_OVERLAY_ID = "dcmv-overlay";
  const VIEWER_POSITION_SESSION_KEY = "dcmv-last-position";

  // 만화별 읽던 위치를 저장하는 키와 최대 개수.
  // 탭 임시 저장소(sessionStorage)라서 이 탭을 닫거나 브라우저를 끄면 사라진다. (새로고침은 유지)
  const READ_POSITIONS_STORAGE_KEY = "dcmv-local-read-positions";
  const MAX_SAVED_READ_POSITIONS = 200;
  const BOOK_QUERY_NAME = "book";
  const DEFAULT_DOCUMENT_TITLE = document.title;

  const bridge = globalThis.__dcmvLocalViewerBridge;
  const zipReader = globalThis.__dcmvLocalZipReader;

  const dropZone = document.getElementById("lv_drop_zone");
  const fileInput = document.getElementById("lv_file_input");
  const folderInput = document.getElementById("lv_folder_input");
  const pickFilesBtn = document.getElementById("lv_pick_files_btn");
  const pickFolderBtn = document.getElementById("lv_pick_folder_btn");
  const openViewerBtn = document.getElementById("lv_open_viewer_btn");
  const clearBtn = document.getElementById("lv_clear_btn");
  const statusMessage = document.getElementById("lv_status");
  const summaryText = document.getElementById("lv_summary");
  const bookTitleText = document.getElementById("lv_book_title");
  const pageList = document.getElementById("lv_page_list");
  const dropOverlay = document.getElementById("lv_drop_overlay");
  const floatingToast = document.getElementById("lv_toast");

  const pathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  const book = {
    pages: [],
    id: "",
    title: ""
  };
  let loadController = null;
  let dragDepth = 0;
  let toastHideTimer = null;

  // ───────── 공통 도구 ─────────

  function isImagePath(path) {
    return IMAGE_FILE_PATTERN.test(String(path || ""));
  }

  function isArchivePath(path) {
    return ARCHIVE_FILE_PATTERN.test(String(path || ""));
  }

  // "2화/3.jpg"가 "10화/1.jpg"보다 앞에 오도록, 폴더 단위로 나눠 숫자를 숫자로 비교한다.
  function comparePaths(a, b) {
    const partsA = String(a || "").split("/");
    const partsB = String(b || "").split("/");
    const length = Math.min(partsA.length, partsB.length);

    for (let i = 0; i < length; i += 1) {
      const result = pathCollator.compare(partsA[i], partsB[i]);
      if (result !== 0) return result;
    }
    return partsA.length - partsB.length;
  }

  function revokePageUrls(pages) {
    for (const page of pages || []) {
      if (page?.url) URL.revokeObjectURL(page.url);
    }
  }

  function getRawPageKey() {
    // content.js가 "같은 페이지인지" 판단할 때 쓰는 방식과 같아야 한다. (# 뒷부분 제외)
    return `${location.origin}${location.pathname}${location.search}`;
  }

  function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  // 글자 묶음으로 짧은 고유 이름을 만든다. (같은 파일 묶음이면 항상 같은 값)
  function hashText(text) {
    let first = 0x811c9dc5;
    let second = 0x01000193 ^ text.length;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 2246822507);
    }
    return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
  }

  // ───────── 화면 표시 ─────────

  function setStatus(message, type = "") {
    if (statusMessage) {
      statusMessage.textContent = message || "";
      statusMessage.classList.toggle("is_error", type === "error");
      statusMessage.classList.toggle("is_success", type === "success");
    }

    // 뷰어가 열려 있으면 아래 상태 글자가 가려지므로 화면 위에 작은 알림으로도 보여준다.
    if (isViewerOpen() && message) {
      showFloatingToast(message, type);
    }
  }

  function showFloatingToast(message, type = "") {
    if (!floatingToast) return;

    clearTimeout(toastHideTimer);
    floatingToast.textContent = message;
    floatingToast.classList.toggle("is_error", type === "error");
    floatingToast.hidden = false;
    // 뷰어 화면보다 위에 보이도록 맨 뒤로 옮긴다. (같은 높이면 나중 요소가 위)
    document.body.appendChild(floatingToast);

    // 진행 중 안내는 계속 띄우고, 끝난 안내(성공/오류)만 잠시 뒤 숨긴다.
    if (type) {
      toastHideTimer = setTimeout(() => {
        floatingToast.hidden = true;
      }, 2500);
    }
  }

  function hideFloatingToast() {
    clearTimeout(toastHideTimer);
    if (floatingToast) floatingToast.hidden = true;
  }

  function syncButtonState() {
    const isLoading = !!loadController;
    if (openViewerBtn) openViewerBtn.disabled = !book.pages.length || isLoading;
    if (clearBtn) clearBtn.disabled = !book.pages.length && !isLoading;
  }

  function renderBook() {
    if (bookTitleText) {
      bookTitleText.textContent = book.title || "페이지 목록";
    }
    if (summaryText) {
      summaryText.textContent = book.pages.length ? `${book.pages.length}장` : "";
    }
    document.title = book.title
      ? `${book.title} - ${DEFAULT_DOCUMENT_TITLE}`
      : DEFAULT_DOCUMENT_TITLE;

    if (!pageList) return;
    pageList.textContent = "";
    pageList.classList.toggle("is_empty", !book.pages.length);

    book.pages.forEach((page, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "lv_page_card";
      card.title = page.name;

      const thumb = document.createElement("img");
      thumb.className = "lv_page_thumb";
      // 화면에 보일 때만 그려서 페이지가 많아도 처음 뜨는 속도를 지킨다.
      thumb.loading = "lazy";
      thumb.decoding = "async";
      thumb.src = page.url;
      thumb.alt = "";
      // 썸네일을 실수로 끌면 "파일을 끌어다 놓은 것"으로 오해할 수 있어 끌기를 막는다.
      thumb.draggable = false;

      const meta = document.createElement("div");
      meta.className = "lv_page_meta";
      meta.textContent = `${index + 1}. ${page.name.split("/").pop()}`;

      card.append(thumb, meta);
      // 썸네일을 누르면 그 페이지부터 뷰어로 본다.
      card.addEventListener("click", () => {
        void openViewerForCurrentBook(page.url);
      });
      pageList.appendChild(card);
    });
  }

  // ───────── 만화별 읽던 위치 ─────────

  function readSavedPositions() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(READ_POSITIONS_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeSavedPositions(positions) {
    try {
      sessionStorage.setItem(READ_POSITIONS_STORAGE_KEY, JSON.stringify(positions));
    } catch {
    }
  }

  // 뷰어는 페이지를 넘길 때마다 탭 임시 저장소에 위치를 적는다.
  // 그 값을 만화별로 따로 옮겨 두어, 이 탭에서 다른 만화를 봤다 와도 이어 볼 수 있게 한다.
  function rememberViewerPosition() {
    if (!book.id) return;

    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(VIEWER_POSITION_SESSION_KEY) || "null");
    } catch {
      return;
    }
    // 다른 만화(다른 주소)에서 적힌 값이면 쓰지 않는다.
    if (!saved || saved.pageKey !== getRawPageKey()) return;

    const index = Number(saved.index);
    if (!Number.isInteger(index)) return;

    const positions = readSavedPositions();
    positions[book.id] = {
      index,
      total: book.pages.length,
      savedAt: Date.now()
    };

    // 기록이 너무 많아지면 오래된 것부터 지운다.
    const ids = Object.keys(positions);
    if (ids.length > MAX_SAVED_READ_POSITIONS) {
      ids
        .sort((a, b) => (positions[a]?.savedAt || 0) - (positions[b]?.savedAt || 0))
        .slice(0, ids.length - MAX_SAVED_READ_POSITIONS)
        .forEach((id) => {
          delete positions[id];
        });
    }
    writeSavedPositions(positions);
  }

  // 뷰어를 열기 직전에, 저장해 둔 위치를 뷰어가 읽는 자리에 넣어 둔다.
  function prepareViewerPosition() {
    const saved = readSavedPositions()[book.id];
    const total = book.pages.length;
    const index = Number(saved?.index);
    // 장 수가 바뀌었거나, 마지막 장면까지 읽은 만화는 처음부터 연다.
    const shouldResume =
      !!saved &&
      Number.isInteger(index) &&
      index > 0 &&
      saved.total === total &&
      index < total - 2;

    try {
      if (shouldResume) {
        sessionStorage.setItem(
          VIEWER_POSITION_SESSION_KEY,
          JSON.stringify({ pageKey: getRawPageKey(), index })
        );
      } else {
        sessionStorage.removeItem(VIEWER_POSITION_SESSION_KEY);
      }
    } catch {
    }
  }

  // ───────── 뷰어 열고 닫기 ─────────

  function isViewerOpen() {
    return !!document.getElementById(VIEWER_OVERLAY_ID);
  }

  function closeViewerIfOpen() {
    if (!isViewerOpen()) return;
    // 뷰어가 열려 있을 때 같은 신호를 보내면 뷰어가 닫힌다.
    bridge?.sendViewerMessage({ type: "DCMV_OPEN", targetImageUrl: "", source: "local-viewer" });
    rememberViewerPosition();
  }

  async function openViewerForCurrentBook(targetImageUrl = "") {
    if (!book.pages.length) {
      setStatus("먼저 폴더나 파일을 불러와 주세요.", "error");
      return;
    }
    if (!bridge?.canOpenViewer()) {
      setStatus("뷰어를 불러오지 못했습니다. 이 페이지를 새로고침해 주세요.", "error");
      return;
    }

    closeViewerIfOpen();
    bridge.setPages(book.pages);

    // 만화마다 주소 끝(?book=...)을 다르게 붙여서, 뷰어가 만화별로 읽던 위치를 구분하게 한다.
    const desiredSearch = `?${BOOK_QUERY_NAME}=${encodeURIComponent(book.id)}`;
    if (location.search !== desiredSearch) {
      history.replaceState(history.state, "", `${location.pathname}${desiredSearch}`);
      // 주소가 바뀌면 content.js가 이전 만화의 임시 기록을 지운다(한 박자 뒤 실행).
      // 그 정리가 끝난 다음에 새 만화의 위치를 넣어야 지워지지 않는다.
      await nextTick();
    }

    prepareViewerPosition();
    hideFloatingToast();
    bridge.sendViewerMessage({
      type: "DCMV_OPEN",
      targetImageUrl,
      source: "local-viewer"
    });
  }

  // 뷰어가 닫히는 순간(Esc 등)을 알아채서 위치를 저장하고 화면 상태를 맞춘다.
  function watchViewerOverlay() {
    let wasOpen = isViewerOpen();
    const observer = new MutationObserver(() => {
      const isOpen = isViewerOpen();
      if (isOpen === wasOpen) return;
      wasOpen = isOpen;

      // 뷰어가 떠 있는 동안에는 뒤쪽 썸네일 목록을 숨겨 불필요한 그리기를 줄인다.
      document.body.classList.toggle("lv_viewer_open", isOpen);
      if (!isOpen) {
        rememberViewerPosition();
        hideFloatingToast();
      }
    });
    observer.observe(document.body, { childList: true });
  }

  // ───────── 파일 모으기 ─────────

  async function readAllDirectoryEntries(directoryEntry) {
    const reader = directoryEntry.createReader();
    const children = [];
    // 폴더 안 항목은 한 번에 최대 100개 정도씩 나눠서 오므로 빈 묶음이 올 때까지 반복한다.
    while (true) {
      const batch = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (!batch.length) break;
      children.push(...batch);
    }
    return children;
  }

  async function collectFilesFromEntry(entry, basePath = "") {
    if (!entry) return [];

    if (entry.isFile) {
      try {
        const file = await new Promise((resolve, reject) => {
          entry.file(resolve, reject);
        });
        return [{ file, path: `${basePath}${entry.name}` }];
      } catch {
        return [];
      }
    }

    if (!entry.isDirectory) return [];

    let children = [];
    try {
      children = await readAllDirectoryEntries(entry);
    } catch {
      return [];
    }

    const nested = await Promise.all(
      children.map((child) => collectFilesFromEntry(child, `${basePath}${entry.name}/`))
    );
    return nested.flat();
  }

  // 주의: 끌어다 놓은 항목 정보는 drop 이벤트가 끝나면 사라진다.
  // 그래서 첫 await 전에(바로 아래 두 줄) 필요한 정보를 먼저 꺼내 둔다.
  async function collectDroppedFiles(dataTransfer) {
    const entries = Array.from(dataTransfer?.items || [])
      .filter((item) => item.kind === "file")
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean);
    const plainFiles = Array.from(dataTransfer?.files || []);

    if (!entries.length) {
      return plainFiles.map((file) => ({ file, path: file.name }));
    }

    const nested = await Promise.all(entries.map((entry) => collectFilesFromEntry(entry, "")));
    return nested.flat();
  }

  function collectInputFiles(fileList) {
    return Array.from(fileList || []).map((file) => ({
      file,
      // 폴더 선택일 때는 "폴더이름/파일이름" 형태의 경로가 들어 있다.
      path: file.webkitRelativePath || file.name
    }));
  }

  // 같은 파일 묶음이면 항상 같은 이름이 나오도록 경로와 크기로 만든다.
  function createBookId(items) {
    const keys = items
      .filter((item) => isImagePath(item.path) || isArchivePath(item.path))
      .map((item) => `${item.path}|${item.file?.size || 0}`)
      .sort();
    return hashText(keys.join("\n"));
  }

  function createBookTitle(items) {
    const topNames = Array.from(
      new Set(
        items
          .filter((item) => isImagePath(item.path) || isArchivePath(item.path))
          .map((item) => item.path.split("/")[0])
      )
    ).sort(comparePaths);

    if (!topNames.length) return "";

    const firstName = topNames[0].replace(ARCHIVE_FILE_PATTERN, "");
    return topNames.length === 1 ? firstName : `${firstName} 외 ${topNames.length - 1}개`;
  }

  async function readPagesFromItems(items, signal) {
    const pages = [];
    const archiveErrors = [];
    const sortedItems = items.slice().sort((a, b) => comparePaths(a.path, b.path));

    try {
      for (const item of sortedItems) {
        signal.throwIfAborted();
        if (!item?.file) continue;

        if (isImagePath(item.path)) {
          pages.push({ name: item.path, url: URL.createObjectURL(item.file) });
          continue;
        }

        if (isArchivePath(item.path)) {
          try {
            const zipPages = await zipReader.extractImages(item.file, item.path, {
              signal,
              onProgress: (message) => setStatus(message)
            });
            pages.push(...zipPages);
          } catch (error) {
            // 취소가 아니라 ZIP 하나가 깨진 경우엔, 나머지 파일은 계속 읽는다.
            if (signal.aborted) throw error;
            archiveErrors.push(error instanceof Error ? error.message : `${item.path}: 읽지 못했습니다.`);
          }
        }
      }
      signal.throwIfAborted();
    } catch (error) {
      revokePageUrls(pages);
      throw error;
    }

    pages.sort((a, b) => comparePaths(a.name, b.name));
    return { pages, archiveErrors };
  }

  async function loadSources(items, successMessage) {
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    syncButtonState();

    try {
      if (!items.length) {
        setStatus("불러올 파일을 찾지 못했습니다.", "error");
        return;
      }

      setStatus("파일을 읽는 중입니다.");
      const { pages, archiveErrors } = await readPagesFromItems(items, controller.signal);
      if (controller.signal.aborted) {
        revokePageUrls(pages);
        return;
      }

      if (!pages.length) {
        // 읽을 게 없으면 지금 보던 만화는 그대로 둔다.
        setStatus(archiveErrors[0] || "이미지나 ZIP/CBZ 파일을 찾지 못했습니다.", "error");
        return;
      }

      // 새 만화로 바꾸기 전에 지금 보던 만화를 닫고(위치 저장) 이전 이미지 메모리를 비운다.
      closeViewerIfOpen();
      revokePageUrls(book.pages);
      book.pages = pages;
      book.id = createBookId(items);
      book.title = createBookTitle(items);
      renderBook();

      if (archiveErrors.length) {
        setStatus(`${pages.length}장을 불러왔습니다. 일부 ZIP은 읽지 못했습니다: ${archiveErrors[0]}`, "error");
      } else {
        setStatus(`${successMessage} (${pages.length}장)`, "success");
      }

      await openViewerForCurrentBook();
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus(error instanceof Error ? error.message : "파일을 처리하지 못했습니다.", "error");
    } finally {
      if (loadController === controller) {
        loadController = null;
        syncButtonState();
      }
    }
  }

  function clearBook() {
    loadController?.abort();
    loadController = null;
    closeViewerIfOpen();
    revokePageUrls(book.pages);
    book.pages = [];
    book.id = "";
    book.title = "";
    bridge?.setPages([]);
    if (location.search) {
      history.replaceState(history.state, "", location.pathname);
    }
    renderBook();
    syncButtonState();
    setStatus("");
  }

  // ───────── 끌어다 놓기 (페이지 어디든, 뷰어 보는 중에도) ─────────

  function isFileDrag(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  function showDropOverlay() {
    if (!dropOverlay) return;
    dropOverlay.hidden = false;
    // 뷰어 화면 위에도 보이도록 맨 뒤로 옮긴다.
    document.body.appendChild(dropOverlay);
  }

  function hideDropOverlay() {
    dragDepth = 0;
    if (dropOverlay) dropOverlay.hidden = true;
  }

  // capture(true): 뷰어 등 다른 요소가 이벤트를 먼저 가로채지 못하게 가장 먼저 받는다.
  window.addEventListener(
    "dragenter",
    (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth += 1;
      showDropOverlay();
    },
    true
  );

  window.addEventListener(
    "dragover",
    (event) => {
      if (!isFileDrag(event)) return;
      // 이걸 막지 않으면 브라우저가 파일을 새 탭처럼 열어 버린다.
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    true
  );

  window.addEventListener(
    "dragleave",
    (event) => {
      if (!isFileDrag(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      // 창 밖으로 나가면(relatedTarget 없음) 바로 숨긴다.
      if (!dragDepth || !event.relatedTarget) {
        hideDropOverlay();
      }
    },
    true
  );

  window.addEventListener(
    "drop",
    (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      hideDropOverlay();
      // collectDroppedFiles는 첫 await 전에 항목 정보를 꺼내므로 여기서 바로 부른다.
      const itemsPromise = collectDroppedFiles(event.dataTransfer);
      void itemsPromise.then((items) => loadSources(items, "끌어다 놓은 파일을 불러왔습니다."));
    },
    true
  );

  window.addEventListener("dragend", hideDropOverlay, true);

  // ───────── 버튼 ─────────

  function openPicker(input) {
    if (!input) return;
    input.value = "";
    input.click();
  }

  pickFilesBtn?.addEventListener("click", () => openPicker(fileInput));
  pickFolderBtn?.addEventListener("click", () => openPicker(folderInput));
  dropZone?.addEventListener("click", () => openPicker(fileInput));
  dropZone?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker(fileInput);
    }
  });

  fileInput?.addEventListener("change", () => {
    const items = collectInputFiles(fileInput.files);
    fileInput.value = "";
    if (items.length) void loadSources(items, "파일을 불러왔습니다.");
  });

  folderInput?.addEventListener("change", () => {
    const items = collectInputFiles(folderInput.files);
    folderInput.value = "";
    if (items.length) void loadSources(items, "폴더를 불러왔습니다.");
  });

  openViewerBtn?.addEventListener("click", () => {
    void openViewerForCurrentBook();
  });
  clearBtn?.addEventListener("click", clearBook);

  // 탭을 닫거나 새로고침할 때도 마지막 위치를 남긴다.
  window.addEventListener("pagehide", rememberViewerPosition);
  window.addEventListener("pagehide", () => revokePageUrls(book.pages));

  // ───────── 시작 ─────────

  // 새로고침하면 파일은 다시 골라야 하므로, 이전 만화 주소 꼬리(?book=...)를 지운다.
  if (location.search) {
    history.replaceState(history.state, "", location.pathname);
  }
  if (!zipReader) {
    setStatus("ZIP 읽기 도구를 불러오지 못했습니다. 이 페이지를 새로고침해 주세요.", "error");
  }

  watchViewerOverlay();
  renderBook();
  syncButtonState();
})();
