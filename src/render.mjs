export async function render(step,asset,{original=false}={}) {
  const img=new Image();img.src=`data:${asset.mediaType};base64,${asset.data}`;await img.decode();
  if(!img.naturalWidth||img.naturalWidth*img.naturalHeight>32000000)throw Error('Screenshot exceeds 32 megapixels or could not be decoded. Replace it before exporting.');
  const w=img.naturalWidth,h=img.naturalHeight,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
  ctx.strokeStyle='#0877ad';ctx.fillStyle='#0877ad';ctx.lineWidth=Math.max(3,w/350);ctx.font=`bold ${Math.max(20,w/45)}px sans-serif`;ctx.textBaseline='top';
  for(const a of step.annotations.filter(a=>a.type!=='redact')){
    const x=a.x*w,y=a.y*h,aw=a.width*w,ah=a.height*h;
    if(a.type==='box')ctx.strokeRect(x,y,aw,ah);
    if(a.type==='arrow'){const ex=x+aw,ey=y+ah,angle=Math.atan2(ah,aw),size=Math.max(14,w/55);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(ex,ey);ctx.moveTo(ex-size*Math.cos(angle-.5),ey-size*Math.sin(angle-.5));ctx.lineTo(ex,ey);ctx.lineTo(ex-size*Math.cos(angle+.5),ey-size*Math.sin(angle+.5));ctx.stroke();}
    if(a.type==='text'||a.type==='callout'){ctx.fillStyle='#fff';ctx.fillRect(x,y,aw,ah);ctx.strokeRect(x,y,aw,ah);ctx.fillStyle='#0877ad';ctx.save();ctx.beginPath();ctx.rect(x,y,aw,ah);ctx.clip();ctx.fillText(a.text||'1',x+5,y+5,Math.max(1,aw-10));ctx.restore();}
  }
  // Redactions are last, opaque pixel replacement; annotations beneath them cannot survive exports.
  ctx.fillStyle='#000';for(const a of step.annotations.filter(a=>a.type==='redact'))ctx.fillRect(Math.floor(a.x*w),Math.floor(a.y*h),Math.ceil(a.width*w)+1,Math.ceil(a.height*h)+1);
  if(step.crop&&!original){const c=step.crop,out=document.createElement('canvas');out.width=Math.max(1,Math.round(c.width*w));out.height=Math.max(1,Math.round(c.height*h));out.getContext('2d').drawImage(canvas,c.x*w,c.y*h,c.width*w,c.height*h,0,0,out.width,out.height);return out;}
  return canvas;
}
