(function () {
  const registry = globalThis.__dcmvSiteRegistry;
  if (!registry?.registerSiteAdapter) {
    return;
  }

  const adapter = {
    id: "blogspot",
    name: "만갤 뷰어",
    shortName: "Blogspot",
    menuId: "dcmv-open-blogspot",
    menuTitle: "만갤 뷰어",
    actionTitle: "만갤 뷰어",
    documentUrlPatterns: ["*://*.blogspot.com/*"],
    urlPattern: /^https?:\/\/([^.]+\.)*blogspot\.com\//i,
    matchesUrl(url) {
      return typeof url === "string" && this.urlPattern.test(url);
    },
    findContentRoot(doc = document) {
      const selectors = [
        ".post-body.entry-content",
        ".post-body",
        ".entry-content",
        "article .post-body",
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
        "#comments, .comments, .comment-thread, .sidebar, .sidebar-container, .PopularPosts, .FeaturedPost, .BlogArchive, footer"
      );
    },
    isExcludedInlineDcconImage() {
      return false;
    },
    isInsideOpenGraphPreview(el) {
      if (!(el instanceof Element)) return false;
      return !!el.closest(
        ".snippet-thumbnail, .post-author-avatar, .author-profile, .avatar-image-container"
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
