import { z } from "zod";
import { ISSUE_TYPES } from "../config/issueTypes.js";
import { DOCUMENT_TYPES } from "../config/documentMappings.js";

const CommentAnalysisSchema = z.object({
    selectedComment:z.object({id:z.string().optional(),author:z.string().optional(),date:z.string().optional(),time:z.string().optional(),text:z.string(),role:z.enum(['INTERNAL','CLIENT','SYSTEM','UNKNOWN'])}).nullable(),
    contextCommentsUsed:z.array(z.object({id:z.string().optional(),date:z.string().optional(),time:z.string().optional(),author:z.string().optional(),text:z.string().optional(),purpose:z.string().optional()})),
    selectionReason:z.string().optional(),roleReason:z.string().optional(),totalComments:z.number().optional(),consideredComments:z.number().optional()
});
const DocumentProgressSchema=z.object({name:z.string(),type:z.string(),status:z.enum(['ANALYZED','UNVERIFIED'])});

export const RequiredFileItemSchema = z.object({
    fileType: z.enum(DOCUMENT_TYPES),
    reason: z.string()
});

export const Step1IssueSchema = z.object({
    category: z.string().optional(),
    issueType: z.enum(ISSUE_TYPES),
    claim: z.string(),
    decision: z.literal('DISPUTED').optional(),
    reason: z.string().optional(),
    requiredFiles: z.array(RequiredFileItemSchema)
});

/**
 * Zod Schema for Step 1 Response Payload:
 * Returned to Chrome Extension so it knows which specific files to download.
 */
export const SearchFixStep1ResultSchema = z.object({
    nextSteps: z.array(z.string()).optional(),
    decisionBasis:z.literal("CLIENT_TASK").optional(),
    documents:z.array(DocumentProgressSchema).optional(),
    analysisId: z.string(),
    orderNumber: z.string(),
    commentAnalysis: CommentAnalysisSchema,
    issues: z.array(Step1IssueSchema),
    status: z.enum(["AWAITING_DOCUMENTS", "IGNORED", "ACCEPTED", "DISPUTED", "REVIEW_REQUIRED"]),
    overallDecision: z.enum(["IGNORED", "ACCEPTED", "DISPUTED", "REVIEW_REQUIRED"]).optional(),
    reason: z.string().optional()
});

export const EvidenceItemSchema = z.object({
    document: z.string(),
    page: z.number().nullable().optional(),
    field: z.string().optional(),
    value: z.string().optional(),
    finding: z.string(),
    quotedText: z.string().optional(),
    confidence: z.number().optional()
});

export const Step2IssueDecisionSchema = z.object({
    category: z.string().optional(),
    issueType: z.enum(ISSUE_TYPES),
    clientClaim: z.string(),
    requiredDocuments: z.array(z.enum(DOCUMENT_TYPES)),
    evidence: z.array(EvidenceItemSchema),
    decision: z.enum(["ACCEPTED", "DISPUTED", "REVIEW_REQUIRED"]),
    reason: z.string(),
    nextSteps: z.array(z.string()).optional()
});

/**
 * Zod Schema for Step 2 Response Payload:
 * Returned to Chrome Extension after PDF evidence analysis.
 */
export const SearchFixStep2ResultSchema = z.object({
    nextSteps: z.array(z.string()).optional(),
    decisionBasis:z.literal("CLIENT_TASK").optional(),
    documents:z.array(DocumentProgressSchema).optional(),
    analysisId: z.string().optional(),
    orderNumber: z.string(),
    commentAnalysis: CommentAnalysisSchema,
    issues: z.array(Step2IssueDecisionSchema),
    overallDecision: z.enum(["ACCEPTED", "DISPUTED", "REVIEW_REQUIRED", "IGNORED"]),
    status: z.enum(["ACCEPTED", "DISPUTED", "REVIEW_REQUIRED", "IGNORED"]).optional(),
    reason: z.string().optional()
});
