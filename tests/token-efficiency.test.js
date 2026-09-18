import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
import {modelArgs, listModels} from '../desktop/models.js';
import {nativeProjectSchema} from '../desktop/queue.js';
import {stageAssets} from '../desktop/assets.js';
import {PreviewServer} from '../desktop/preview.js';
const {contextChunk}=createRequire(import.meta.url)('../scripts/mcp/figma-export.cjs');
test('compact paginated design context preserves every value including long Unicode strings',()=>{
 const node={document:{text:'🧡 precise text '.repeat(3000),rotation:0.125,children:[{id:'2:3',visible:false}]},styles:{font:'Example'}};const raw=JSON.stringify(node);let offset=0,joined='';do{const text=contextChunk(raw,offset).content[0].text;const split=text.indexOf('\n'),meta=JSON.parse(text.slice(0,split));joined+=text.slice(split+1);offset=meta.nextOffset;}while(offset!==null);assert.deepEqual(JSON.parse(joined),node);assert.throws(()=>contextChunk(raw,-1));
});
test('model choices are validated and passed as literal CLI arguments',()=>{
 assert.deepEqual(modelArgs('gemini-3.8-flash-high'),['--model','gemini-3.8-flash-high']);assert.deepEqual(modelArgs(''),[]);assert.throws(()=>modelArgs('--sandbox'));assert.throws(()=>modelArgs('x; echo hi'));
 const p=nativeProjectSchema.parse({name:'Test',managerModel:'opus',builderModel:'gemini-3.8-flash-high',manager:'claude',builder:'antigravity',pages:[{name:'Home',url:'https://figma.com/design/x?node-id=1-1'}],viewport:{width:1440,height:900}});assert.equal(p.managerModel,'opus');assert.equal(p.builderModel,'gemini-3.8-flash-high');
});
test('listModels provides curated Gemini models for Antigravity and models for Claude and Codex',async()=>{
 const ag=await listModels('antigravity');
 assert(ag.length>=8);
 assert(ag.some(m=>m.id==='gemini-3.8-flash-high'));
 assert(ag.some(m=>m.id==='gemini-3.7-flash-high'));
 assert(ag.some(m=>m.id==='gemini-3.1-pro-high'));
 const claude=await listModels('claude');
 assert(claude.some(m=>m.id==='sonnet'));
 assert(claude.some(m=>m.id==='opus'));
 const codex=await listModels('codex');
 assert(codex.length>0&&codex.every(m=>m.id&&m.label));
});
test('asset metadata reports precise nontransparent bounds without changing image bytes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'phiby-bounds-'));try{const run={project:{directory:root},directory:path.join(root,'.align/run'),pageIndex:0},dir=path.join(run.directory,'page-1/assets');await fs.mkdir(dir,{recursive:true});const png=new PNG({width:8,height:9});png.data.fill(0);png.data[(3*8+2)*4+3]=255;png.data[(6*8+4)*4+3]=1;const bytes=PNG.sync.write(png);await fs.writeFile(path.join(dir,'a.png'),bytes);const [asset]=await stageAssets(run);assert.deepEqual(asset.alphaBounds,{x:2,y:3,width:3,height:4});assert.equal(asset.width,8);assert.deepEqual(await fs.readFile(asset.local),bytes);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('managed Vite preview uses a real allocated port and serves the correct project',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'phiby-preview-'));const preview=new PreviewServer();try{await fs.symlink(path.resolve('node_modules'),path.join(root,'node_modules'),'dir');await fs.writeFile(path.join(root,'index.html'),'<h1>preview-owned-fixture</h1>');const url=await preview.start(root,new AbortController().signal);assert.match(url,/^http:\/\/127\.0\.0\.1:\d+\/$/);assert.match(await (await fetch(url)).text(),/preview-owned-fixture/);assert.equal(await preview.start(root),url);}finally{preview.stop();await fs.rm(root,{recursive:true,force:true});}
});

test('two website previews use separate available ports and restart without borrowing another website',async()=>{const one=await fs.mkdtemp(path.join(os.tmpdir(),'phiby-one-')),two=await fs.mkdtemp(path.join(os.tmpdir(),'phiby-two-'));const a=new PreviewServer(),b=new PreviewServer();try{await fs.writeFile(path.join(one,'index.html'),'<h1>first-site</h1>');await fs.writeFile(path.join(two,'index.html'),'<h1>second-site</h1>');const urlA=await a.start(one),urlB=await b.start(two);assert.notEqual(urlA,urlB);assert.match(await (await fetch(urlA)).text(),/first-site/);assert.match(await (await fetch(urlB)).text(),/second-site/);a.stop();const restarted=await a.start(one);assert.match(await (await fetch(restarted)).text(),/first-site/);assert.match(await (await fetch(urlB)).text(),/second-site/);}finally{a.stop();b.stop();await fs.rm(one,{recursive:true,force:true});await fs.rm(two,{recursive:true,force:true});}});
