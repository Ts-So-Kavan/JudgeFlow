const statusElement = document.querySelector("#status");
const summaryElement = document.querySelector("#summary");
const clearButton = document.querySelector("#clear");

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

async function refresh() {
  const response = await send({ type: "JUDGEFLOW_GET_PENDING_BALLOT" });
  const payload = response?.payload;
  if (!payload) {
    statusElement.textContent = "No JudgeFlow ballot is waiting. Send one from the final ballot page.";
    summaryElement.hidden = true;
    clearButton.hidden = true;
    return;
  }
  statusElement.textContent = "A reviewed ballot is ready to autofill.";
  summaryElement.hidden = false;
  summaryElement.innerHTML = "";
  const winner = document.createElement("strong");
  winner.textContent = `Winner: ${payload.decision.winnerLabel}`;
  const detail = document.createElement("span");
  detail.textContent = `${payload.round.event} · ${payload.points.length} speaker point${payload.points.length === 1 ? "" : "s"}`;
  summaryElement.append(winner, detail);
  clearButton.hidden = false;
}

document.querySelector("#open").addEventListener("click", () => send({ type: "JUDGEFLOW_OPEN_TABROOM" }));
clearButton.addEventListener("click", async () => {
  await send({ type: "JUDGEFLOW_CLEAR_PENDING_BALLOT" });
  await refresh();
});

refresh().catch(() => {
  statusElement.textContent = "The companion could not read its local ballot session.";
});
