(() => {
  const PANEL_ID = "judgeflow-tabroom-companion";
  let currentPayload = null;

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isEditable(control) {
    if (!(control instanceof HTMLElement)) return false;
    if (control.matches("[disabled], [readonly], input[type='hidden'], input[type='submit'], input[type='button']")) return false;
    const style = window.getComputedStyle(control);
    return style.display !== "none" && style.visibility !== "hidden" && control.getClientRects().length > 0;
  }

  function controlContext(control) {
    const parts = [
      control.id,
      control.getAttribute("name"),
      control.getAttribute("placeholder"),
      control.getAttribute("aria-label"),
      control.getAttribute("title"),
    ];
    if ("labels" in control && control.labels) {
      parts.push(...Array.from(control.labels, (label) => label.textContent || ""));
    }
    const labelledBy = control.getAttribute("aria-labelledby");
    if (labelledBy) {
      parts.push(...labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || ""));
    }
    let parent = control.parentElement;
    for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
      parts.push((parent.innerText || parent.textContent || "").slice(0, 500));
    }
    return normalize(parts.filter(Boolean).join(" "));
  }

  function setControlValue(control, value) {
    if (control instanceof HTMLSelectElement) {
      control.value = value;
    } else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
      const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(control, String(value));
      else control.value = String(value);
    } else if (control.isContentEditable) {
      control.textContent = String(value);
    }
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setChecked(control) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
    if (setter) setter.call(control, true);
    else control.checked = true;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function bestScored(controls, scorer, minimum) {
    return controls
      .map((control) => ({ control, score: scorer(control) }))
      .filter((entry) => entry.score >= minimum)
      .sort((a, b) => b.score - a.score)[0]?.control || null;
  }

  function scoreRfd(control) {
    const context = controlContext(control);
    let score = 0;
    if (/\brfd\b/.test(context)) score += 12;
    if (/reason for (the )?decision/.test(context)) score += 11;
    if (/judge.{0,20}comment|ballot.{0,20}comment/.test(context)) score += 6;
    if (/comment|feedback/.test(context)) score += 2;
    if (/speaker|competitor|individual|oral/.test(context)) score -= 8;
    return score;
  }

  function fillRfd(payload, report, usedTextFields) {
    const candidates = Array.from(document.querySelectorAll("textarea, [contenteditable='true']")).filter(isEditable);
    const field = bestScored(candidates, scoreRfd, 4);
    if (!field) {
      report.review.push("Reason for decision: no visible RFD/comments field was matched.");
      return;
    }
    setControlValue(field, payload.ballot.rfd);
    usedTextFields.add(field);
    report.filled.push("Reason for decision");
  }

  function scoreChoiceControl(control, kind) {
    const context = controlContext(control);
    if (kind === "winner") {
      return (/\bwinner\b|winning (team|entry|competitor)/.test(context) ? 12 : 0)
        + (/decision|vote/.test(context) ? 3 : 0)
        - (/side/.test(context) ? 4 : 0);
    }
    return (/winning side|\bside\b/.test(context) ? 10 : 0)
      + (/winner|decision/.test(context) ? 2 : 0);
  }

  function optionScore(text, values) {
    const normalized = normalize(text);
    let best = 0;
    values.filter(Boolean).forEach((value) => {
      const candidate = normalize(value);
      if (!candidate) return;
      if (normalized === candidate) best = Math.max(best, 20);
      else if (candidate.length >= 3 && (normalized.includes(candidate) || candidate.includes(normalized))) best = Math.max(best, 12);
      const tokens = candidate.split(" ").filter((token) => token.length >= 3);
      const overlap = tokens.filter((token) => normalized.includes(token)).length;
      best = Math.max(best, overlap * 3);
    });
    return best;
  }

  function fillChoice(kind, values, label, report) {
    const selects = Array.from(document.querySelectorAll("select")).filter(isEditable);
    const select = bestScored(selects, (control) => scoreChoiceControl(control, kind), 7);
    if (select instanceof HTMLSelectElement) {
      const match = Array.from(select.options)
        .map((option) => ({ option, score: optionScore(option.textContent, values) }))
        .sort((a, b) => b.score - a.score)[0];
      if (match && match.score >= 3) {
        setControlValue(select, match.option.value);
        report.filled.push(label);
        return;
      }
    }

    const radios = Array.from(document.querySelectorAll("input[type='radio']")).filter(isEditable);
    const groups = new Map();
    radios.forEach((radio) => {
      const key = radio.name || `__${radios.indexOf(radio)}`;
      groups.set(key, [...(groups.get(key) || []), radio]);
    });
    const group = Array.from(groups.values())
      .map((items) => ({ items, score: Math.max(...items.map((item) => scoreChoiceControl(item, kind))) }))
      .filter((entry) => entry.score >= 7)
      .sort((a, b) => b.score - a.score)[0]?.items;
    if (group) {
      const match = group
        .map((radio) => ({ radio, score: optionScore(controlContext(radio), values) }))
        .sort((a, b) => b.score - a.score)[0];
      if (match && match.score >= 3) {
        setChecked(match.radio);
        report.filled.push(label);
        return;
      }
    }
    report.review.push(`${label}: choose this manually because no confident option match was found.`);
  }

  function pointCandidates() {
    return Array.from(document.querySelectorAll("input[type='number'], input[type='text'], input:not([type])"))
      .filter(isEditable)
      .filter((control) => /speaker.{0,20}point|\bpoints?\b|speaker.{0,20}score/.test(controlContext(control)))
      .filter((control) => !/winner|side|rank|search|email|password/.test(controlContext(control)));
  }

  function pointMatchScore(control, point) {
    const context = controlContext(control);
    const speaker = normalize(point.speaker);
    const team = normalize(point.team);
    let score = 0;
    if (speaker && context.includes(speaker)) score += 12;
    speaker.split(" ").filter((token) => token.length >= 3).forEach((token) => {
      if (context.includes(token)) score += 2;
    });
    if (team && context.includes(team)) score += 3;
    if (context.includes(normalize(point.role))) score += 1;
    return score;
  }

  function fillPoints(payload, report) {
    const candidates = pointCandidates();
    const unused = new Set(candidates);
    const assignments = [];

    payload.points.forEach((point) => {
      const match = Array.from(unused)
        .map((control) => ({ control, score: pointMatchScore(control, point) }))
        .sort((a, b) => b.score - a.score)[0];
      if (match && match.score >= 3) {
        assignments.push({ control: match.control, point });
        unused.delete(match.control);
      }
    });

    const assignedByOrder = assignments.length === 0 && candidates.length === payload.points.length && payload.points.length > 0;
    if (assignedByOrder) {
      candidates.forEach((control, index) => assignments.push({ control, point: payload.points[index] }));
    }

    assignments.forEach(({ control, point }) => setControlValue(control, Number(point.value).toFixed(1)));
    if (assignments.length) report.filled.push(`Speaker points (${assignments.length}/${payload.points.length})`);
    if (assignedByOrder) {
      report.review.push("Speaker points: fields were assigned by page order because speaker names could not be matched. Verify each value.");
    } else if (assignments.length !== payload.points.length) {
      report.review.push(`Speaker points: ${payload.points.length - assignments.length} field${payload.points.length - assignments.length === 1 ? "" : "s"} still need manual matching.`);
    }
  }

  function feedbackText(feedback) {
    return `Strength: ${feedback.strengths}\n\nImprovement: ${feedback.improvements}`;
  }

  function fillFeedback(payload, report, usedTextFields) {
    const candidates = Array.from(document.querySelectorAll("textarea, [contenteditable='true']"))
      .filter(isEditable)
      .filter((field) => !usedTextFields.has(field))
      .filter((field) => /comment|feedback|speaker|competitor|individual/.test(controlContext(field)));
    const unused = new Set(candidates);
    const assignments = [];

    payload.ballot.feedback.forEach((feedback) => {
      const speaker = normalize(feedback.speaker);
      const match = Array.from(unused)
        .map((field) => {
          const context = controlContext(field);
          let score = speaker && context.includes(speaker) ? 12 : 0;
          speaker.split(" ").filter((token) => token.length >= 3).forEach((token) => {
            if (context.includes(token)) score += 2;
          });
          return { field, score };
        })
        .sort((a, b) => b.score - a.score)[0];
      if (match && match.score >= 3) {
        assignments.push({ field: match.field, feedback });
        unused.delete(match.field);
      }
    });

    const assignedByOrder = assignments.length === 0 && candidates.length === payload.ballot.feedback.length && payload.ballot.feedback.length > 0;
    if (assignedByOrder) {
      candidates.forEach((field, index) => assignments.push({ field, feedback: payload.ballot.feedback[index] }));
    }

    assignments.forEach(({ field, feedback }) => setControlValue(field, feedbackText(feedback)));
    if (assignments.length) report.filled.push(`Speaker feedback (${assignments.length}/${payload.ballot.feedback.length})`);
    if (assignedByOrder) {
      report.review.push("Speaker feedback: comments were assigned by page order because speaker names could not be matched. Verify each comment.");
    } else if (assignments.length !== payload.ballot.feedback.length) {
      report.review.push(`Speaker feedback: ${payload.ballot.feedback.length - assignments.length} comment field${payload.ballot.feedback.length - assignments.length === 1 ? "" : "s"} still need manual matching.`);
    }
  }

  function autofill(payload) {
    const report = { filled: [], review: [] };
    const usedTextFields = new Set();
    fillRfd(payload, report, usedTextFields);
    fillChoice("winner", [payload.decision.winnerLabel, payload.decision.winnerRole], "Winner", report);
    fillChoice("side", [payload.decision.winnerRole], "Winning side", report);
    fillPoints(payload, report);
    fillFeedback(payload, report, usedTextFields);
    return report;
  }

  function hasBallotFields() {
    return pointCandidates().length > 0
      || Array.from(document.querySelectorAll("textarea, select")).some((control) => isEditable(control) && /winner|points?|rfd|reason for decision|ballot comment/.test(controlContext(control)));
  }

  function panelMarkup() {
    return `
      <style>
        :host { all: initial; }
        .panel { width: 330px; box-sizing: border-box; padding: 18px; border: 1px solid #cfc8ba; border-radius: 9px; color: #173140; background: #f8f5ed; box-shadow: 0 18px 55px rgba(23,49,64,.26); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        .eyebrow { color: #b94f2c; font-size: 9px; font-weight: 900; letter-spacing: .12em; }
        h2 { margin: 6px 0 5px; font: 600 22px/1.08 Georgia, serif; }
        .meta { margin: 0 0 13px; color: #60717a; font-size: 10px; line-height: 1.45; }
        .winner { padding: 10px 11px; border-left: 3px solid #b94f2c; background: white; }
        .winner small, .winner strong { display: block; }
        .winner small { color: #6d7b82; font-size: 8px; font-weight: 850; letter-spacing: .08em; }
        .winner strong { margin-top: 3px; font: 600 16px/1.2 Georgia, serif; }
        .notice { margin: 11px 0; padding: 9px 10px; border-radius: 5px; color: #5f6e75; background: #ece8de; font-size: 9px; line-height: 1.45; }
        button { width: 100%; min-height: 39px; border: 1px solid #173140; border-radius: 5px; color: white; background: #173140; font-size: 10px; font-weight: 850; cursor: pointer; }
        button.secondary { margin-top: 7px; color: #173140; background: transparent; }
        button:disabled { cursor: not-allowed; opacity: .5; }
        .report { margin-top: 12px; padding-top: 12px; border-top: 1px solid #d7d1c5; }
        .report[hidden] { display: none; }
        .report strong { display: block; margin-bottom: 5px; font-size: 9px; }
        ul { margin: 0; padding-left: 17px; }
        li { margin: 4px 0; color: #5d6b72; font-size: 9px; line-height: 1.35; }
        .warning { margin: 11px 0 0; color: #9a3f25; font-size: 9px; font-weight: 750; line-height: 1.4; }
      </style>
      <section class="panel" aria-label="JudgeFlow Tabroom Companion">
        <span class="eyebrow">JUDGEFLOW COMPANION</span>
        <h2>Ballot ready</h2>
        <p class="meta" data-meta></p>
        <div class="winner"><small>JUDGEFLOW WINNER</small><strong data-winner></strong></div>
        <p class="notice" data-notice></p>
        <button type="button" data-fill>Autofill visible fields</button>
        <button type="button" class="secondary" data-clear>Clear saved ballot</button>
        <div class="report" data-report hidden>
          <strong data-filled-title></strong>
          <ul data-filled></ul>
          <strong data-review-title></strong>
          <ul data-review></ul>
        </div>
        <p class="warning">Review every value. JudgeFlow will never submit or confirm this ballot.</p>
      </section>`;
  }

  function renderPanel(payload) {
    currentPayload = payload;
    const existing = document.getElementById(PANEL_ID);
    if (!payload) {
      existing?.remove();
      return;
    }
    const host = existing || document.createElement("div");
    if (!existing) {
      host.id = PANEL_ID;
      Object.assign(host.style, { position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647" });
      host.attachShadow({ mode: "open" });
      document.documentElement.appendChild(host);
    }
    const root = host.shadowRoot;
    root.innerHTML = panelMarkup();
    root.querySelector("[data-meta]").textContent = `${payload.round.event} · ${payload.round.tournament || "Tournament"} · ${payload.points.length} speaker point${payload.points.length === 1 ? "" : "s"}`;
    root.querySelector("[data-winner]").textContent = `${payload.decision.winnerLabel} (${payload.decision.winnerRole})`;
    const ballotVisible = hasBallotFields();
    root.querySelector("[data-notice]").textContent = ballotVisible
      ? "A possible ballot form is visible. Autofill will change fields but will not submit them."
      : "Log in and open your assigned online ballot. This panel will follow you to the ballot page.";
    root.querySelector("[data-fill]").disabled = !ballotVisible;
    root.querySelector("[data-fill]").addEventListener("click", () => {
      const report = autofill(currentPayload);
      const reportElement = root.querySelector("[data-report]");
      reportElement.hidden = false;
      root.querySelector("[data-filled-title]").textContent = report.filled.length ? "Filled" : "No fields were filled";
      root.querySelector("[data-review-title]").textContent = report.review.length ? "Check manually" : "All detected fields were filled";
      const filledList = root.querySelector("[data-filled]");
      const reviewList = root.querySelector("[data-review]");
      filledList.replaceChildren(...report.filled.map((item) => Object.assign(document.createElement("li"), { textContent: item })));
      reviewList.replaceChildren(...report.review.map((item) => Object.assign(document.createElement("li"), { textContent: item })));
    });
    root.querySelector("[data-clear]").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "JUDGEFLOW_CLEAR_PENDING_BALLOT" }, () => renderPanel(null));
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "JUDGEFLOW_BALLOT_UPDATED") renderPanel(message.payload || null);
  });

  chrome.runtime.sendMessage({ type: "JUDGEFLOW_GET_PENDING_BALLOT" }, (response) => {
    if (response?.payload) renderPanel(response.payload);
  });
})();
