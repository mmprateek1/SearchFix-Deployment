// Only operational metadata belongs here. Never log keys, comments, TA, PDF
// contents, URL queries, prompts, or raw request/response objects.
export function createActivityLog(render = () => {}) {
  const entries = [];
  const records = [];
  let sequence = 0;
  const allowed = new Set(['step','tabId','orderNumber','kind','count','fileType','bytes','characters','status','httpStatus','requestId','durationMs','attempt','required','selected','missing','errorCode']);
  const log = (event, details = {}) => {
    const safe = Object.fromEntries(Object.entries(details).filter(([key,value]) => allowed.has(key) &&
      (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' || Array.isArray(value))));
    // Error text can contain source URLs/credentials, so record its stage only.
    const time = new Date().toISOString();
    records.push({sequence:++sequence,time,event,details:safe});
    if (records.length > 1500) records.shift();
    const entry = `${time} ${event} ${JSON.stringify(safe)}`;
    entries.push(entry);
    if (entries.length > 1500) entries.shift();
    console.info('[SearchFix]', entry);
    render(entries.join('\n'));
  };
  return {log, text:() => entries.join('\n'), since:cursor=>records.filter(item=>item.sequence>cursor)};
}
