import { geminiService } from "./gemini.service.js";
import { getDecisionSystemPrompt, getDecisionUserPrompt } from "../prompts/decision.prompt.js";
import { trace } from './trace.service.js';

export class DecisionEngine {
    /**
     * Evaluates a decision (ACCEPTED, DISPUTED, or REVIEW_REQUIRED) for an issue based on claim and evidence.
     * 
     * @param {object} issue { issueType, claim, requiredDocuments }
     * @param {Array<object>} evidence List of extracted evidence items
     * @returns {Promise<{decision: "ACCEPTED" | "DISPUTED" | "REVIEW_REQUIRED", reason: string}>} Issue decision
     */
    async evaluateIssueDecision(issue, evidence = []) {
        // Rule: If no evidence is available (e.g. required documents were not supplied), return REVIEW_REQUIRED
        if (!Array.isArray(evidence) || evidence.length === 0) {
            return {
                decision: "REVIEW_REQUIRED",
                reason: `Required supporting document(s) [${issue.requiredDocuments.join(", ")}] were not provided for analysis.`, nextSteps:["Obtain readable supporting evidence and review the claim again."]
            };
        }
        if (evidence.some(item => item.field === "documentAnalysisStatus" && item.value === "Processing Error")) {
            return { decision: "REVIEW_REQUIRED", reason: "The supplied evidence could not be processed. Retry or review the source documents manually; no claim has been verified.", nextSteps:["Retry document analysis or review the source documents manually."] };
        }

        const systemPrompt = getDecisionSystemPrompt();
        const userPrompt = getDecisionUserPrompt(issue.issueType, issue.claim, issue.requiredDocuments, evidence);

        try {
            const rawResponse = await geminiService.generateJSON(systemPrompt, userPrompt, "documents");
            const parsed = typeof rawResponse === "string" ? JSON.parse(rawResponse) : rawResponse;

            const decision = ["ACCEPTED", "DISPUTED", "REVIEW_REQUIRED"].includes(parsed.decision)
                ? parsed.decision
                : "REVIEW_REQUIRED";

            const reason = (parsed.reason || "Decision based on document evidence evaluation.").trim();

            return {
                decision,
                reason,
                nextSteps: Array.isArray(parsed.nextSteps) && parsed.nextSteps.some(s=>typeof s === "string" && s.trim()) ? parsed.nextSteps.filter(s=>typeof s === "string" && s.trim()) : ["Review the cited evidence with the search team before taking action."]
            };
        } catch (error) {
            trace('decision.failed',{issueType:issue.issueType,code:error.code || 'DECISION_ERROR'});
            return {
                decision: "REVIEW_REQUIRED",
                reason: "Error occurred during claim vs evidence decision evaluation.", nextSteps:["Retry the evidence comparison before resolving this claim."]
            };
        }
    }

    /**
     * Computes the overall SearchFix order decision from individual issue decisions.
     * Rule: If any issue is ACCEPTED -> overall ACCEPTED.
     *       Else if any issue is REVIEW_REQUIRED -> overall REVIEW_REQUIRED.
     *       Else -> DISPUTED.
     * 
     * @param {Array<{decision: string}>} issueResults List of issue decision objects
     * @returns {"ACCEPTED" | "DISPUTED" | "REVIEW_REQUIRED"} Overall decision
     */
    calculateOverallDecision(issueResults) {
        if (!Array.isArray(issueResults) || issueResults.length === 0) {
            return "REVIEW_REQUIRED";
        }

        const decisions = issueResults.map(i => i.decision);

        if (decisions.includes("ACCEPTED")) {
            return "ACCEPTED";
        }

        if (decisions.includes("REVIEW_REQUIRED")) {
            return "REVIEW_REQUIRED";
        }

        return "DISPUTED";
    }
}

export const decisionEngine = new DecisionEngine();
