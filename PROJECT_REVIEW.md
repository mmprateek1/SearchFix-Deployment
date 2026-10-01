# SearchFix 1.6.0 implementation

The per-order interface replaces batch start. Clicking an order number reuses the source tab; starting analysis uses the existing isolated reading flow and processes only that task. Other row results remain visible.

The backend receives all comments and prepares the latest 15 chronologically. AI returns a supplied comment ID, role and explanation; the service validates that contract and displays the original text. No keyword or author-based code chooses the comment. Ambiguous ADS/Outsource authors are interpreted by AI. Unknown selections require review.

AI-selected internal comments finish Ignored. Client operational tasks finish Accepted with a proposed action, without documents. Discrepancy claims use the existing issue/document mappings and current evidence. Document output includes filenames and recommended next steps. Failed processing preserves the chosen comment and never labels failed files analyzed.

Historical reference records, import scripts and reference-driven prompts/tests have been removed. General document knowledge is shared by selection, extraction and decision prompts. Real sample facts and outcomes are not embedded. Configuration JSON and quota counters remain necessary runtime state.

Validation uses synthetic comments and mocked Gemini. Tests cover chronological windows, AI-selected IDs/roles, operational routing, missing/failed evidence, authenticated PDF bytes, key isolation, saved analysis context and existing fallback/quota protection. The local browser preview covers per-order buttons and all status paths. Live AI accuracy and the hosted service are not established by those tests.

Existing read-only behavior, file limits, model chains and quota policies are preserved. No deployment or Git push is included in this implementation.
