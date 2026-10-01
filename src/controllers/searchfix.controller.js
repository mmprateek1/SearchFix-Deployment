import fs from "fs";
import { issueClassificationService } from "../services/issueClassification.service.js";
import { documentSelectionService } from "../services/documentSelection.service.js";
import { documentAnalysisService } from "../services/documentAnalysis.service.js";
import { evidenceService } from "../services/evidence.service.js";
import { decisionEngine } from "../services/decision.service.js";
import { SearchFixStep1ResultSchema, SearchFixStep2ResultSchema } from "../schemas/result.schema.js";
import { OrderInputSchema } from "../schemas/comment.schema.js";
import { DOCUMENT_TYPES } from "../config/documentMappings.js";
import { saveAnalysis, loadAnalysis } from "../services/analysisSession.service.js";
import { trace } from '../services/trace.service.js';


// The model selects a comment from the recent window before any document routing.
async function routeComments(comments) {
    const route = await issueClassificationService.analyzeComments(comments);
    if (route.terminal) return route;
    return {...route,issues:documentSelectionService.selectRequiredDocuments(route.issues)};
}
function terminalPayload(route, orderNumber, analysisId) {
    return {analysisId,orderNumber,commentAnalysis:route.commentAnalysis,issues:[],documents:[],
        status:route.terminal,overallDecision:route.terminal,reason:route.reason,
        nextSteps:route.nextSteps || [],decisionBasis:route.decisionBasis};
}

export async function analyzeCommentsController(req, res) {
    try {
        const { orderNumber, comments } = req.body || {};

        if (!orderNumber || typeof orderNumber !== "string" || orderNumber.trim() === "") {
            return res.status(400).json({ error: "orderNumber is required and must be a non-empty string." });
        }

        if (!comments || !Array.isArray(comments) || comments.length === 0) {
            return res.status(400).json({ error: "comments array must contain at least one comment." });
        }

        const cleanOrderNumber = orderNumber.trim();
        if (!OrderInputSchema.safeParse({orderNumber: cleanOrderNumber, comments}).success) {
            return res.status(400).json({error: "Each comment must contain non-empty text and valid string metadata."});
        }
        console.log(`[SearchFix Step 1] Analyzing comments for Order ${cleanOrderNumber} (${comments.length} comments)`);

        const route = await routeComments(comments);
        trace('comments.routed',{status:route.terminal || 'AWAITING_DOCUMENTS',required:[...new Set((route.issues || []).flatMap(issue=>issue.requiredDocuments))]});
        const analysisId = saveAnalysis(cleanOrderNumber, comments, route);
        if (route.terminal) return res.status(200).json(SearchFixStep1ResultSchema.parse(terminalPayload(route, cleanOrderNumber, analysisId)));
        const issuesWithDocs = route.issues;

        const formattedIssues = issuesWithDocs.map(issue => ({
            issueType: issue.issueType,
            category: issue.category,
            claim: issue.claim,
            decision: issue.decision,
            reason: issue.reason,
            requiredFiles: issue.requiredDocuments.map(docType => ({
                fileType: docType,
                reason: `Required to investigate ${issue.issueType.toLowerCase().replace(/_/g, " ")} claim.`
            }))
        }));

        const step1Payload = {
            analysisId,
            orderNumber: cleanOrderNumber,
            commentAnalysis: route.commentAnalysis,
            nextSteps: route.nextSteps || [],
            issues: formattedIssues,
            status: "AWAITING_DOCUMENTS"
        };

        const validatedResult = SearchFixStep1ResultSchema.parse(step1Payload);

        console.log(`[SearchFix Step 1] Complete for Order ${cleanOrderNumber}: ${validatedResult.issues.length} client issue(s) identified.`);
        return res.status(200).json(validatedResult);

    } catch (error) {
        trace('comments.failed',{code:error.code || 'COMMENT_ERROR'});
        if (error.code === "GEMINI_REQUEST_FAILED") return res.status(502).json({ error: error.message });
        return res.status(500).json({ error: "SearchFix comment analysis failed." });
    }
}

