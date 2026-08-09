(function () {
  const extensionApi =
    typeof browser !== "undefined"
      ? browser
      : typeof chrome !== "undefined"
        ? chrome
        : null;
  const usesPromiseApi =
    typeof browser !== "undefined" && extensionApi === browser;

  function callMaybeAsync(fn, context, args, transformResult) {
    if (typeof fn !== "function") {
      return Promise.resolve(
        typeof transformResult === "function" ? transformResult(undefined) : undefined
      );
    }

    if (usesPromiseApi) {
      try {
        const result = fn.call(context, ...args);
        if (result && typeof result.then === "function") {
          return result.then((value) =>
            typeof transformResult === "function" ? transformResult(value) : value
          );
        }

        return Promise.resolve(
          typeof transformResult === "function" ? transformResult(result) : result
        );
      } catch (error) {
        return Promise.reject(error);
      }
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

  function createStorageAreaAdapter(area) {
    if (!area) return null;

    const callStorage = (methodName, args, callback) => {
      try {
        const result = area[methodName]?.(...args);
        if (result && typeof result.then === "function") {
          result.then((value) => callback?.(value)).catch(() => callback?.());
          return;
        }

        if (typeof callback === "function") {
          callback(result);
        }
      } catch {
        if (typeof callback === "function") {
          callback();
        }
      }
    };

    return {
      get(keys, callback) {
        return callStorage("get", [keys], callback);
      },
      set(values, callback) {
        return callStorage("set", [values], callback);
      },
      remove(keys, callback) {
        return callStorage("remove", [keys], callback);
      }
    };
  }

  globalThis.__dcmvBrowserApi = {
    raw: extensionApi,

    getStorageArea() {
      return createStorageAreaAdapter(extensionApi?.storage?.local);
    },

    removeAllContextMenus() {
      const menuApi = extensionApi?.menus || extensionApi?.contextMenus;
      return callMaybeAsync(menuApi?.removeAll, menuApi, []);
    },

    createContextMenu(createProperties) {
      const menuApi = extensionApi?.menus || extensionApi?.contextMenus;
      return callMaybeAsync(
        menuApi?.create,
        menuApi,
        [createProperties]
      );
    },

    addContextMenuClickListener(listener) {
      const menuApi = extensionApi?.menus || extensionApi?.contextMenus;
      menuApi?.onClicked?.addListener?.(listener);
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
  };
})();
