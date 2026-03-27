(function () {
  const registry = globalThis.__dcmvSiteRegistry;
  if (!registry?.registerSiteAdapter) {
    return;
  }

  function isDcImageUrl(url) {
    return /https?:\/\/(?:dcimg\d+|image)\.dcinside\.(?:com|co\.kr)\/(?:viewimage\.php\?|dccon\.php|data\/)/i.test(
      url
    );
  }

  const adapter = {
    id: "dcinside",
    name: "만갤 뷰어",
    shortName: "DCInside",
    menuId: "dcmv-open-dcinside",
    menuTitle: "만갤 뷰어",
    actionTitle: "만갤 뷰어",
    documentUrlPatterns: ["*://*.dcinside.com/*", "*://*.dcinside.co.kr/*"],
    urlPattern: /^https?:\/\/([^.]+\.)?dcinside\.(com|co\.kr)\//i,
    matchesUrl(url) {
      return typeof url === "string" && this.urlPattern.test(url);
    },
    findContentRoot(doc = document) {
      const selectors = [
        ".writing_view_box",
        ".write_div",
        ".view_content_wrap",
        ".view_content",
        ".gallview_contents",
        ".ub-content",
        "article",
        "main"
      ];

      for (const selector of selectors) {
        const el = doc.querySelector(selector);
        if (el) return el;
      }

      return doc.body;
    },
    isInsideExcludedImageCommentArea(el) {
      if (!(el instanceof Element)) return false;
      return !!el.closest("div.comment_box.img_comment_box");
    },
    isExcludedInlineDcconImage(el) {
      if (!(el instanceof Element)) return false;
      return el.matches("img.written_dccon");
    },
    isInsideOpenGraphPreview(el) {
      if (!(el instanceof Element)) return false;
      return !!el.closest("div.og-div");
    },
    convertPopUrlToDirectImageUrl(popUrl) {
      if (!popUrl) return "";

      try {
        const url = new URL(popUrl);
        const no = url.searchParams.get("no");
        if (!no) return popUrl;
        return `https://image.dcinside.com/viewimage.php?id=&no=${no}`;
      } catch {
        return popUrl;
      }
    },
    parseOriginalPopUrlFromTag(tag, deps) {
      const match = tag.match(/imgPop\(['"]([^'"]+)['"]/i);
      if (!match) return "";
      return deps.decodeHtml(match[1]);
    },
    resolveImageUrlFromTag(tag, deps) {
      const dataOriginal = deps.parseAttr(tag, "data-original");
      if (dataOriginal && isDcImageUrl(dataOriginal)) {
        return deps.decodeHtml(dataOriginal);
      }

      const dataSrc = deps.parseAttr(tag, "data-src");
      if (dataSrc && isDcImageUrl(dataSrc)) {
        return deps.decodeHtml(dataSrc);
      }

      const src = deps.parseAttr(tag, "src");
      if (src && isDcImageUrl(src)) {
        return deps.decodeHtml(src);
      }

      return "";
    }
  };

  registry.registerSiteAdapter(adapter);
})();
