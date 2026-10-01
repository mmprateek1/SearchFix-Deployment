# SearchFix 1.6.0

Read-only SearchFix review: Chrome reads the signed-in DataTrace pages and sends current comments and selected evidence to the configured analysis service. It never posts comments, edits orders, claims tasks or saves Typing Assistant changes.

## Use

1. Load or reload the extension folder in chrome://extensions.
2. Open the DataTrace task queue and click **Scan the page**.
3. Save your key with **Add Gemini API key**. Saving makes no Gemini test request. The key lasts for this browser session; there is no environment-key fallback.
4. Click an order number to open its Overview in the same original browser tab.
5. Click **Start analysis** beside the chosen order. Only that order runs. Keep the panel open.
6. Expand **Chosen comment** to see the original text, AI selection explanation and author interpretation. Read findings, document names and recommended next steps below it.

## Analysis

All visible Overview comments are sent to the backend. The backend sorts them chronologically and sends only the latest 15 to AI. AI chooses the relevant comment and interprets the author: ADS generally indicates internal and Outsource generally indicates client. Mixed names are decided from context by AI; code does not choose a comment using names or keywords.

- AI-selected internal comment: **Ignored**, with no document analysis.
- Client operational task (fee approval, rush ETA, abstractor follow-up, new work): **Accepted**, with a next action and no document analysis. This acknowledges a task; it does not establish a past error.
- Alleged discrepancy: mapped evidence is requested and reviewed. **Accepted** means current evidence supports the complaint; **Disputed** means it contradicts it.
- Unclear selection, unsupported issue, missing or inconclusive evidence, failed download or model failure: **Review required**.

The chosen comment appears before document collection. Document progress distinguishes Found, Downloaded, Sent for analysis, Analyzed, Could not verify and Download failed. Analyzed means the model returned evidence attributed to that supplied source, not that every assertion in the file was independently verified.

No historical workbook, PDF or JSON reference library is used or bundled. Prompts contain general document-role guidance learned from the supplied examples, without sample names, order facts or outcomes. Current-order PDFs remain the evidence. Source text is untrusted data, never instructions.

## Existing boundaries

PDFs are fetched from the matched order's Attachments view using the current browser session; no PDF-toolbar selector or Ctrl+S is needed. Typing Assistant is read as text. Filename prefixes and attachment row order may vary. Limits remain six PDFs, 20 MB each and 40 MB total. All comments are already visible on Overview; there is no automatic pagination. Required document mappings remain in src/config/documentMappings.js; a missing mapped type requires review even when another package might contain related material. The analyst should verify that situation manually.

Results stay in panel memory. Saved backend analysis sessions expire after 30 minutes or restart; the document stage reuses the chosen comment and rejects changed order/comment context. Key saving, model fallbacks, rate limits and website access behavior are otherwise unchanged.

Active comment models: gemini-3.5-flash-lite then gemini-3.1-flash-lite. Active document and decision models: gemini-3.5-flash then gemini-3.5-flash-lite then gemini-3.1-flash-lite. See RATE_LIMITS.md for budget behavior. Model availability still depends on the supplied account.

## Run and verify

The extension currently targets https://searchfix-deployment.onrender.com. Local changes do not update Render automatically. Backend and extension must both use this release to receive the new behavior. See SETUP_AND_UPDATES.md and LOCAL_TESTING.md. Automated tests and the preview use synthetic model responses and establish software behavior, not live AI accuracy.
