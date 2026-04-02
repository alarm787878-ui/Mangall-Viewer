(function () {
  const extensionApi =
    typeof browser !== "undefined"
      ? browser
      : typeof chrome !== "undefined"
        ? chrome
        : null;

  function callMaybeAsync(fn, context, args, transformResult) {
    if (typeof fn !== "function") {
      return Promise.resolve(
        typeof transformResult === "function" ? transformResult(undefined) : undefined
      );
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const finalize = (value) => {
        if (settled) return;
        settled = true;
        resolve(typeof transformResult === "function" ? transformResult(value) : value);
      };

      const callback = (value) => {
        const lastError = extensionApi?.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }

        finalize(value);
      };

      try {
        const result = fn.call(context, ...args, callback);

        if (result && typeof result.then === "function") {
          result.then(finalize).catch(reject);
          return;
        }

        if (fn.length < args.length + 1) {
          finalize(result);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  globalThis.__dcmvBrowserApi = {
    raw: extensionApi,

    getStorageArea() {
      return extensionApi?.storage?.local || null;
    },

    removeAllContextMenus() {
      return callMaybeAsync(extensionApi?.contextMenus?.removeAll, extensionApi?.contextMenus, []);
    },

    createContextMenu(createProperties) {
      return callMaybeAsync(
        extensionApi?.contextMenus?.create,
        extensionApi?.contextMenus,
        [createProperties]
      );
    },

    insertCss(tabId, files) {
      return callMaybeAsync(extensionApi?.scripting?.insertCSS, extensionApi?.scripting, [
        {
          target: { tabId },
          files
        }
      ]);
    },

    executeScript(tabId, files) {
      return callMaybeAsync(extensionApi?.scripting?.executeScript, extensionApi?.scripting, [
        {
          target: { tabId },
          files
        }
      ]);
    },

    executeFunction(tabId, func, args = []) {
      return callMaybeAsync(extensionApi?.scripting?.executeScript, extensionApi?.scripting, [
        {
          target: { tabId },
          func,
          args
        }
      ]);
    },

    queryActiveTab() {
      return callMaybeAsync(
        extensionApi?.tabs?.query,
        extensionApi?.tabs,
        [{ active: true, currentWindow: true }],
        (tabs) => (Array.isArray(tabs) ? tabs[0] || null : null)
      );
    },

    sendMessage(tabId, message) {
      return callMaybeAsync(extensionApi?.tabs?.sendMessage, extensionApi?.tabs, [
        tabId,
        message
      ]);
    },

    sendRuntimeMessage(message) {
      return callMaybeAsync(extensionApi?.runtime?.sendMessage, extensionApi?.runtime, [
        message
      ]);
    },

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    addRuntimeInstalledListener(listener) {
      extensionApi?.runtime?.onInstalled?.addListener?.(listener);
    },

    addRuntimeStartupListener(listener) {
      extensionApi?.runtime?.onStartup?.addListener?.(listener);
    },

    addContextMenuClickListener(listener) {
      extensionApi?.contextMenus?.onClicked?.addListener?.(listener);
    }
  };
})();
