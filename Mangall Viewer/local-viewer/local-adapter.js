(function () {
  // 로컬 뷰어 페이지 전용 어댑터.
  // 기존 뷰어(content.js)는 "사이트 어댑터"가 이미지 목록을 넘겨주면 그대로 사용한다.
  // 그래서 로컬 페이지를 사이트 하나로 등록하고, 읽어 온 파일 목록을 직접 넘겨준다.
  // 이 파일은 반드시 content.js보다 먼저 불러와야 한다. (아래 메시지 가로채기 때문)

  const siteRegistry = globalThis.__dcmvSiteRegistry;
  const LOCAL_VIEWER_PAGE_URL = chrome.runtime.getURL("local-viewer/local-viewer.html");
  const SOURCE_ROOT_ID = "lv_source_root";

  let currentPages = [];
  const capturedMessageListeners = [];

  // content.js는 툴바 버튼에서 오는 "DCMV_OPEN" 메시지를 받아야 뷰어를 연다.
  // 같은 페이지 안에서는 그 메시지를 보낼 방법이 없어서,
  // content.js가 등록하는 메시지 처리 함수를 여기서 받아 두었다가 직접 불러준다.
  const onMessageEvent = chrome.runtime?.onMessage;
  if (onMessageEvent && typeof onMessageEvent.addListener === "function") {
    const originalAddListener = onMessageEvent.addListener.bind(onMessageEvent);
    try {
      onMessageEvent.addListener = function (listener) {
        if (typeof listener === "function") {
          capturedMessageListeners.push(listener);
        }
        return originalAddListener(listener);
      };
    } catch {
      // 덮어쓰기가 막힌 환경이면 canOpenViewer()가 false가 되어 화면에 안내가 뜬다.
    }
  }

  function toSourceItem(page, index) {
    return {
      src: page.url,
      originalPopUrl: "",
      resolvedSrc: "",
      width: Number(page.width) || 0,
      height: Number(page.height) || 0,
      alt: page.name || "",
      // 웹페이지와 달리 원본 <img> 태그가 없으므로 비워 둔다.
      element: null,
      failed: false,
      isLocalSource: true,
      index,
      displayIndex: index + 1
    };
  }

  siteRegistry?.registerSiteAdapter?.({
    id: "local_files",
    name: "로컬 파일",
    // 로컬 뷰어 페이지 주소(뒤에 ?book=... 이 붙어도)에서만 이 어댑터를 쓴다.
    matchesUrl(url) {
      return String(url || "").startsWith(LOCAL_VIEWER_PAGE_URL);
    },
    findContentRoot() {
      return document.getElementById(SOURCE_ROOT_ID) || document.body;
    },
    // 웹페이지에서 <img>를 긁어 모으는 기본 방식(작은 이미지 거르기 등)을 거치지 않고
    // 읽어 온 파일 목록을 그대로 넘긴다. 뷰어가 다시 부를 때마다 새 객체로 만들어 준다.
    collectSourceItems() {
      return currentPages.map(toSourceItem);
    }
  });

  globalThis.__dcmvLocalViewerBridge = {
    setPages(pages) {
      currentPages = Array.isArray(pages) ? pages.slice() : [];
    },
    canOpenViewer() {
      return capturedMessageListeners.length > 0;
    },
    // content.js에 메시지를 직접 전달한다. 전달할 곳이 없으면 false.
    sendViewerMessage(message) {
      if (!capturedMessageListeners.length) return false;

      for (const listener of capturedMessageListeners) {
        try {
          listener(message, { id: chrome.runtime.id }, () => {});
        } catch {
        }
      }
      return true;
    }
  };
})();
