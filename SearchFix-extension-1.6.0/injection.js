// Chrome may omit a thrown injected error from InjectionResult. Readers return
// a plain error envelope in capture mode so the original cause survives IPC.
export function createPageInjector(scripting, log = () => {}) {
  return async (tabId, func, args) => {
    log('page.read.start', {step:func.name, tabId});
    try {
      const responses = await scripting.executeScript({target:{tabId},func,args:[...args,true]});
      const response = responses.find(item => !item.frameId);
      if (response?.result?.searchFixError) throw Object.assign(new Error(response.result.searchFixError),{code:response.result.errorCode,httpStatus:response.result.httpStatus});
      if (response?.error) throw new Error(response.error.message || 'Browser rejected the page reader.');
      if (response?.result == null) throw new Error(`${func.name} returned no page data. The tab may have navigated or the browser blocked access.`);
      log('page.read.complete', {step:func.name, tabId});
      return response.result;
    } catch (error) {
      log('page.read.failed', {step:func.name, tabId, errorCode:error.code,httpStatus:error.httpStatus});
      throw error;
    }
  };
}
