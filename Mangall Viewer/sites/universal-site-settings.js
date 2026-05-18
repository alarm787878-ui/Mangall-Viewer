(function () {
  const modules = (globalThis.__dcmvModules = globalThis.__dcmvModules || {});
  const STORAGE_KEY = "dcmv_customSites";

  const DEFAULT_CONTENT_SELECTORS = [
    "#contents",
    "#content",
    "#article",
    "#chapterContent",
    "#scroll-list",
    "#postViewArea",
    "#post-area",
    ".se-main-container",
    ".vw-imgs",
    ".vw-main",
    ".view-content",
    ".viewer-wrap",
    "article",
    "main",
    ".content",
    ".post-content",
    ".entry-content",
    ".article-content"
  ];

  const DEFAULT_EXCLUDED_SELECTORS = [
    "header",
    "nav",
    "aside",
    "footer",
    "#comments",
    ".comments",
    ".comment-section",
    ".item-thumbnail",
    ".related-posts",
    ".recommend",
    ".ad",
    ".ads",
    ".banner"
  ];

  const GENERIC_CONTENT_SELECTORS = [
    "#chapterContent",
    "#postViewArea",
    "#post-area",
    ".se-main-container",
    ".vw-imgs",
    ".vw-main",
    "#scroll-list",
    ".view-content",
    ".viewer-wrap",
    ".read-content",
    ".reading-content",
    ".article-content",
    ".post-content",
    "article",
    "main"
  ];

  const GENERIC_IMAGE_SELECTORS = [
    "a.readImg[href]",
    ".vw-imgs img",
    "#chapterContent img",
    "img[data-src]",
    "img[data-original]",
    "img"
  ];
  const MIN_CONTENT_IMAGE_LONG_SIDE = 320;
  const MIN_CONTENT_IMAGE_AREA = 80000;
  const GENERIC_COMMENT_LIKE_SELECTORS = [
    "#comments",
    ".comments",
    ".comment-section",
    ".coments",
    ".coment-body",
    ".coment-user-list",
    ".pc-commalllist",
    ".mobile-commalllist",
    ".media-user",
    ".user-coment",
    ".de-btn",
    "[class*='comment']",
    "[class*='coment']"
  ];

  if (typeof window !== "undefined" && !window.__dcmvGenericObservedImageUrls) {
    window.__dcmvGenericObservedImageUrls = [];

    const rememberObservedUrl = (value) => {
      if (typeof value !== "string") return;
      const url = value.trim();
      if (!url) return;

      const list = window.__dcmvGenericObservedImageUrls;
      if (!list.includes(url)) {
        list.push(url);
      }
    };

    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function (...args) {
        const target = args[0];
        if (typeof target === "string") {
          rememberObservedUrl(target);
        } else if (target?.url) {
          rememberObservedUrl(target.url);
        }
        return originalFetch.apply(this, args);
      };
    }

    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      rememberObservedUrl(url);
      return originalXHROpen.call(this, method, url, ...rest);
    };
  }

  modules.universalSiteSettings = {
    getStorageArea() {
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.local
      ) {
        return null;
      }
      return chrome.storage.local;
    },

    loadCustomSites() {
      return new Promise((resolve) => {
        const storageArea = this.getStorageArea();
        if (!storageArea) {
          resolve([]);
          return;
        }

        storageArea.get([STORAGE_KEY], (result) => {
          const sites = result[STORAGE_KEY];
          if (Array.isArray(sites)) {
            const sanitizedSites = this.sanitizeStoredSites(sites);
            const didChange =
              sanitizedSites.length !== sites.length ||
              sanitizedSites.some((site, index) => {
                const original = sites[index];
                return (
                  !original ||
                  original.urlPattern !== site.urlPattern ||
                  original.name !== site.name ||
                  original.enabled !== site.enabled
                );
              });

            if (didChange) {
              this.saveCustomSites(sanitizedSites).catch(() => {});
            }

            resolve(sanitizedSites);
          } else {
            resolve([]);
          }
        });
      });
    },

    saveCustomSites(sites) {
      return new Promise((resolve) => {
        const storageArea = this.getStorageArea();
        if (!storageArea) {
          resolve(false);
          return;
        }

        const validSites = Array.isArray(sites)
          ? this.sanitizeStoredSites(sites)
          : [];

        storageArea.set({ [STORAGE_KEY]: validSites }, () => {
          resolve(true);
        });
      });
    },

    addCustomSite(siteData) {
      return new Promise(async (resolve) => {
        const normalizedPattern = this.normalizeUrlPatternInput(
          siteData?.urlPattern || ""
        );

        if (!siteData || !normalizedPattern) {
          resolve({ success: false, error: "URL 패턴이 필요합니다" });
          return;
        }

        const sites = await this.loadCustomSites();
        const id = siteData.id || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        
        // 중복 체크
        const existingIndex = sites.findIndex(
          s => s.id === id || s.urlPattern === normalizedPattern
        );
        if (existingIndex >= 0) {
          sites[existingIndex] = {
            ...sites[existingIndex],
            ...siteData,
            id,
            urlPattern: normalizedPattern,
            updatedAt: Date.now()
          };
        } else {
          sites.push({
            id,
            name: siteData.name || "커스텀 사이트",
            urlPattern: normalizedPattern,
            contentSelectors: siteData.contentSelectors || DEFAULT_CONTENT_SELECTORS,
            excludedSelectors: siteData.excludedSelectors || DEFAULT_EXCLUDED_SELECTORS,
            enabled: siteData.enabled !== false,
            createdAt: Date.now(),
            updatedAt: Date.now()
          });
        }

        const saved = await this.saveCustomSites(sites);
        resolve({ success: saved, id, sites });
      });
    },

    removeCustomSite(id) {
      return new Promise(async (resolve) => {
        const sites = await this.loadCustomSites();
        const filtered = sites.filter(s => s.id !== id);
        const saved = await this.saveCustomSites(filtered);
        resolve({ success: saved, sites: filtered });
      });
    },

    toggleCustomSite(id, enabled) {
      return new Promise(async (resolve) => {
        const sites = await this.loadCustomSites();
        const site = sites.find(s => s.id === id);
        if (site) {
          site.enabled = enabled;
          site.updatedAt = Date.now();
          await this.saveCustomSites(sites);
        }
        resolve({ success: !!site, sites });
      });
    },

    sanitizeStoredSites(sites) {
      if (!Array.isArray(sites)) return [];

      const result = [];
      const seenPatterns = new Set();

      for (const site of sites) {
        if (!site?.id) continue;

        const normalizedPattern = this.normalizeUrlPatternInput(site.urlPattern || "");
        if (!normalizedPattern) continue;
        if (seenPatterns.has(normalizedPattern)) continue;
        seenPatterns.add(normalizedPattern);

        result.push({
          ...site,
          name: site.name || "커스텀 사이트",
          urlPattern: normalizedPattern,
          contentSelectors: Array.isArray(site.contentSelectors) && site.contentSelectors.length
            ? site.contentSelectors
            : DEFAULT_CONTENT_SELECTORS,
          excludedSelectors: Array.isArray(site.excludedSelectors) && site.excludedSelectors.length
            ? site.excludedSelectors
            : DEFAULT_EXCLUDED_SELECTORS,
          enabled: site.enabled !== false
        });
      }

      return result;
    },

    normalizeUrlPatternInput(input) {
      if (input instanceof RegExp) {
        return input;
      }
      if (typeof input !== "string") return "";

      let value = input.trim();
      if (!value) return "";

      value = value.replace(/\\/g, "/");

      if (value.startsWith("*.//")) {
        value = `*://${value.slice(4)}`;
      }

      if (value.startsWith("*//")) {
        value = `*://${value.slice(3)}`;
      }

      if (value.startsWith("http//")) {
        value = `http://${value.slice(6)}`;
      }

      if (value.startsWith("https//")) {
        value = `https://${value.slice(7)}`;
      }

      const normalizeHostPattern = (hostLike) => {
        const cleanedHost = String(hostLike || "")
          .trim()
          .split("/")[0]
          .replace(/^\/+|\/+$/g, "")
          .replace(/\s+/g, "");
        if (!cleanedHost) return "";
        return `*://${cleanedHost}/*`;
      };

      if (/^https?:\/\//i.test(value)) {
        try {
          const url = new URL(value);
          return `*://${url.host}/*`;
        } catch {
          return "";
        }
      }

      if (/^file:\/\/\//i.test(value)) {
        return value;
      }

      if (/^\*:\/\//.test(value)) {
        const rest = value.slice(4).trim();
        if (!rest) return "";

        const slashIndex = rest.indexOf("/");
        const host = (slashIndex >= 0 ? rest.slice(0, slashIndex) : rest)
          .trim()
          .replace(/^\/+|\/+$/g, "");
        if (!host) return "";

        const rawPath = slashIndex >= 0 ? rest.slice(slashIndex) : "";
        if (!rawPath || rawPath === "/" || /^\/\d+(?:[/?#].*)?$/.test(rawPath)) {
          return `*://${host}/*`;
        }

        const normalizedPath = rawPath.endsWith("*")
          ? rawPath
          : rawPath.endsWith("/")
            ? `${rawPath}*`
            : `${rawPath}/*`;
        return `*://${host}${normalizedPath}`;
      }

      if (value.startsWith("*.")) {
        return normalizeHostPattern(value);
      }

      if (/^[^/]+\.[^/]+\/.+/.test(value)) {
        const hostOnly = value.split("/")[0];
        return normalizeHostPattern(hostOnly);
      }

      if (/^[^/]+\.[^/]+$/.test(value)) {
        return normalizeHostPattern(value);
      }

      return "";
    },

    // URL 패턴 문자열을 정규식으로 변환
    patternToRegex(pattern) {
      // 이미 정규식인 경우
      if (pattern instanceof RegExp) return pattern;
      
      const normalizedPattern = this.normalizeUrlPatternInput(pattern);
      if (!normalizedPattern) return null;
      
      try {
        const schemeToken = "__DCMV_SCHEME__";
        const escaped = normalizedPattern
          .replace(/^\*:\/\//, schemeToken)
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(schemeToken, "https?:\\/\\/");

        return new RegExp(`^${escaped}$`, "i");
      } catch (e) {
        console.error("[DCMV] Invalid URL pattern:", normalizedPattern, e);
        return null;
      }
    },

    getPreferredContentSelectors(contentSelectors) {
      const combined = [
        ...(Array.isArray(contentSelectors) ? contentSelectors : []),
        ...GENERIC_CONTENT_SELECTORS
      ];
      return Array.from(
        new Set(combined.map((selector) => String(selector || "").trim()).filter(Boolean))
      );
    },

    isKnownAdResourceUrl(url) {
      if (!url) return false;

      try {
        const parsed = new URL(url, location.href);
        const hostname = String(parsed.hostname || "").toLowerCase();
        const pathname = String(parsed.pathname || "").toLowerCase();

        const blockedHosts = [
          "doubleclick.net",
          "googlesyndication.com",
          "googleadservices.com"
        ];

        if (
          blockedHosts.some(
            (host) => hostname === host || hostname.endsWith(`.${host}`)
          )
        ) {
          return true;
        }

        // 명확한 광고 스크립트/리소스 경로만 차단해서 일반 이미지 오탐을 줄인다.
        return /(?:^|\/)(?:ads?|advertisement|adservice)(?:\/|[-_.]|$)/i.test(pathname);
      } catch {
        return false;
      }
    },

    shouldTreatAsContentImage(url) {
      if (!url) return false;

      const value = String(url).toLowerCase();
      if (
        /(?:^|\/)(?:loading|loader|spinner)[^/]*\.(?:gif|png|webp)(?:[?#].*)?$/i.test(value) ||
        this.isKnownAdResourceUrl(value)
      ) {
        return false;
      }

      return (
        /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(value) ||
        value.includes("/uploads/") ||
        value.includes("/chap/") ||
        value.includes("/images/") ||
        value.includes("/wp-content/")
      );
    },

    normalizeImageUrl(value) {
      if (typeof value !== "string") return "";

      const trimmed = value.trim();
      if (!trimmed) return "";

      try {
        return new URL(trimmed, location.href).href;
      } catch {
        return trimmed;
      }
    },

    isElementLike(value) {
      return !!value && value.nodeType === 1 && typeof value.getAttribute === "function";
    },

    isImageElementLike(value) {
      return this.isElementLike(value) && String(value.tagName || "").toLowerCase() === "img";
    },

    getKnownImageSize(imgEl) {
      if (!this.isElementLike(imgEl)) {
        return { width: 0, height: 0 };
      }

      const rect =
        typeof imgEl.getBoundingClientRect === "function"
          ? imgEl.getBoundingClientRect()
          : null;
      return {
        width:
          imgEl.naturalWidth ||
          Number(imgEl.getAttribute("data-origin-width")) ||
          Number(imgEl.getAttribute("data-width")) ||
          Number(imgEl.getAttribute("width")) ||
          Math.round(rect?.width || 0),
        height:
          imgEl.naturalHeight ||
          Number(imgEl.getAttribute("data-origin-height")) ||
          Number(imgEl.getAttribute("data-height")) ||
          Number(imgEl.getAttribute("height")) ||
          Math.round(rect?.height || 0)
      };
    },

    hasLargeImageSize(imgEl) {
      const { width, height } = this.getKnownImageSize(imgEl);
      if (!width || !height) return false;

      const longSide = Math.max(width, height);
      const area = width * height;
      return longSide >= MIN_CONTENT_IMAGE_LONG_SIDE && area >= MIN_CONTENT_IMAGE_AREA;
    },

    shouldTreatAsContentImageElement(imgEl, url) {
      if (this.shouldTreatAsContentImage(url)) return true;
      return !!url && this.isImageElementLike(imgEl) && this.hasLargeImageSize(imgEl);
    },

    isTooSmallContentImage(imgEl) {
      const { width, height } = this.getKnownImageSize(imgEl);
      if (!width || !height) return false;

      const longSide = Math.max(width, height);
      const area = width * height;
      return longSide < MIN_CONTENT_IMAGE_LONG_SIDE || area < MIN_CONTENT_IMAGE_AREA;
    },

    getLoadedCurrentImageUrl(imgEl, deps) {
      if (!this.isImageElementLike(imgEl)) return "";

      const currentUrl = imgEl.currentSrc || imgEl.getAttribute("src") || "";
      if (!currentUrl) return "";

      const width = imgEl.naturalWidth || 0;
      const height = imgEl.naturalHeight || 0;
      if (!width || !height) return "";

      const longSide = Math.max(width, height);
      const area = width * height;
      if (longSide < MIN_CONTENT_IMAGE_LONG_SIDE || area < MIN_CONTENT_IMAGE_AREA) {
        return "";
      }

      return deps.decodeHtml(currentUrl);
    },

    extractImageUrlFromElement(imgEl, deps) {
      if (!this.isElementLike(imgEl)) return "";

      const anchorHref = imgEl.closest("a[href]")?.getAttribute("href") || "";
      const candidate =
        this.getLoadedCurrentImageUrl(imgEl, deps) ||
        imgEl.getAttribute("data-img-src") ||
        imgEl.getAttribute("data-src") ||
        imgEl.getAttribute("data-original") ||
        imgEl.getAttribute("data-original-src") ||
        imgEl.getAttribute("data-lazy-src") ||
        imgEl.getAttribute("data-url") ||
        imgEl.currentSrc ||
        imgEl.getAttribute("src") ||
        anchorHref ||
        deps.resolveImageUrlFromTag(imgEl.outerHTML || "");

      return deps.decodeHtml(candidate || "");
    },

    buildSourceItem(url, imgEl, originalPopUrl, index) {
      const size = this.getKnownImageSize(imgEl);
      return {
        src: url || "",
        originalPopUrl: originalPopUrl || "",
        resolvedSrc: "",
        width: size.width,
        height: size.height,
        alt: imgEl?.getAttribute?.("alt") || "",
        index,
        displayIndex: index + 1,
        element: imgEl || null,
        failed: false
      };
    },

    withGenericSourceType(items, sourceType) {
      return (items || []).map((item) => ({
        ...item,
        __dcmvGenericSourceType: sourceType
      }));
    },

    isInsideGenericCommentLikeArea(el) {
      if (!this.isElementLike(el)) return false;
      return !!el.closest(GENERIC_COMMENT_LIKE_SELECTORS.join(", "));
    },

    isLikelyUiOrProfileImageUrl(url) {
      const value = String(url || "").toLowerCase();
      if (!value) return false;

      return /(?:userdef|avatar|profile|\/user\/|\/users\/|\/member\/|\/members\/|\/icon|icons?\/|button|reply|comment|coment|like|recommend|vote|static\/images\/(?:up|down|\d+)\.(?:png|gif|jpe?g|webp))/i.test(value);
    },

    getMedianNumber(values) {
      const numbers = (values || [])
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
      if (!numbers.length) return 0;

      const middle = Math.floor(numbers.length / 2);
      return numbers.length % 2
        ? numbers[middle]
        : (numbers[middle - 1] + numbers[middle]) / 2;
    },

    getDominantFolderStats(items) {
      const counts = new Map();
      const seenUrls = new Set();

      for (const item of items || []) {
        const url = this.normalizeImageUrl(item?.src || item?.resolvedSrc || item?.originalPopUrl || "");
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);

        const folderKey = this.getImageFolderKey(url);
        counts.set(folderKey, (counts.get(folderKey) || 0) + 1);
      }

      let dominantCount = 0;
      for (const count of counts.values()) {
        dominantCount = Math.max(dominantCount, count);
      }

      return {
        uniqueCount: seenUrls.size,
        folderCount: counts.size,
        dominantCount,
        dominantRatio: seenUrls.size ? dominantCount / seenUrls.size : 0
      };
    },

    getSourceItemUrlSet(items) {
      const urls = new Set();
      for (const item of items || []) {
        const url = this.normalizeImageUrl(item?.src || item?.resolvedSrc || item?.originalPopUrl || "");
        if (url) urls.add(url);
      }
      return urls;
    },

    getSourceItemOverlapRatio(aItems, bItems) {
      const aUrls = this.getSourceItemUrlSet(aItems);
      const bUrls = this.getSourceItemUrlSet(bItems);
      const smallerSize = Math.min(aUrls.size, bUrls.size);
      if (!smallerSize) return 0;

      let overlap = 0;
      for (const url of aUrls) {
        if (bUrls.has(url)) overlap += 1;
      }
      return overlap / smallerSize;
    },

    getAreaScore(medianArea) {
      if (medianArea >= 500000) return 250;
      if (medianArea >= 250000) return 180;
      if (medianArea >= 150000) return 120;
      if (medianArea >= 80000) return 60;
      return 0;
    },

    scoreSourceItemList(items, sourceType = "") {
      const sourceItems = Array.isArray(items) ? items : [];
      const count = sourceItems.length;
      if (!count) {
        return {
          score: 0,
          count: 0,
          largeCount: 0,
          largeRatio: 0,
          commentRatio: 0,
          medianArea: 0,
          squareRatio: 0,
          smallRatio: 0
        };
      }

      let largeCount = 0;
      let smallCount = 0;
      let squareCount = 0;
      let bannerCount = 0;
      let commentCount = 0;
      let uiUrlCount = 0;
      let knownSizeCount = 0;
      let totalLargeArea = 0;
      const areas = [];

      for (const item of sourceItems) {
        const width = Number(item?.width) || 0;
        const height = Number(item?.height) || 0;
        const url = item?.src || item?.resolvedSrc || item?.originalPopUrl || "";
        const hasKnownSize = width > 0 && height > 0;

        if (hasKnownSize) {
          knownSizeCount += 1;
          const longSide = Math.max(width, height);
          const shortSide = Math.min(width, height);
          const area = width * height;
          areas.push(area);

          if (longSide >= 500 && area >= 150000) {
            largeCount += 1;
            totalLargeArea += area;
          }
          if (longSide < 320 || area < 80000) {
            smallCount += 1;
          }
          if (shortSide > 0 && longSide / shortSide <= 1.25) {
            squareCount += 1;
          }
          if (shortSide > 0 && longSide / shortSide >= 4) {
            bannerCount += 1;
          }
        }

        if (this.isInsideGenericCommentLikeArea(item?.element)) {
          commentCount += 1;
        }
        if (this.isLikelyUiOrProfileImageUrl(url)) {
          uiUrlCount += 1;
        }
      }

      const folderStats = this.getDominantFolderStats(sourceItems);
      const medianArea = this.getMedianNumber(areas);
      const largeRatio = largeCount / count;
      const smallRatio = knownSizeCount ? smallCount / knownSizeCount : 0;
      const squareRatio = knownSizeCount ? squareCount / knownSizeCount : 0;
      const bannerRatio = knownSizeCount ? bannerCount / knownSizeCount : 0;
      const commentRatio = commentCount / count;
      const uiUrlRatio = uiUrlCount / count;
      const uniqueRatio = count ? folderStats.uniqueCount / count : 0;
      const scriptLike = sourceType === "script";

      let score = 0;
      score += Math.min(largeCount, 40) * 120;
      score += largeRatio * 300;
      score += this.getAreaScore(medianArea);
      score += Math.min(totalLargeArea / 2000000, 1) * 40;
      score += Math.min(folderStats.dominantCount, 30) * 12;
      score += folderStats.dominantRatio >= 0.5 && folderStats.dominantCount >= 3 ? 220 : 0;
      score += uniqueRatio >= 0.8 ? 90 : 0;
      score += scriptLike && folderStats.dominantCount >= 3 ? 250 : 0;
      score += !knownSizeCount && scriptLike && count >= 5 ? 180 : 0;
      score += count >= 5 ? 80 : 0;

      score -= commentRatio * 500;
      score -= smallRatio * 350;
      score -= squareRatio * 180;
      score -= bannerRatio * 180;
      score -= uiUrlRatio * 250;
      if (knownSizeCount && largeCount === 0) score -= 300;
      if (knownSizeCount && medianArea < 80000) score -= 250;
      if (commentRatio >= 0.5) score -= 500;
      if (squareRatio >= 0.8 && medianArea < 150000) score -= 250;

      return {
        score: Math.max(0, Math.round(score)),
        count,
        largeCount,
        largeRatio,
        commentRatio,
        medianArea,
        squareRatio,
        smallRatio,
        sourceType,
        folderStats
      };
    },

    shouldReplacePreviousGenericItems(previous, next) {
      if (!previous?.items?.length) return true;
      if (!next?.items?.length) return false;

      const prevScore = previous.scoreInfo?.score || 0;
      const nextScore = next.scoreInfo?.score || 0;
      const prevCount = previous.items.length;
      const nextCount = next.items.length;
      const nextInfo = next.scoreInfo || {};
      const sameSourceOverlap = previous.sourceType === next.sourceType
        ? this.getSourceItemOverlapRatio(previous.items, next.items)
        : 0;

      if (sameSourceOverlap >= 0.7) {
        return true;
      }

      // 자동 재탐색 중 댓글/프로필 묶음처럼 보이는 목록이 기존 만화 목록을 덮지 못하게 막는다.
      if (prevCount >= 5 && nextCount <= 2) return false;
      if (prevCount >= 5 && nextInfo.commentRatio >= 0.3) return false;
      if (prevCount >= 5 && nextInfo.largeCount === 0 && nextInfo.medianArea < 80000) return false;
      if (previous.sourceType === "script" && next.sourceType !== "script") {
        const prevFolderCount = previous.scoreInfo?.folderStats?.dominantCount || 0;
        if (prevFolderCount >= 3 && nextScore < prevScore * 1.5) return false;
      }

      const requiredRatio = prevScore >= 700 ? 1.5 : 1.3;
      return nextScore >= prevScore * requiredRatio;
    },

    compareDocumentOrder(a, b) {
      if (a === b) return 0;
      if (
        !a ||
        !b ||
        typeof a.compareDocumentPosition !== "function" ||
        typeof b.compareDocumentPosition !== "function"
      ) {
        return 0;
      }

      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    },

    getRootBranchElement(imgEl, root) {
      if (!this.isElementLike(imgEl)) return null;
      if (!this.isElementLike(root)) {
        return imgEl.parentElement || imgEl;
      }

      let branch = imgEl;
      let current = imgEl;
      while (current && current !== root) {
        branch = current;
        current = current.parentElement;
      }

      return branch;
    },

    collectDomSourceItems(root, deps, adapterApi) {
      const nodes = [];
      const seenElements = new Set();

      for (const selector of GENERIC_IMAGE_SELECTORS) {
        const matched = Array.from(root?.querySelectorAll?.(selector) || []);
        for (const node of matched) {
          const candidate = node.matches?.("img")
            ? node
            : node.querySelector?.("img") || node;
          if (!this.isElementLike(candidate) || seenElements.has(candidate)) {
            continue;
          }
          seenElements.add(candidate);
          nodes.push(candidate);
        }
      }

      nodes.sort((a, b) => this.compareDocumentOrder(a, b));

      const blockOrder = [];
      const blockMap = new Map();

      for (const node of nodes) {
        const imgEl =
          this.isImageElementLike(node)
            ? node
            : node?.querySelector instanceof Function
              ? node.querySelector("img")
              : null;
        if (!this.isElementLike(imgEl)) continue;
        if (adapterApi.isInsideExcludedImageCommentArea(imgEl)) continue;
        if (adapterApi.isInsideOpenGraphPreview(imgEl)) continue;

        const url = this.extractImageUrlFromElement(imgEl, deps);
        const anchorHref = deps.decodeHtml(
          imgEl.closest("a[href]")?.getAttribute("href") || ""
        );
        const contentKey = url || anchorHref;

        if (!this.shouldTreatAsContentImageElement(imgEl, contentKey)) {
          continue;
        }

        if (this.isTooSmallContentImage(imgEl)) {
          continue;
        }

        const blockEl = this.getRootBranchElement(imgEl, root);
        const blockKey = blockEl || imgEl;
        if (!blockMap.has(blockKey)) {
          blockMap.set(blockKey, []);
          blockOrder.push(blockKey);
        }
        blockMap.get(blockKey).push({ url, imgEl, anchorHref });
      }

      const orderedItems = [];
      for (const blockKey of blockOrder) {
        const items = blockMap.get(blockKey) || [];
        for (const item of items) {
          orderedItems.push(item);
        }
      }

      return orderedItems.map((item, index) =>
        this.buildSourceItem(item.url, item.imgEl, item.anchorHref, index)
      );
    },

    getAccessibleEmbeddedDocuments(doc = document) {
      const documents = [];
      const frames = Array.from(doc.querySelectorAll?.("iframe, frame") || []);
      for (const frame of frames) {
        try {
          const frameDoc = frame.contentDocument || frame.contentWindow?.document;
          if (frameDoc?.body) {
            documents.push(frameDoc);
          }
        } catch {
        }
      }
      return documents;
    },

    extractScriptArrayStringLists(text) {
      const lists = [];
      if (typeof text !== "string" || !/\.(?:avif|bmp|gif|jpe?g|png|webp)/i.test(text)) {
        return lists;
      }

      const maxTextLength = 500000;
      const source = text.length > maxTextLength ? text.slice(0, maxTextLength) : text;
      for (let start = source.indexOf("["); start !== -1; start = source.indexOf("[", start + 1)) {
        let depth = 0;
        let quote = "";
        let escaped = false;
        let end = -1;

        for (let i = start; i < source.length; i += 1) {
          const char = source[i];
          if (quote) {
            if (escaped) {
              escaped = false;
            } else if (char === "\\") {
              escaped = true;
            } else if (char === quote) {
              quote = "";
            }
            continue;
          }

          if (char === '"' || char === "'" || char === "`") {
            quote = char;
            continue;
          }
          if (char === "[") depth += 1;
          if (char === "]") {
            depth -= 1;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }

        if (end === -1) break;

        const rawArray = source.slice(start, end + 1);
        const values = [];
        const stringPattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
        for (const match of rawArray.matchAll(stringPattern)) {
          const value = match[2].replace(/\\\//g, "/").replace(/\\u002F/gi, "/");
          if (/\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(value)) {
            values.push(value);
          }
        }

        if (values.length > 0) {
          lists.push(values);
        }
        start = end;
        if (lists.length >= 30) break;
      }

      return lists;
    },

    getImageFolderKey(url) {
      try {
        const parsed = new URL(url, location.href);
        const pathname = parsed.pathname || "";
        return `${parsed.origin}${pathname.slice(0, pathname.lastIndexOf("/") + 1)}`;
      } catch {
        const value = String(url || "");
        return value.slice(0, value.lastIndexOf("/") + 1);
      }
    },

    chooseBestScriptImageList(lists) {
      let best = null;
      for (const list of lists) {
        const urls = [];
        const seen = new Set();
        for (const value of list) {
          const url = this.normalizeImageUrl(value);
          if (!this.shouldTreatAsContentImage(url) || seen.has(url)) {
            continue;
          }
          seen.add(url);
          urls.push(url);
        }

        if (urls.length < 3) continue;

        const folderCounts = new Map();
        for (const url of urls) {
          const folderKey = this.getImageFolderKey(url);
          folderCounts.set(folderKey, (folderCounts.get(folderKey) || 0) + 1);
        }

        let bestFolderKey = "";
        let bestFolderCount = 0;
        for (const [folderKey, count] of folderCounts.entries()) {
          if (count > bestFolderCount) {
            bestFolderKey = folderKey;
            bestFolderCount = count;
          }
        }

        // 여러 이미지가 같은 폴더에 모인 배열을 본문 후보로 본다. 파일명은 정렬 기준으로 쓰지 않는다.
        const orderedUrls =
          bestFolderCount >= 3 && bestFolderCount >= Math.ceil(urls.length * 0.5)
            ? urls.filter((url) => this.getImageFolderKey(url) === bestFolderKey)
            : urls;
        const score = bestFolderCount * 1000 + orderedUrls.length - folderCounts.size * 5;

        if (!best || score > best.score) {
          best = { urls: orderedUrls, score };
        }
      }

      return best?.urls || [];
    },

    collectScriptArraySourceItems() {
      const lists = [];
      const scripts = Array.from(document.scripts || []);
      for (const script of scripts) {
        lists.push(...this.extractScriptArrayStringLists(script.textContent || ""));
      }

      const urls = this.chooseBestScriptImageList(lists);
      return urls.map((url, index) => this.buildSourceItem(url, null, url, index));
    },

    collectObservedResourceItems() {
      const urls = [];
      const seen = new Set();

      const pushUrl = (value) => {
        if (!this.shouldTreatAsContentImage(value) || seen.has(value)) return;
        seen.add(value);
        urls.push(value);
      };

      if (typeof window !== "undefined" && Array.isArray(window.__dcmvGenericObservedImageUrls)) {
        for (const url of window.__dcmvGenericObservedImageUrls) {
          pushUrl(url);
        }
      }

      if (typeof performance !== "undefined" && performance.getEntriesByType) {
        for (const entry of performance.getEntriesByType("resource")) {
          if (!entry?.name) continue;
          if (
            entry.initiatorType === "img" ||
            entry.initiatorType === "fetch" ||
            entry.initiatorType === "xmlhttprequest"
          ) {
            pushUrl(entry.name);
          }
        }
      }

      return urls.map((url, index) => this.buildSourceItem(url, null, url, index));
    },

    getPatternProbeUrls(normalizedPattern) {
      if (!normalizedPattern || typeof normalizedPattern !== "string") {
        return [];
      }

      if (normalizedPattern.startsWith("file:///")) {
        return [normalizedPattern];
      }

      const match = normalizedPattern.match(/^\*:\/\/([^/]+)(\/.*)?$/);
      if (!match) {
        return [];
      }

      const rawHost = match[1] || "";
      const baseHost = rawHost.replace(/^\*\./, "").replace(/\*/g, "").trim();
      if (!baseHost) {
        return [];
      }

      const urls = new Set([
        `https://${baseHost}/`,
        `http://${baseHost}/`
      ]);

      if (rawHost.startsWith("*.")) {
        urls.add(`https://www.${baseHost}/`);
        urls.add(`http://www.${baseHost}/`);
        urls.add(`https://sub.${baseHost}/`);
        urls.add(`http://sub.${baseHost}/`);
      }

      return Array.from(urls);
    },

    isHandledByBuiltInAdapter(normalizedPattern, registry) {
      if (!normalizedPattern || !registry?.listSiteAdapters) {
        return false;
      }

      const probeUrls = this.getPatternProbeUrls(normalizedPattern);
      if (!probeUrls.length) {
        return false;
      }

      const adapters = registry.listSiteAdapters() || [];
      const builtInAdapters = adapters.filter(
        (adapter) => adapter?.id && !String(adapter.id).startsWith("custom_")
      );

      return probeUrls.some((url) =>
        builtInAdapters.some((adapter) => {
          try {
            if (typeof adapter?.matchesUrl === "function") {
              return adapter.matchesUrl(url);
            }
            if (adapter?.urlPattern instanceof RegExp) {
              return adapter.urlPattern.test(url);
            }
          } catch {
            return false;
          }
          return false;
        })
      );
    },

    // 저장된 사이트를 어댑터로 변환
    async loadAndRegisterCustomAdapters() {
      const sites = await this.loadCustomSites();
      const registry = globalThis.__dcmvSiteRegistry;
      
      if (!registry?.registerSiteAdapter) {
        console.warn("[DCMV] Site registry not available");
        return [];
      }

      registry.removeSiteAdapters?.((adapter) =>
        !!adapter?.id && String(adapter.id).startsWith("custom_")
      );

      const adapters = [];
      for (const site of sites) {
        if (!site.enabled) continue;

        const normalizedPattern = this.normalizeUrlPatternInput(site.urlPattern || "");
        if (this.isHandledByBuiltInAdapter(normalizedPattern, registry)) {
          continue;
        }

        const regex = this.patternToRegex(normalizedPattern);
        if (!regex) continue;

        const adapter = this.createAdapterFromSite(
          {
            ...site,
            urlPattern: normalizedPattern
          },
          regex
        );
        registry.registerSiteAdapter(adapter);
        adapters.push(adapter);
      }

      return adapters;
    },

    createAdapterFromSite(site, regex) {
      const contentSelectors = this.getPreferredContentSelectors(
        site.contentSelectors || DEFAULT_CONTENT_SELECTORS
      );
      const excludedSelectors = site.excludedSelectors || DEFAULT_EXCLUDED_SELECTORS;
      const normalizedPattern = this.normalizeUrlPatternInput(site.urlPattern || "");
      const universalSiteSettings = this;
      let previousSelectedSource = null;

      function countContentImages(root) {
        if (!universalSiteSettings.isElementLike(root) && root !== document.body) {
          return 0;
        }

        const images = Array.from(root.querySelectorAll?.("img") || []);
        let count = 0;
        for (const img of images) {
          if (!universalSiteSettings.isElementLike(img)) continue;
          if (img.closest("#dcmv-overlay")) continue;

          const src =
            img.getAttribute("data-img-src") ||
            img.getAttribute("data-src") ||
            img.getAttribute("data-lazy-src") ||
            img.getAttribute("data-original") ||
            img.getAttribute("data-original-src") ||
            img.getAttribute("src") ||
            "";
          if (!universalSiteSettings.shouldTreatAsContentImageElement(img, src)) continue;
          count += 1;
        }

        return count;
      }

      return {
        id: site.id,
        name: "만갤 뷰어",
        shortName: site.name || "Custom",
        menuId: `dcmv-open-${site.id}`,
        menuTitle: "만갤 뷰어",
        actionTitle: "만갤 뷰어",
        documentUrlPatterns: normalizedPattern ? [normalizedPattern] : [],
        urlPattern: regex,
        matchesUrl(url) {
          return typeof url === "string" && regex.test(url);
        },
        findContentRoot(doc = document) {
          let fallbackRoot = null;
          let bestRoot = null;
          let bestScore = 0;

          for (const selector of contentSelectors) {
            const el = doc.querySelector(selector);
            if (!el) continue;

            if (!fallbackRoot) {
              fallbackRoot = el;
            }

            const score = countContentImages(el);
            if (score > bestScore) {
              bestRoot = el;
              bestScore = score;
            }
          }

          const candidateRoots = Array.from(
            doc.querySelectorAll?.("article, main, section, .content, .post-content, .entry-content, .article-content, .viewer-wrap, .read-content, .reading-content, #postViewArea, #post-area, .se-main-container, #content, #contents") || []
          ).filter((el) => !el.closest?.("#dcmv-overlay"));

          for (const candidate of candidateRoots) {
            const score = countContentImages(candidate);
            if (score > bestScore) {
              bestRoot = candidate;
              bestScore = score;
            }
          }

          if (bestRoot && bestScore > 0) {
            return bestRoot;
          }

          for (const frameDoc of universalSiteSettings.getAccessibleEmbeddedDocuments(doc)) {
            const frameRoot = this.findContentRoot(frameDoc);
            const frameScore = countContentImages(frameRoot);
            if (frameRoot && frameScore > bestScore) {
              bestRoot = frameRoot;
              bestScore = frameScore;
            }
          }

          if (bestRoot && bestScore > 0) {
            return bestRoot;
          }

          return fallbackRoot || doc.body;
        },
        async collectSourceItems(root, deps) {
          const candidates = [];
          const pushCandidate = (items, sourceType) => {
            if (!Array.isArray(items) || !items.length) return;

            const typedItems = universalSiteSettings.withGenericSourceType(items, sourceType);
            candidates.push({
              items: typedItems,
              sourceType,
              scoreInfo: universalSiteSettings.scoreSourceItemList(typedItems, sourceType)
            });
          };

          pushCandidate(
            universalSiteSettings.collectDomSourceItems(root, deps, this),
            "dom"
          );
          pushCandidate(
            universalSiteSettings.collectScriptArraySourceItems(),
            "script"
          );
          pushCandidate(
            universalSiteSettings.collectObservedResourceItems(),
            "observed"
          );

          if (!candidates.length) {
            previousSelectedSource = null;
            return [];
          }

          candidates.sort((a, b) => b.scoreInfo.score - a.scoreInfo.score);
          const bestCandidate = candidates[0];
          const shouldReplace = universalSiteSettings.shouldReplacePreviousGenericItems(
            previousSelectedSource,
            bestCandidate
          );
          const selected = shouldReplace && bestCandidate
            ? bestCandidate
            : previousSelectedSource || bestCandidate;

          previousSelectedSource = selected;
          return selected.items.map((item, index) => ({
            ...item,
            index,
            displayIndex: index + 1
          }));
        },
        getDebugSelectedSource() {
          return previousSelectedSource;
        },
        isInsideExcludedImageCommentArea(el) {
          if (!universalSiteSettings.isElementLike(el)) return false;
          return !!el.closest(excludedSelectors.join(", "));
        },
        isExcludedInlineDcconImage() {
          return false;
        },
        isInsideOpenGraphPreview(el) {
          if (!universalSiteSettings.isElementLike(el)) return false;
          return !!el.closest("[property^='og:'], meta, link[rel='image_src']");
        },
        convertPopUrlToDirectImageUrl(popUrl) {
          return popUrl || "";
        },
        parseOriginalPopUrlFromTag() {
          return "";
        },
        resolveImageUrlFromTag(tag, deps) {
          return (
            deps.decodeHtml(deps.parseAttr(tag, "data-src")) ||
            deps.decodeHtml(deps.parseAttr(tag, "data-lazy-src")) ||
            deps.decodeHtml(deps.parseAttr(tag, "data-img-src")) ||
            deps.decodeHtml(deps.parseAttr(tag, "data-original")) ||
            deps.decodeHtml(deps.parseAttr(tag, "data-original-src")) ||
            deps.decodeHtml(deps.parseAttr(tag, "src")) ||
            ""
          );
        },
        pokeLazyImages(root) {
          const images = Array.from(root?.querySelectorAll?.("img") || []);
          for (const img of images) {
            try {
              const dataSrc =
                img.getAttribute("data-src") ||
                img.getAttribute("data-lazy-src") ||
                img.getAttribute("data-original");
              const currentSrc = img.getAttribute("src") || "";
              const shouldReplaceExistingSrc =
                !currentSrc ||
                /^data:/i.test(currentSrc) ||
                /(?:^|\/)(?:loading|loader|spinner)[^/]*\.(?:gif|png|webp)(?:[?#].*)?$/i.test(currentSrc);

              if (dataSrc && shouldReplaceExistingSrc) {
                img.setAttribute("src", dataSrc);
              }
            } catch {
            }
          }
        }
      };
    }
  };

  if (typeof document !== "undefined" && !globalThis.__dcmvGenericScoreDebugReady) {
    globalThis.__dcmvGenericScoreDebugReady = true;
    document.addEventListener("dcmv:debug-generic-scores", () => {
      const settings = modules.universalSiteSettings;
      const adapter =
        globalThis.__dcmvSiteRegistry?.getSiteAdapterForUrl?.(location.href) || {
          findContentRoot() {
            return document.querySelector("#scroll-list") || document.body;
          },
          isInsideExcludedImageCommentArea() {
            return false;
          },
          isInsideOpenGraphPreview() {
            return false;
          },
          resolveImageUrlFromTag() {
            return "";
          }
        };
      const deps = {
        decodeHtml(value) {
          const textarea = document.createElement("textarea");
          textarea.innerHTML = String(value || "");
          return textarea.value;
        },
        parseAttr(tag, name) {
          const match = String(tag || "").match(
            new RegExp(`${name}=["']([^"']*)["']`, "i")
          );
          return match?.[1] || "";
        },
        resolveImageUrlFromTag(tag) {
          return adapter.resolveImageUrlFromTag?.(tag, deps) || "";
        }
      };
      const root = adapter.findContentRoot?.() || document.body;
      const candidateRows = [
        ["dom", settings.collectDomSourceItems(root, deps, adapter)],
        ["script", settings.collectScriptArraySourceItems()],
        ["observed", settings.collectObservedResourceItems()]
      ]
        .map(([type, items]) => {
          const typedItems = settings.withGenericSourceType(items, type);
          const scoreInfo = settings.scoreSourceItemList(typedItems, type);
          return {
            type,
            count: items.length,
            score: scoreInfo.score,
            large: scoreInfo.largeCount,
            medianArea: Math.round(scoreInfo.medianArea),
            commentRatio: Number(scoreInfo.commentRatio.toFixed(2)),
            squareRatio: Number(scoreInfo.squareRatio.toFixed(2)),
            smallRatio: Number(scoreInfo.smallRatio.toFixed(2)),
            dominantFolderCount: scoreInfo.folderStats.dominantCount,
            dominantRatio: Number(scoreInfo.folderStats.dominantRatio.toFixed(2))
          };
        });
      const selected = adapter.getDebugSelectedSource?.();
      let currentRow = null;
      if (selected?.items?.length) {
        const selectedInfo = selected.scoreInfo ||
          settings.scoreSourceItemList(selected.items, selected.sourceType || "selected");
        currentRow = {
          type: `current-selected:${selected.sourceType || "unknown"}`,
          count: selected.items.length,
          score: selectedInfo.score,
          large: selectedInfo.largeCount,
          medianArea: Math.round(selectedInfo.medianArea),
          commentRatio: Number(selectedInfo.commentRatio.toFixed(2)),
          squareRatio: Number(selectedInfo.squareRatio.toFixed(2)),
          smallRatio: Number(selectedInfo.smallRatio.toFixed(2)),
          dominantFolderCount: selectedInfo.folderStats.dominantCount,
          dominantRatio: Number(selectedInfo.folderStats.dominantRatio.toFixed(2))
        };
      }
      const rows = currentRow ? [currentRow, ...candidateRows] : candidateRows;

      console.log("[dcmv] generic score current", currentRow || null);
      console.log("[dcmv] generic score candidates", candidateRows);
      console.table(rows);
      console.log("[dcmv] generic score all", rows);
      console.log("[dcmv] generic score winner", rows.slice().sort((a, b) => b.score - a.score)[0] || null);
    });
  }
})();

