(function (rootFactory) {
  if (typeof module === "object" && module.exports) {
    module.exports = rootFactory();
    return;
  }

  const globalRoot =
    typeof globalThis !== "undefined"
      ? globalThis
      : typeof self !== "undefined"
        ? self
        : this;

  globalRoot.__dcmvCommon = rootFactory();
})(function () {
  function getPortraitRatio(item) {
    if (!item?.width || !item?.height) return 0;
    return item.height / item.width;
  }

  function getMedian(values) {
    if (!Array.isArray(values) || !values.length) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) {
      return sorted[mid];
    }

    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function normalizeComparableUrl(url, baseUrl) {
    if (!url) return "";

    try {
      const resolvedBase =
        baseUrl ||
        (typeof location !== "undefined" && location.href ? location.href : undefined);
      return new URL(url, resolvedBase).href;
    } catch {
      return String(url);
    }
  }

  function appendCacheBust(url, timestamp = Date.now()) {
    if (!url) return url;
    const [base] = String(url).split("#");
    const joiner = base.includes("?") ? "&" : "?";
    return `${base}${joiner}_dcmv=${timestamp}`;
  }

  function isLandscapeLike(width, height) {
    if (!width || !height) return null;
    return width >= height;
  }

  return {
    getPortraitRatio,
    getMedian,
    normalizeComparableUrl,
    appendCacheBust,
    isLandscapeLike
  };
});
