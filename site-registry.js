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

  globalRoot.__dcmvSiteRegistry = {
    registerSiteAdapter,
    getSiteAdapterForUrl,
    listSiteAdapters
  };
})();
