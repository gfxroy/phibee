import {PNG} from 'pngjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {realInside} from '../server/core.js';
import {pageDirectory} from './prompts.js';

export async function stageAssets(run){
  const source=path.join(pageDirectory(run),'assets');
  const files=await fs.readdir(source,{withFileTypes:true});
  const mappings=[];
  for(const file of files){
    if(!file.isFile()||! /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file.name))continue;
    const original=await realInside(run.project.directory,path.join(source,file.name));
    if((await fs.stat(original)).size>40*1024*1024)throw Error('Design asset exceeds 40 MB.');
    const bytes=await fs.readFile(original),hash=createHash('sha256').update(bytes).digest('hex');
    const relative=`public/assets/figma/${hash}${path.extname(file.name).toLowerCase()}`;
    // Validate each ancestor before mkdir, including a pre-existing public symlink.
    let parent=run.project.directory;
    for(const part of ['public','assets','figma']){parent=path.join(parent,part);try{await fs.mkdir(parent);}catch(e){if(e.code!=='EEXIST')throw e;}await realInside(run.project.directory,parent);}
    const dest=path.join(run.project.directory,relative);
    try{await fs.writeFile(dest,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;await realInside(run.project.directory,dest);if(!(await fs.readFile(dest)).equals(bytes))throw Error('Existing asset does not match its content hash.');}
    let metadata={};
    // Bound decompression independently of compressed file size.
    if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.length>=24){
      const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);metadata={width,height};
      if(width*height<=16000000){try{const png=PNG.sync.read(bytes);let left=width,top=height,right=-1,bottom=-1;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(png.data[(y*width+x)*4+3]>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}metadata.alphaBounds=right<0?null:{x:left,y:top,width:right-left+1,height:bottom-top+1};}catch{metadata.decode='unavailable';}}
    }
    mappings.push({original,local:dest,url:'/'+relative.replace(/^public\//,''),...metadata});
  }
  await fs.writeFile(path.join(pageDirectory(run),'asset-map.json'),JSON.stringify(mappings,null,2));
  return mappings;
}