/**
 * STEP 2 ENDPOINT CONTROLLER:
 * Receives uploaded PDF files downloaded by Chrome Extension, extracts evidence, compares claim vs evidence,
 * and returns ACCEPTED, DISPUTED, or REVIEW_REQUIRED decisions.
 */
export async function analyzeDocumentsController(req, res) {
    // Track files before validation so even rejected multipart requests are cleaned up.
    const uploadedLocalPaths = (req.files || []).map(file => file.path);

    try {
        let bodyData = req.body;

        if (typeof req.body?.orderData === "string") {
            try {
                bodyData = JSON.parse(req.body.orderData);
            } catch (e) {
                return res.status(400).json({ error: "Invalid JSON in 'orderData' field." });
            }
        }

        if (!bodyData || typeof bodyData !== "object" || Array.isArray(bodyData)) {
            return res.status(400).json({error: "orderData must be a JSON object."});
        }

        const orderNumber = bodyData.orderNumber || req.body.orderNumber;
        const comments = bodyData.comments || req.body.comments;
        const analysisId = bodyData.analysisId || req.body.analysisId;
        const taText = bodyData.taText || "";

        if (!orderNumber || typeof orderNumber !== "string" || orderNumber.trim() === "") {
            return res.status(400).json({ error: "orderNumber is required." });
        }

        if (!comments || !Array.isArray(comments) || comments.length === 0) {
            return res.status(400).json({ error: "comments array must contain at least one comment." });
        }

        if (!OrderInputSchema.safeParse({orderNumber, comments}).success || typeof taText !== "string" || taText.length > 120000) {
            return res.status(400).json({error: "Invalid comment data or TA text (maximum 120,000 characters)."});
        }

        const cleanOrderNumber = orderNumber.trim();
        const route = analysisId ? loadAnalysis(analysisId, cleanOrderNumber, comments) : await routeComments(comments);
        trace('analysis.context.loaded',{source:analysisId?'saved-session':'comments'});
        if (route.terminal) return res.status(200).json(SearchFixStep2ResultSchema.parse(
            terminalPayload(route, cleanOrderNumber, analysisId || `SF-${cleanOrderNumber}-${Date.now()}`)));
        const issuesWithDocs = route.issues;

        const uploadedFiles = [];
        if (req.files && Array.isArray(req.files)) {
            for (const file of req.files) {
                const header = Buffer.alloc(5);
                const fd = fs.openSync(file.path, "r");
                try { fs.readSync(fd, header, 0, 5, 0); } finally { fs.closeSync(fd); }
                if (header.toString() !== "%PDF-") return res.status(400).json({error: "Only PDF attachments are supported."});

                let fileType = "SEARCH_PACKAGE";
                if (req.body[`fileType_${file.fieldname}`]) {
                    fileType = req.body[`fileType_${file.fieldname}`];
                } else if (file.originalname.toUpperCase().includes("INDEX")) {
                    fileType = "INDEX";
                } else if (file.originalname.toUpperCase().includes("DEED")) {
                    fileType = "DEED";
                } else if (file.originalname.toUpperCase().includes("TAX")) {
                    fileType = "TAX";
                } else if (file.originalname.toUpperCase().includes("PACER")) {
                    fileType = "PACER";
                } else if (file.originalname.toUpperCase().includes("PATRIOT")) {
                    fileType = "PATRIOT";
                } else if (file.originalname.toUpperCase().includes("REPORT") || file.originalname.toUpperCase().includes("TYPED")) {
                    fileType = "TYPED_REPORT";
                } else if (file.originalname.toUpperCase().includes("THR")) {
                    fileType = "THR";
                } else if (file.originalname.toUpperCase().includes("DOT")) {
                    fileType = "DOT";
                }
                if (!DOCUMENT_TYPES.includes(fileType)) return res.status(400).json({error:"Invalid attachment document type."});

                uploadedFiles.push({
                    fileName: file.originalname,
                    fileType,
                    path: file.path
                });
            }
        }
        if (taText.trim()) uploadedFiles.push({fileName:"Typing Assistant text", fileType:"TYPED_REPORT", inlineText:taText.trim()});
        trace('evidence.received',{count:(req.files || []).length,bytes:(req.files || []).reduce((n,f)=>n+(f.size || 0),0),characters:taText.length});

        // Stage 4-6: PDF Document Analysis, Evidence Extraction & Decision Engine
        const processedIssues = [];

        let missingRequiredEvidence = false;
        for (const issue of issuesWithDocs) {
            if (issue.decision) {
                processedIssues.push({issueType:issue.issueType, category:issue.category, clientClaim:issue.claim,
                    requiredDocuments:[], evidence:[], decision:issue.decision, reason:issue.reason});
                continue;
            }
            trace('evidence.analysis.start',{issueType:issue.issueType,required:issue.requiredDocuments});
            const rawEvidence = await documentAnalysisService.analyzeDocumentsForIssue(issue, uploadedFiles);
            const formattedEvidence = evidenceService.formatEvidence(rawEvidence);
            const missing = issue.requiredDocuments.filter(type => !uploadedFiles.some(file => file.fileType === type));
            missingRequiredEvidence ||= missing.length > 0;
            trace('evidence.analysis.complete',{issueType:issue.issueType,count:formattedEvidence.length,missing});
            const { decision, reason, nextSteps = [] } = missing.length
                ? { decision: "REVIEW_REQUIRED", reason: `Required evidence was not supplied: ${missing.join(", ")}. Review the order's Attachments and Typing Assistant.`, nextSteps: [`Obtain and verify ${missing.join(", ")} before resolving this claim.`] }
                : await decisionEngine.evaluateIssueDecision(issue, formattedEvidence);
            trace('decision.complete',{issueType:issue.issueType,status:decision});

            processedIssues.push({
                issueType: issue.issueType,
                category: issue.category,
                clientClaim: issue.claim,
                requiredDocuments: issue.requiredDocuments,
                evidence: formattedEvidence,
                decision,
                reason,
                nextSteps
            });
        }

        // Stage 7: Overall Decision Aggregation
        const overallDecision = missingRequiredEvidence ? "REVIEW_REQUIRED" : decisionEngine.calculateOverallDecision(processedIssues);

        const step2Payload = {
            analysisId: analysisId || `SF-${cleanOrderNumber}-${Date.now()}`,
            orderNumber: cleanOrderNumber,
            commentAnalysis: route.commentAnalysis,
            nextSteps: route.nextSteps || [],
            issues: processedIssues,
            documents: uploadedFiles.map(file=>({name:file.fileName,type:file.fileType,status:processedIssues.some(i=>i.evidence.some(e=>e.document===file.fileName && e.field!=="documentAnalysisStatus"))?"ANALYZED":"UNVERIFIED"})),
            overallDecision,
            status: overallDecision
        };

        const validatedResult = SearchFixStep2ResultSchema.parse(step2Payload);

        console.log(`[SearchFix Step 2] Complete for Order ${cleanOrderNumber}. Overall Decision: ${overallDecision}`);
        return res.status(200).json(validatedResult);

    } catch (error) {
        trace('documents.failed',{code:error.code || 'DOCUMENT_ERROR'});
        if (error.code === "GEMINI_REQUEST_FAILED") return res.status(502).json({ error: error.message });
        if (error.status === 409) return res.status(409).json({ error: error.message });
        return res.status(500).json({ error: "SearchFix document analysis failed." });
    } finally {
        trace('uploads.cleanup.start',{count:uploadedLocalPaths.length});
        for (const localPath of uploadedLocalPaths) {
            try {
                if (fs.existsSync(localPath)) {
                    fs.unlinkSync(localPath);
                }
            } catch (err) {
                console.warn(`[SearchFix Controller] Temp file cleanup warning (${localPath}):`, err.message);
            }
        }
        trace('uploads.cleanup.complete');
    }
}

/**
 * Legacy / Phase 1 compatibility wrapper
 */
export async function analyzeSearchFix(req, res) {
    return analyzeCommentsController(req, res);
}

/**
 * Unified Controller Endpoint
 */
export async function analyzeFullOrder(req, res) {
    if ((req.files && Array.isArray(req.files) && req.files.length > 0) || req.body?.orderData || req.body?.taText) {
        return analyzeDocumentsController(req, res);
    }
    return analyzeCommentsController(req, res);
}
