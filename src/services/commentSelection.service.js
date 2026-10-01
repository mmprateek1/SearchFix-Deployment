// Only prepare the chronological window. The model chooses the comment and role.
export function recentCommentCandidates(comments) {
    if (!Array.isArray(comments) || !comments.length) throw new Error('No comments supplied.');
    return comments.map((comment,index)=>({...comment,id:'C'+(index+1),sourceIndex:index}))
        .sort((a,b)=>(String(b.date||'')+' '+String(b.time||'')).localeCompare(String(a.date||'')+' '+String(a.time||'')) || a.sourceIndex-b.sourceIndex)
        .slice(0,15);
}
