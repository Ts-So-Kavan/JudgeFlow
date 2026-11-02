# JudgeFlow Tabroom Companion

This Manifest V3 Chrome extension transfers a reviewed JudgeFlow ballot to the judge's currently logged-in Tabroom session. It fills fields it can match confidently and never submits or confirms a ballot.

## Install the local prototype

1. Open JudgeFlow in Google Chrome.
2. Visit `chrome://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select this `extension` directory.
6. Reload JudgeFlow. The final ballot page should show **Companion connected**.

## Use it

1. Finish and review the ballot in JudgeFlow.
2. Select **Send to Tabroom**.
3. Log in to Tabroom normally if needed, then open the assigned ballot.
4. In the JudgeFlow panel on Tabroom, select **Autofill visible fields**.
5. Review every field and resolve anything the panel flags.
6. Submit and confirm in Tabroom yourself.

## Privacy and safety

- Tabroom credentials never enter JudgeFlow or the extension.
- The ballot packet is stored only in `chrome.storage.session`, which is cleared when Chrome exits or when the judge selects **Clear saved ballot**.
- The extension requests access only to local JudgeFlow pages and `https://www.tabroom.com/*`.
- The extension contains no code that clicks, submits, or confirms a Tabroom ballot.

Tabroom does not provide a supported ballot-submission API. This prototype fills the existing form in the browser and may require updates when Tabroom changes its markup.
