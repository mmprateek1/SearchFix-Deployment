import { geminiService } from './gemini.service.js';
import { recentCommentCandidates } from './commentSelection.service.js';
import { getCommentAnalysisSystemPrompt,getCommentAnalysisUserPrompt } from '../prompts/commentAnalysis.prompt.js';
import { ISSUE_TYPES,COMMENT_ONLY_TYPES } from '../config/issueTypes.js';
const nonempty=value=>typeof value==='string'&&value.trim();
export class IssueClassificationService {
 async analyzeComments(comments) {
  const candidates=recentCommentCandidates(comments);
  const analysis={selectedComment:null,contextCommentsUsed:[],selectionReason:'',roleReason:'',totalComments:comments.length,consideredComments:candidates.length};
  const review=reason=>({commentAnalysis:analysis,issues:[],terminal:'REVIEW_REQUIRED',reason,nextSteps:['Review the latest comments and clarify the current request.']});
  if(comments.some(c=>!/^\d{4}-\d{2}-\d{2}$/.test(c.date||'')||!/^\d{2}:\d{2}(:\d{2})?$/.test(c.time||''))) return review('Comment dates or times are incomplete; the newest 15 comments cannot be established reliably.');
  const raw=await geminiService.generateJSON(getCommentAnalysisSystemPrompt(),getCommentAnalysisUserPrompt(candidates));
  const parsed=typeof raw==='string'?JSON.parse(raw):raw;
  const chosen=candidates.find(c=>c.id===parsed?.selectedCommentId);
  if(!chosen) return review(nonempty(parsed?.reason)&&parsed.selectedCommentId===null?parsed.reason:'AI did not select a valid comment from the newest 15. Manual review is required.');
  if(!['INTERNAL','CLIENT','SYSTEM','UNKNOWN'].includes(parsed.selectedRole)||!nonempty(parsed.selectionReason)||!nonempty(parsed.roleReason)) return review('AI did not explain a valid comment selection and author role. Manual review is required.');
  const {sourceIndex,id,...original}=chosen;
  analysis.selectedComment={...original,id,role:parsed.selectedRole};
  analysis.selectionReason=parsed.selectionReason.trim();analysis.roleReason=parsed.roleReason.trim();
  if(!Array.isArray(parsed.contextCommentIds)||parsed.contextCommentIds.some(id=>!candidates.some(c=>c.id===id))) return review('AI referred to context outside the supplied comment window. Manual review is required.');
  analysis.contextCommentsUsed=[...new Set(parsed.contextCommentIds)].filter(id=>id!==chosen.id).map(id=>{const {sourceIndex,...c}=candidates.find(c=>c.id===id);return {...c,purpose:'AI-selected context'};});
  const reason=nonempty(parsed.reason)?parsed.reason.trim():'';
  const nextSteps=Array.isArray(parsed.nextSteps)?parsed.nextSteps.filter(nonempty).map(s=>s.trim()):[];
  if(parsed.selectedRole==='INTERNAL') return {commentAnalysis:analysis,issues:[],terminal:'IGNORED',reason:"AI selected our internal team's comment. "+(reason||analysis.selectionReason),nextSteps:nextSteps.length?nextSteps:['Follow up on the internal status if needed.']};
  if(parsed.selectedRole!=='CLIENT')return review(reason||'The selected author is not established as a client; review is required.');
  if(parsed.disposition==='REVIEW_REQUIRED')return review(reason||'AI could not confidently identify the current actionable request.');
  if(parsed.disposition==='TASK_ACCEPTED'&&Array.isArray(parsed.issues)&&!parsed.issues.length&&reason&&nextSteps.length) return {commentAnalysis:analysis,issues:[],terminal:'ACCEPTED',decisionBasis:'CLIENT_TASK',reason,nextSteps};
  if(parsed.disposition!=='ANALYZE'||!Array.isArray(parsed.issues)||!parsed.issues.length) return review('AI did not return a supported task or discrepancy classification.');
  if(parsed.issues.some(i=>!i||!ISSUE_TYPES.includes(i.issueType)||COMMENT_ONLY_TYPES.includes(i.issueType)||!nonempty(i.claim)))return review('A reported discrepancy has no supported issue type. Manual classification is required; no documents were requested.');
  return {commentAnalysis:analysis,issues:parsed.issues.map(i=>({issueType:i.issueType,claim:i.claim.trim()})),nextSteps,reason};
 }
}
export const issueClassificationService=new IssueClassificationService();
