const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {constants}=require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
const MAX_BYTES = 128 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function text(value, max, label) {
  if (typeof value !== 'string' || value.length > max) throw Error(`${label} must be text of at most ${max} characters.`);
  return value;
}
function id(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw Error('Project contains an invalid stable identity.');
  return value;
}
function rect(value) {
  if (!value || !['x','y','width','height'].every(k => Number.isFinite(value[k]) && value[k] >= 0 && value[k] <= 1) || !value.width || !value.height || value.x + value.width > 1.000001 || value.y + value.height > 1.000001) throw Error('Keep the selection inside the screenshot.');
  return {x:value.x,y:value.y,width:value.width,height:value.height};
}
function image(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16 * 1024 * 1024) throw Error('Choose a PNG or JPEG image under 16 MiB.');
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) throw Error('Only PNG and JPEG screenshots are supported. Convert this asset before importing.');
  let width=0,height=0;
  if(png){if(bytes.length<33||bytes.toString('ascii',12,16)!=='IHDR')throw Error('PNG screenshot has no valid image header.');width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}
  else {
    let offset=2;
    while(offset+4<bytes.length){
      if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];if(marker===0xda||marker===0xd9)break;
      if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(offset+2>bytes.length)break;const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8){height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}offset+=length;
    }
  }
  if(!width||!height||width>32768||height>32768||width*height>32000000)throw Error('Choose a valid screenshot under 32 megapixels and 32,768 pixels per edge.');
  return {mediaType:png?'image/png':'image/jpeg',data:bytes.toString('base64')};
}
function validate(value) {
  if (!value || value.format !== 'matiq-guides' || value.version !== 1) throw Error('Unsupported project format. Use a MatiQ Guides version 1 project.');
  if (!value.assets || typeof value.assets !== 'object' || Array.isArray(value.assets) || Object.keys(value.assets).length > 1000) throw Error('Project contains an invalid asset inventory.');
  if(Object.values(value.assets).reduce((total,asset)=>total+(typeof asset?.data==='string'?asset.data.length:0),0)>MAX_BYTES)throw Error('Embedded screenshots exceed the 128 MiB project limit. Split the guide before continuing.');
  const assets = {};
  for (const [key, asset] of Object.entries(value.assets)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !asset || typeof asset.data !== 'string' || asset.data.length > 24 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.data)) throw Error('Invalid asset identity or encoding. Assets cannot contain file paths.');
    const bytes = Buffer.from(asset.data,'base64');
    if (hash(bytes) !== key) throw Error('Screenshot integrity check failed. Restore the original project or replace the missing image.');
    const checked = image(bytes);
    if (checked.mediaType !== asset.mediaType) throw Error('Screenshot media type does not match its bytes.');
    Object.defineProperty(assets,key,{value:checked,enumerable:true,configurable:true,writable:true});
  }
  const g = value.guide;
  if (!g || !Array.isArray(g.steps) || g.steps.length > 500) throw Error('A guide supports up to 500 steps. Split this guide before importing.');
  const seen = new Set();
  const steps = g.steps.map(s => {
    id(s.id); if (seen.has(s.id)) throw Error('Step identities must be unique.'); seen.add(s.id);
    if (s.asset !== null && (!Object.hasOwn(assets,s.asset))) throw Error('A screenshot is missing. Restore its asset before opening this project.');
    if (!['manual','browser','desktop'].includes(s.kind)) throw Error('Unsupported capture source.');
    if (!Number.isSafeInteger(s.timestamp) || s.timestamp < 0) throw Error('Invalid step timestamp.');
    if (!Array.isArray(s.annotations) || s.annotations.length > 100) throw Error('Keep each screenshot under 100 annotations.');
    const annotations = s.annotations.map(a => {
      if (!['box','arrow','text','callout','redact'].includes(a.type)) throw Error('Unsupported annotation type.');
      return {type:a.type,...rect(a),text:text(a.text || '',500,'Annotation')};
    });
    // Source context is deliberately restricted: never persist query strings, fragments, form values or page HTML.
    let source = null;
    if (s.source) {
      if (s.source.origin) {const url = new URL(s.source.origin); if (!['https:','http:'].includes(url.protocol) || url.origin !== s.source.origin) throw Error('Source context must be an HTTP(S) origin without credentials, paths or query data.'); source={origin:url.origin};}
      else if (s.source.application) source={application:text(s.source.application,200,'Application')};
    }
    return {id:s.id,kind:s.kind,instruction:text(s.instruction,10000,'Instruction'),notes:text(s.notes,20000,'Notes'),timestamp:s.timestamp,source,asset:s.asset,crop:s.crop ? rect(s.crop):null,annotations};
  });
  const capture=require('./capture.cjs').state(value.capture);
  if(capture&&['recording','paused'].includes(capture.phase)&&(capture.receipts.some(key=>!seen.has(key))||capture.baseSteps.some(key=>!seen.has(key))||capture.baseSteps.length+capture.receipts.length!==steps.length))throw Error('The active capture step inventory is inconsistent. Restore a verified project copy.');
  return {format:'matiq-guides',version:1,guide:{id:id(g.id),title:text(g.title,300,'Title'),description:text(g.description,10000,'Description'),steps},assets,...(capture?{capture}:{} )};
}
function create(title='Untitled guide',description='') { return validate({format:'matiq-guides',version:1,guide:{id:randomUUID(),title,description,steps:[]},assets:{}}); }
function step() { return {id:randomUUID(),kind:'manual',instruction:'Describe this action',notes:'',timestamp:Date.now(),source:null,asset:null,crop:null,annotations:[]}; }
function addImage(project, bytes) {const asset=image(bytes),key=hash(bytes);project.assets[key]=asset;return key;}
function compact(project) { const result=validate(project),used=new Set(result.guide.steps.map(s=>s.asset)); for(const key of Object.keys(result.assets))if(!used.has(key))delete result.assets[key];return result; }
async function read(file) {const stat=await fs.lstat(file);if (!stat.isFile() || stat.isSymbolicLink() || stat.size>MAX_BYTES)throw Error('Choose a regular project file under 128 MiB; symbolic links are not supported.');const contents=await fs.readFile(file,'utf8');let parsed;try{parsed=JSON.parse(contents);}catch{throw Error('This file contains invalid JSON. Restore a verified project copy or import a valid portable export.');}return validate(parsed);}
async function atomicBytes(file,bytes) {
  if(Buffer.byteLength(bytes)>MAX_BYTES)throw Error('Output exceeds 128 MiB. Split the guide before saving.');
  const pending=file+'.pending',handle=await fs.open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);
  try {await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  await fs.rename(pending,file);
  const directory=await fs.open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
}
async function atomicWrite(file,project) {await atomicBytes(file,JSON.stringify(compact(project)));}

