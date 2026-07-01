(function () {
  const globalRoot =
    typeof globalThis !== "undefined"
      ? globalThis
      : typeof self !== "undefined"
        ? self
        : this;

  const adapters = (globalRoot.__dcmvSiteAdapters =
    globalRoot.__dcmvSiteAdapters || []);

  function registerSiteAdapter(adapter) {
    if (!adapter?.id) return;

    const existingIndex = adapters.findIndex((item) => item.id === adapter.id);
    if (existingIndex >= 0) {
      adapters.splice(existingIndex, 1, adapter);
      return;
    }

    adapters.push(adapter);
  }

  function getSiteAdapterForUrl(url) {
    if (!url) return null;

    return (
      adapters.find((adapter) => {
        if (typeof adapter?.matchesUrl === "function") {
          return adapter.matchesUrl(url);
        }

        if (adapter?.urlPattern instanceof RegExp) {
          return adapter.urlPattern.test(url);
        }

        return false;
      }) || null
    );
  }

  function listSiteAdapters() {
    return [...adapters];
  }

  function removeSiteAdapters(predicate) {
    if (typeof predicate !== "function") return 0;

    let removedCount = 0;
    for (let i = adapters.length - 1; i >= 0; i -= 1) {
      try {
        if (predicate(adapters[i], i)) {
          adapters.splice(i, 1);
          removedCount += 1;
        }
      } catch {
      }
    }

    return removedCount;
  }

  globalRoot.__dcmvSiteRegistry = {
    registerSiteAdapter,
    getSiteAdapterForUrl,
    listSiteAdapters,
    removeSiteAdapters
  };
})();
