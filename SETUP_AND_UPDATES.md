# Install and update SearchFix 1.6.0

The current extension targets https://searchfix-deployment.onrender.com. For another PC, extract SearchFix-extension.zip to a permanent folder, open chrome://extensions, enable Developer mode and Load unpacked from the folder containing manifest.json. Enter that user's Gemini key after scanning. A hosted backend means no local Node.js service is needed on that PC.

This release changes both backend and extension. Local edits and rebuilt ZIPs are not a deployment. Update the hosted backend code and verify /health reports 1.6.0 before using the new extension. Deployment is a separate step; do not assume the existing Render service already contains these changes.

For an extension update, finish the current analysis, close its panel, replace the extracted files with the new extension ZIP, and click Reload in chrome://extensions. Enter the key again. Unpacked extensions do not automatically update from a ZIP.

SearchFix-local-setup.zip and SearchFix-setup.zip include current application source and synthetic tests for development. They retain the hosted extension configuration; see LOCAL_TESTING.md to switch explicitly to localhost. Install dependencies with npm ci. No keys, .env, historical reference records, uploaded PDFs or runtime quota counters are distributed.

Preserve data/runtime/gemini-usage.json when updating a backend. It holds quota counters, not historical decision examples. Keep config/gemini-rate-limits.json and other application configuration. Independent backend installations do not share counters.
