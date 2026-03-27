(function () {
  const registry = globalThis.__dcmvSiteRegistry;
  if (!registry?.registerSiteAdapter) {
    return;
  }

  const adapter = {
    id: "arca-live",
    name: "만갤 뷰어",
    shortName: "Arcalive",
    menuId: "dcmv-open-arca-live",
    menuTitle: "만갤 뷰어",
    actionTitle: "만갤 뷰어",
    documentUrlPatterns: ["*://arca.live/*", "*://*.arca.live/*"],
    urlPattern: /^https?:\/\/([^.]+\.)?arca\.live\//i,
    matchesUrl(url) {
      return typeof url === "string" && this.urlPattern.test(url);
    },
    findContentRoot(doc = document) {
      const selectors = [
        ".fr-view.article-content",
        ".article-body .article-content",
        ".article-body",
        ".board-article .article-body",
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
      return !!el.closest(
        ".article-comment, .comment-list, .comment-item, .article-head, .article-profile"
      );
    },
    isExcludedInlineDcconImage(el) {
      if (!(el instanceof Element)) return false;
      return el.matches("img.written_dccon, img.emoticon");
    },
    isInsideOpenGraphPreview(el) {
      if (!(el instanceof Element)) return false;
      return !!el.closest("div.og-div, .article-link-card, .link-preview");
    },
    convertPopUrlToDirectImageUrl(popUrl) {
      return popUrl || "";
    },
    parseOriginalPopUrlFromTag(tag, deps) {
      const match = tag.match(/imgPop\(['"]([^'"]+)['"]/i);
      if (!match) return "";
      return deps.decodeHtml(match[1]);
    },
    resolveImageUrlFromTag(tag, deps) {
      return (
        deps.decodeHtml(deps.parseAttr(tag, "data-original")) ||
        deps.decodeHtml(deps.parseAttr(tag, "data-src")) ||
        deps.decodeHtml(deps.parseAttr(tag, "src")) ||
        ""
      );
    },
    pokeLazyImages(root) {
      const imgs = Array.from(root.querySelectorAll("img[loading='lazy'], img[loading='auto'], img[src]"));
      for (const img of imgs) {
        const eagerSrc = img.getAttribute("data-original") || img.getAttribute("data-src") || img.getAttribute("src") || "";
        if (!eagerSrc) continue;

        img.loading = "eager";
        img.setAttribute("loading", "eager");
        img.decoding = "sync";
        img.setAttribute("decoding", "sync");
        img.fetchPriority = "high";
        img.setAttribute("fetchpriority", "high");

        if (!img.complete || !img.naturalWidth) {
          const preloader = new Image();
          preloader.decoding = "sync";
          preloader.src = eagerSrc;
        }
      }
    }
  };

  registry.registerSiteAdapter(adapter);
})();
