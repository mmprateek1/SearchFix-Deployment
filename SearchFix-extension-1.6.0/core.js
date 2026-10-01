import { BACKEND_ORIGIN } from "./deployment.js";
export const DOCUMENT_TYPES = ["SEARCH_PACKAGE", "DEED", "DOT", "TAX", "PA", "LEGAL_DESCRIPTION", "MAP", "LIEN", "PACER", "PATRIOT", "TYPED_REPORT", "COST_WORKSHEET", "THR", "INDEX", "ATTORNEY_OPINION", "VENDOR_INSTRUCTIONS", "HOA_DOCUMENT", "MAILING_LIST", "PROPERTY_REPORT", "UPDATE_REPORT", "LIEN_REGISTRY", "COURT_SEARCH", "PROBATE", "SURVEY", "TORRENS", "COVER_SHEET", "CHECKLIST", "SUNBIZ", "ASSIGNMENT"];

export const DEFAULT_SETTINGS = {
  backend: BACKEND_ORIGIN,
  order: "[id$='_lblServiceProviderOrderNumber'], [data-order-number]",
  comments: "[id$='_OrderCommentControl1_dgComments'], [data-searchfix-comments], #comments, #order-comments",
  commentRow: "[data-comment], tbody tr",
  author: "[data-author], .comment-author",
  date: "[data-date], .comment-date",
  time: "[data-time], .comment-time",
  text: "[data-comment-text], .comment-text",
  attachments: "[data-attachments], #attachments",
  taRead: "[data-typing-assistant], #typing-assistant"
};

