import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {previewUrl,jsonWrite} from './core.js';

export async function capture(url,viewport,dir,signal){
  if(signal?.aborted)throw Error('Stopped.');
  await fs.mkdir(dir,{recursive:true});let browser;
  try{browser=await chromium.launch({headless:true});}catch{throw Error('Browser runtime is missing. Run npm run install:browser in the Align app directory.');}
  const stop=()=>browser.close().catch(()=>{});signal?.addEventListener('abort',stop,{once:true});
  try{
    const page=await browser.newPage({viewport,deviceScaleFactor:1,reducedMotion:'reduce'});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(previewUrl(url),{waitUntil:'networkidle',timeout:30000}).catch(async e=>{if(!page.url()||page.url()==='about:blank')throw e;await page.waitForLoadState('domcontentloaded');});
    await page.evaluate(()=>document.fonts.ready);await page.addStyleTag({content:'*,*::before,*::after { animation: none !important; transition: none !important; caret-color: transparent !important; }'});
    const geometry=await page.evaluate(()=>({title:document.title,viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth,elements:[...document.querySelectorAll('h1,h2,h3,p,a,button,img,input,nav,main,section,[data-testid]')].slice(0,250).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {tag:el.tagName,id:el.id,testId:el.getAttribute('data-testid'),text:(el.textContent||'').trim().slice(0,140),bounds:{x:r.x,y:r.y,width:r.width,height:r.height},font:s.font,fontFamily:s.fontFamily,color:s.color,background:s.backgroundColor,transform:s.transform,gap:s.gap,padding:s.padding};})}));
    const screenshot=path.join(dir,'screenshot.png');await page.screenshot({path:screenshot,fullPage:false,animations:'disabled'});await jsonWrite(path.join(dir,'geometry.json'),{...geometry,errors});return {screenshot,geometry,errors};
  }finally{signal?.removeEventListener('abort',stop);await browser.close();}
}
export async function imageDiff(reference,current,output){
  try{const a=PNG.sync.read(await fs.readFile(reference)),b=PNG.sync.read(await fs.readFile(current));if(a.width!==b.width||a.height!==b.height)return {comparable:false,reason:`Reference ${a.width}×${a.height}; render ${b.width}×${b.height}. Use matching dimensions for pixel comparison.`};
    const diff=new PNG({width:a.width,height:a.height});const pixels=pixelmatch(a.data,b.data,diff.data,a.width,a.height,{threshold:0.15,includeAA:false});await fs.writeFile(output,PNG.sync.write(diff));return {comparable:true,changedPercent:Number((pixels/(a.width*a.height)*100).toFixed(2)),path:output};
  }catch(e){return {comparable:false,reason:'Pixel comparison needs two readable PNG images. '+e.message};}
}
