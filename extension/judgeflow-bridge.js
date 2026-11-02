(() => {
  const PAGE_SOURCE = "judgeflow";
  const EXTENSION_SOURCE = "judgeflow-tabroom-companion";

  function postToJudgeFlow(message) {
    window.postMessage({ source: EXTENSION_SOURCE, ...message }, window.location.origin);
  }

  function announceReady() {
    postToJudgeFlow({ type: "JUDGEFLOW_TABROOM_READY", version: chrome.runtime.getManifest().version });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.source !== PAGE_SOURCE) return;

    if (event.data.type === "JUDGEFLOW_TABROOM_PING") {
      announceReady();
      return;
    }

    if (event.data.type !== "JUDGEFLOW_TABROOM_QUEUE") return;
    const requestId = event.data.requestId;
    chrome.runtime.sendMessage(
      { type: "JUDGEFLOW_QUEUE_BALLOT", payload: event.data.payload },
      (response) => {
        const error = chrome.runtime.lastError?.message;
        postToJudgeFlow({
          type: "JUDGEFLOW_TABROOM_RESULT",
          requestId,
          ok: Boolean(response?.ok) && !error,
          error: error || response?.error || null,
        });
      },
    );
  });

  announceReady();
})();
