const STORAGE_KEY = "judgeflowPendingBallot";
const TABROOM_START_URL = "https://www.tabroom.com/user/login/login.mhtml";

function isValidBallot(payload) {
  return Boolean(
    payload
      && payload.version === 1
      && ["A", "B"].includes(payload.decision?.winnerSide)
      && typeof payload.decision?.winnerLabel === "string"
      && typeof payload.ballot?.rfd === "string"
      && Array.isArray(payload.points)
      && Array.isArray(payload.ballot?.feedback),
  );
}

async function getPendingBallot() {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || null;
}

async function openOrFocusTabroom() {
  const tabs = await chrome.tabs.query({ url: "https://www.tabroom.com/*" });
  const existing = tabs.find((tab) => typeof tab.id === "number");
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (typeof existing.windowId === "number") {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return existing.id;
  }
  const created = await chrome.tabs.create({ url: TABROOM_START_URL, active: true });
  return created.id || null;
}

async function notifyTabroomTabs(payload) {
  const tabs = await chrome.tabs.query({ url: "https://www.tabroom.com/*" });
  await Promise.all(tabs.map(async (tab) => {
    if (typeof tab.id !== "number") return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "JUDGEFLOW_BALLOT_UPDATED", payload });
    } catch {
      // The content script will request the pending ballot after the page loads.
    }
  }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "JUDGEFLOW_QUEUE_BALLOT") {
    if (!isValidBallot(message.payload)) {
      sendResponse({ ok: false, error: "JudgeFlow sent an invalid ballot packet." });
      return false;
    }
    (async () => {
      await chrome.storage.session.set({ [STORAGE_KEY]: message.payload });
      await notifyTabroomTabs(message.payload);
      const tabId = await openOrFocusTabroom();
      sendResponse({ ok: true, tabId });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not open Tabroom." }));
    return true;
  }

  if (message?.type === "JUDGEFLOW_GET_PENDING_BALLOT") {
    getPendingBallot()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not read the ballot." }));
    return true;
  }

  if (message?.type === "JUDGEFLOW_CLEAR_PENDING_BALLOT") {
    chrome.storage.session.remove(STORAGE_KEY)
      .then(() => notifyTabroomTabs(null))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not clear the ballot." }));
    return true;
  }

  if (message?.type === "JUDGEFLOW_OPEN_TABROOM") {
    openOrFocusTabroom()
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not open Tabroom." }));
    return true;
  }

  return false;
});
