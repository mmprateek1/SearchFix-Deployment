import { getRequiredDocumentTypes } from "../config/documentMappings.js";
import { ISSUE_TYPES } from '../config/issueTypes.js';

export class DocumentSelectionService {
    /**
     * Determines required document types for a list of identified issues.
     * 
     * @param {Array<{issueType: string, claim: string}>} issues List of issues
     * @returns {Array<{issueType: string, claim: string, requiredDocuments: Array<string>}>} Issues with required documents attached
     */
    selectRequiredDocuments(issues) {
        if (!Array.isArray(issues)) return [];

        return issues.map(issue => {
            const requiredDocuments = issue.decision || !ISSUE_TYPES.includes(issue.issueType) ? [] : [...new Set(getRequiredDocumentTypes(issue.issueType))];
            return {
                ...issue,
                requiredDocuments
            };
        });
    }
}

export const documentSelectionService = new DocumentSelectionService();