async function lock(file) {
  const lockPath=file+'.lock',owner={host:os.hostname(),pid:process.pid,token:randomUUID()},body=JSON.stringify(owner);
  async function attempt(){const handle=await fs.open(lockPath,'wx',0o600);try{await handle.writeFile(body);}finally{await handle.close();}}
  try {await attempt();}catch(e){
    if(e.code!=='EEXIST')throw e;
    // An abandoned lock is recoverable only on the same host with a positively dead PID.
    const recovery=lockPath+'.recovery';let guard;
    try {guard=await fs.open(recovery,'wx',0o600);}catch{throw Error('Project recovery is already in progress. Retry after it finishes.');}
    try {
      const previous=JSON.parse(await fs.readFile(lockPath,'utf8'));
      if(previous.host!==os.hostname() || !Number.isSafeInteger(previous.pid) || previous.pid<1)throw Error('Project is owned by another or unknown host. Close that writer before opening.');
      try{process.kill(previous.pid,0);throw Error('Project is already open. Close its other window before editing.');}catch(error){if(error.code!=='ESRCH')throw error;}
      await fs.unlink(lockPath);await attempt();
    } finally {await guard.close();await fs.unlink(recovery);}
  }
  return async()=>{const current=await fs.readFile(lockPath,'utf8');if(current!==body)throw Error('Project ownership changed. Keep the project open and investigate its lock before retrying closure.');await fs.unlink(lockPath);};
}
module.exports={create,step,validate,rect,image,hash,addImage,read,atomicWrite,atomicBytes,lock,compact,clone,MAX_BYTES};