export function backendURL(value, configuredOrigin = BACKEND_ORIGIN) {
  const url = new URL(value);
  const local = ["http://localhost:3000", "http://127.0.0.1:3000"];
  const allowed = local.includes(configuredOrigin) ? local : [configuredOrigin];
  if (!allowed.includes(url.origin) || (!local.includes(url.origin) && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The analysis service must match the address packaged with this extension and use HTTPS when hosted.");
  }
  return url.origin;
}

export function guessDocumentType(name) {
  const words = name.toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  const rules = [
    [/\b(ATTORNEY(?: S)?(?: TITLE)? OPINION|AO|ATO)\b/, "ATTORNEY_OPINION"],
    [/\b(VENDOR ?MANAGEMENT|VENDOR INSTRUCTIONS|VM|ORIGINAL ?REQUEST|SPECIAL REQUIREMENTS)\b/, "VENDOR_INSTRUCTIONS"],
    [/\b(HOA|HOMEOWNERS? ASSOCIATION)\b/, "HOA_DOCUMENT"],
    [/\bMAILING LIST\b/, "MAILING_LIST"],
    [/\bPROPERTY (?:VIEW )?REPORT\b/, "PROPERTY_REPORT"],
    [/\bUPDATE REPORT\b/, "UPDATE_REPORT"],
    [/\bLIEN REGISTR[YI]\b/, "LIEN_REGISTRY"],
    [/\b(PROTHO|COURT SEARCH|JUDGMENT SEARCH|JUDGEMENT SEARCH)\b/, "COURT_SEARCH"],
    [/\b(PROBATE|SURROGATE|ESTATE SEARCH)\b/, "PROBATE"],
    [/\bSURVEY\b/, "SURVEY"], [/\bTORRENS\b/, "TORRENS"],
    [/\b(COVER ?SHEET|RUN ?SHEET)\b/, "COVER_SHEET"],
    [/\bCHECK ?LIST\b/, "CHECKLIST"], [/\bSUNBIZ\b/, "SUNBIZ"],
    [/\bASSIGNMENT\b/, "ASSIGNMENT"],
    [/\b(TYPED|REPORT TYPED|TYPING|TA)\b/, "TYPED_REPORT"],
    [/\b(PACER|BANKRUPTCY)\b/, "PACER"], [/\bPATRIOT\b/, "PATRIOT"],
    [/\b(THR|TRANSACTION HISTORY)\b/, "THR"], [/\b(DEED OF TRUST|DOT|MORTGAGE)\b/, "DOT"],
    [/\bDEED\b/, "DEED"], [/\bTAX\b/, "TAX"], [/\b(PA|PASANP|PASNAP|PASNAPSHOT|PROPERTY ASSESSMENT)\b/, "PA"],
    [/\bLEGAL\b/, "LEGAL_DESCRIPTION"], [/\b(MAP|PLAT)\b/, "MAP"],
    [/\bLIEN\b/, "LIEN"], [/\bCOST\b/, "COST_WORKSHEET"],
    [/\b(SEARCH INDEX|SEARCH INDEXES|INDEX|INDEXES)\b/, "INDEX"],
    [/\bSEARCH PACKAGE\b/, "SEARCH_PACKAGE"]
  ];
  return rules.find(([pattern]) => pattern.test(words))?.[1] || "";
}

export function requiredTypes(result) {
  return [...new Set((result.issues || []).flatMap(issue => (issue.requiredFiles || []).map(file => file.fileType)))];
}

export function validateOrder(order) {
  if (!order.orderNumber?.trim()) throw new Error("Order number was not found. Set its page selector or enter it below.");
  if (!Array.isArray(order.comments) || !order.comments.length) throw new Error("No comments found. Open Order Overview and expand comments, or configure the comment selectors.");
  if (order.comments.some(c => !c.text?.trim() || !c.author?.trim())) throw new Error("Every comment needs text and an author. Correct the page selectors before analysis.");
  if (order.comments.some(c => !/^\d{4}-\d{2}-\d{2}$/.test(c.date || "") || !/^\d{2}:\d{2}(:\d{2})?$/.test(c.time || ""))) {
    throw new Error("Comment dates and times are incomplete or ambiguous. The backend needs YYYY-MM-DD and 24-hour times to select the latest comment correctly.");
  }
  return { orderNumber: order.orderNumber.trim(), comments: order.comments };
}

export function buildAssistantText(result) {
  const lines = [`SearchFix review — ${result.orderNumber}`, ""];
  const decision = result.overallDecision || result.status;
  if (decision) lines.push(`Status: ${decision.replaceAll("_", " ")}`, "");
  if (result.reason) lines.push(result.reason, "");
  const selected = result.commentAnalysis?.selectedComment;
  if (selected) lines.push(`Comment reviewed (${selected.author || "Unknown"}):`, selected.text, "");
  if (result.commentAnalysis?.selectionReason) lines.push(`Why AI chose it: ${result.commentAnalysis.selectionReason}`, `Author interpretation: ${result.commentAnalysis.roleReason || selected?.role || "Unknown"}`, "");
  if (result.decisionBasis === "CLIENT_TASK") lines.push("Client task acknowledged for human action; no document error has been established.", "");
  if (decision === "IGNORED") {
    lines.push("Order ignored. No supporting documents were analyzed; select another order when ready.");
  } else {
    for (const [index, issue] of (result.issues || []).entries()) {
      lines.push(`${index + 1}. What the client needs: ${issue.claim || issue.clientClaim}`);
      if (issue.nextSteps?.length) lines.push("Next steps:", ...issue.nextSteps.map(step=>`- ${step}`));
      if (issue.category) lines.push(`Category: ${issue.category}`);
      if (issue.decision) lines.push(`Assessment: ${issue.decision.replaceAll("_", " ")}`, issue.reason || "");
      if (issue.requiredFiles?.length) lines.push(`Files to check: ${issue.requiredFiles.map(f => f.fileType.replaceAll("_", " ")).join(", ")}`);
      for (const evidence of issue.evidence || []) {
        lines.push(`Evidence — ${evidence.document}${evidence.page ? `, page ${evidence.page}` : " (page not identified)"}: ${evidence.finding}`);
        if (evidence.quotedText) lines.push(`Quote: ${evidence.quotedText}`);
      }
      lines.push("");
    }
    if (result.status === "AWAITING_DOCUMENTS") lines.push("Next step: review the relevant attachments below. The client's request has not yet been verified against documents.");
    else lines.push("Next step: check the cited evidence and any REVIEW REQUIRED items before deciding what to tell the client.");
  }
  for (const document of result.documents || []) lines.push(`Document: ${document.name} — ${document.status.replaceAll("_", " ")}`);
  if (result.nextSteps?.length) lines.push("", "Next steps:", ...result.nextSteps.map(step=>`- ${step}`));
  lines.push("", "Review notes only. No order fields, files, comments, or website Typing Assistant content have been changed.");
  return lines.join("\n");
}
