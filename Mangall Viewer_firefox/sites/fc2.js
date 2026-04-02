(function () {
  const registry = globalThis.__dcmvSiteRegistry;
  if (!registry?.registerSiteAdapter) {
    return;
  }

  const adapter = {
    id: "fc2",
    name: "만갤 뷰어",
    shortName: "FC2",
    menuId: "dcmv-open-fc2",
    menuTitle: "만갤 뷰어",
    actionTitle: "만갤 뷰어",
    documentUrlPatterns: ["*://*.blog.fc2.com/*"],
    urlPattern: /^https?:\/\/([^.]+\.)?blog\.fc2\.com\//i,
    matchesUrl(url) {
      return typeof url === "string" && this.urlPattern.test(url);
    },
    findContentRoot(doc = document) {
      const selectors = [
        ".entry_body",
        ".content.entry .entry_body",
        ".entry .entry_body",
        "#main_contents .entry_body",
        ".entry",
        "article"
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
        "#comments, .comment, .comment_list, .comment-body, #sidemenu, .plg_body, .entry_footer, .fc2_footer, footer"
      );
    },
    isExcludedInlineDcconImage() {
      return false;
    },
    isInsideOpenGraphPreview(el) {
      if (!(el instanceof Element)) return false;
      return !!el.closest(
        ".plugin-qrcode, .fc2_footer, .entry_state, .entry_date"
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
        deps.decodeHtml(deps.parseAttr(tag, "data-original")) ||
        deps.decodeHtml(deps.parseAttr(tag, "data-src")) ||
        deps.decodeHtml(deps.parseAttr(tag, "src")) ||
        ""
      );
    }
  };

  registry.registerSiteAdapter(adapter);
})();
