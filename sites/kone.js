(function () {
  const registry = globalThis.__dcmvSiteRegistry;
  if (!registry?.registerSiteAdapter) {
    return;
  }

  const adapter = {
    id: "kone",
    name: "만갤 뷰어",
    shortName: "Kone",
    menuId: "dcmv-open-kone",
    menuTitle: "만갤 뷰어",
    actionTitle: "만갤 뷰어",
    documentUrlPatterns: ["*://kone.gg/*", "*://*.kone.gg/*"],
    urlPattern: /^https?:\/\/([^.]+\.)?kone\.gg\//i,
    matchesUrl(url) {
      return typeof url === "string" && this.urlPattern.test(url);
    },
    findContentRoot(doc = document) {
      const selectors = [
        "#post_content",
        ".prose-container",
        ".relative.min-h-60",
        "main article",
        "main"
      ];

      for (const selector of selectors) {
        const el = doc.querySelector(selector);
        if (el) return el;
      }

      return doc.body;
    },
    collectSourceItems(root, deps) {
      const contentRoot =
        root?.shadowRoot ||
        root?.querySelector?.("#post_content")?.shadowRoot ||
        root;
      const domImages = Array.from(contentRoot?.querySelectorAll?.("img") || []);
      const result = [];
      const seen = new Set();

      for (const imgEl of domImages) {
        if (this.isInsideExcludedImageCommentArea(imgEl)) continue;
        if (this.isExcludedInlineDcconImage(imgEl)) continue;
        if (this.isInsideOpenGraphPreview(imgEl)) continue;

        const originalPopUrl =
          imgEl.closest("a[href]")?.href ||
          deps.parseOriginalPopUrlFromTag(imgEl.outerHTML || "");
        const normalSrc =
          imgEl.getAttribute("data-src") ||
          imgEl.getAttribute("data-original") ||
          imgEl.getAttribute("src") ||
          deps.resolveImageUrlFromTag(imgEl.outerHTML || "");

        const decodedSrc = deps.decodeHtml(normalSrc || "");
        const decodedPopUrl = deps.decodeHtml(originalPopUrl || "");
        const dedupeKey = decodedPopUrl || decodedSrc;

        if (!dedupeKey || seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        result.push({
          src: decodedSrc || "",
          originalPopUrl: decodedPopUrl || "",
          resolvedSrc: "",
          width: imgEl.naturalWidth || Number(imgEl.getAttribute("width")) || 0,
          height: imgEl.naturalHeight || Number(imgEl.getAttribute("height")) || 0,
          alt: imgEl.getAttribute("alt") || "",
          index: result.length,
          displayIndex: result.length + 1,
          element: imgEl,
          failed: false
        });
      }

      return result;
    },
    isInsideExcludedImageCommentArea(el) {
      if (!(el instanceof Element)) return false;
      return !!el.closest(
        "#comments, [data-slot='popover-content'], header, nav, aside, footer"
      );
    },
    isExcludedInlineDcconImage() {
      return false;
    },
    isInsideOpenGraphPreview(el) {
      if (!(el instanceof Element)) return false;
      return !!el.closest(
        "header, [data-slot='button'], [data-slot='popover-trigger'], .image-download, [data-image-float]"
      );
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
        deps.decodeHtml(deps.parseAttr(tag, "data-original")) ||
        deps.decodeHtml(deps.parseAttr(tag, "src")) ||
        ""
      );
    }
  };

  registry.registerSiteAdapter(adapter);
})();
