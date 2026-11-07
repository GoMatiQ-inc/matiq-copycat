const P=require('./project.cjs');
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function documentation(project,warnings=[]){const {guide,assets}=project;return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width"><title>${esc(guide.title)}</title><style>body{font:17px/1.6 system-ui,sans-serif;max-width:900px;margin:48px auto;padding:0 24px;color:#172b35}h1{font-size:38px}h2{font-size:23px}p,li{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%;height:auto;border:1px solid #c7cfd2}section{margin:40px 0;break-inside:avoid}small{color:#52606b}@page{size:A4;margin:18mm}</style></head><body><h1>${esc(guide.title)}</h1><p>${esc(guide.description)}</p>${warnings.length?`<aside aria-label="Capture review warnings"><h2>Capture review warnings</h2><ul>${warnings.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul></aside>`:''}${guide.steps.map((s,i)=>`<section><h2>${i+1}. ${esc(s.instruction)}</h2>${s.asset?`<img alt="Screenshot for step ${i+1}" src="data:${assets[s.asset].mediaType};base64,${assets[s.asset].data}">`:''}${s.notes?`<p>${esc(s.notes)}</p>`:''}</section>`).join('')}<small>Created with MatiQ Guides. Review sensitive information before sharing.</small></body></html>`;}
const md=value=>String(value).replace(/[\\`*_{}\[\]<>#!|]/g,char=>'\\'+char).replace(/\r/g,'');
function markdown(project,folder,warnings=[]){const {guide}=project;return `# ${md(guide.title)}\n\n${md(guide.description)}\n\n`+(warnings.length?'## Capture review warnings\n\n'+warnings.map(reason=>'- '+md(reason)).join('\n')+'\n\n':'')+guide.steps.map((s,i)=>`## ${i+1}. ${md(s.instruction)}\n\n${s.asset?`![Screenshot for step ${i+1}](${encodeURIComponent(folder)}/${s.asset}.png)\n\n`:''}${md(s.notes)}\n`).join('\n');}
function exportRequest(project,args,revision){
 const request=typeof args==='string'?{format:args}:args;
 if(!request||Array.isArray(request)||typeof request!=='object'||Object.keys(request).some(key=>!['format','reviewedRevision'].includes(key))||!['html','markdown','pdf','editable','sanitized'].includes(request.format))throw Error('Choose a supported export format.');
 if(project.capture&&['recording','paused'].includes(project.capture.phase))throw Error('Stop or cancel capture before exporting the guide.');
 if(request.format!=='editable'&&(project.guide.steps.some(step=>step.annotations.some(a=>a.type==='redact'))||project.capture?.issues.length)&&(!Number.isSafeInteger(request.reviewedRevision)||request.reviewedRevision!==revision))throw Error('Review the saved sharing text and capture warnings before exporting. Edit sensitive wording, save, then confirm the current review.');
 return request.format;
}
function warningSteps(warnings,available){
 const chunks=[];let notes='';for(const reason of warnings){if(notes.length+reason.length+2>20000){chunks.push(notes);notes='';}notes+=(notes?'\n\n':'')+reason;}if(notes)chunks.push(notes);
 if(chunks.length>available)throw Error('The sanitized project needs room for capture-review notes. Split this guide before exporting a sanitized project; HTML, Markdown and PDF preserve the warnings separately.');
 return chunks.map(notes=>({...P.step(),timestamp:0,instruction:'Review capture warnings before sharing',notes}));
}
module.exports={documentation,markdown,exportRequest,warningSteps};
