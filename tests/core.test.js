import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseFigma,previewUrl,inside,realInside,contextPacket,extractJSON,projectSchema,reviewSchema,snapshot,changed,restore} from '../server/core.js';
import {agentArgs,decodeEvent,command} from '../server/providers.js';
import {imageDiff} from '../server/capture.js';
import {PNG} from 'pngjs';

test('Figma URL parsing preserves the selected node and rejects impersonation',()=>{
  assert.deepEqual(parseFigma('https://www.figma.com/design/AbC123/Test?node-id=4-19'),{fileKey:'AbC123',nodeId:'4:19'});
  for(const url of ['https://figma.com.evil.test/design/AbC/test?node-id=1-2','file:///etc/passwd','https://www.figma.com/design/AbC/test','https://figma.com/design/AbC/test?node-id=x'])assert.throws(()=>parseFigma(url));
});
test('project schema enforces execution bounds and explicit defaults',()=>{
  const p=projectSchema.parse({name:'Test',directory:'/tmp/test'});assert.equal(p.maxIterations,5);assert.equal(p.autoContinue,false);
  assert.throws(()=>projectSchema.parse({...p,maxIterations:100}));assert.throws(()=>previewUrl('file:///etc/passwd'));assert.throws(()=>previewUrl('http://user:pass@localhost'));
});
test('persistent context accompanies the brief, constraints, and evidence boundaries',()=>{
  const p={...projectSchema.parse({name:'Test',directory:'/tmp/test',brief:'Preserve the 8 degree rotation.',constraints:'Do not change nav.'}),id:'test'};
  const packet=contextPacket(p);assert.match(packet,/Preserve the 8 degree rotation/);assert.match(packet,/Do not change nav/);assert.match(packet,/untrusted design data/);
});
test('structured reviewer output is validated rather than treated as success',()=>{
  const result=extractJSON('```json\n{"summary":"Cannot inspect","verdict":"blocked","issues":[],"correctionPrompt":""}\n```');assert.equal(reviewSchema.parse(result).verdict,'blocked');assert.throws(()=>reviewSchema.parse({verdict:'perfect'}));assert.throws(()=>extractJSON('Everything is great!'));
});
test('provider commands keep prompts out of shell execution and retain sandbox settings',()=>{
  const reviewer=agentArgs('codex',{role:'reviewer',session:'test-session',images:['/tmp/a.png']});assert.ok(reviewer.includes('sandbox_mode="read-only"'));assert.ok(reviewer.includes('test-session'));assert.ok(reviewer.includes('/tmp/a.png'));
  const builder=agentArgs('codex',{role:'builder'});assert.ok(builder.includes('sandbox_mode="workspace-write"'));assert.ok(builder.includes('approval_policy="never"'));
  const claude=agentArgs('claude',{role:'reviewer'});assert.ok(claude.includes('Bash,Edit,Write,NotebookEdit'));assert.ok(claude.some(x=>x.includes('failIfUnavailable')));
  assert.ok(agentArgs('antigravity',{role:'builder'}).includes('--sandbox'));
  for(const args of [reviewer,builder,claude])assert.ok(!args.some(x=>x.includes('dangerously')));
});
test('provider streaming decoders preserve distinct session IDs and failures',()=>{
  assert.equal(decodeEvent('codex',{thread_id:'a'}).session,'a');assert.equal(decodeEvent('claude',{session_id:'b'}).session,'b');assert.equal(decodeEvent('antigravity',{event:'result',result:{conversation_id:'c',status:'ERROR',error:'No access'}}).error,'No access');
  assert.match(decodeEvent('claude',{type:'result',is_error:true,result:'Permission denied'}).error,/Permission denied/);
});
test('command runner streams events, handles invalid binaries, and terminates timed-out children',async()=>{
  const lines=[];const r=await command(process.execPath,['-e','process.stdin.on("data",d=>process.stdout.write(d));'],{input:'literal $(echo secret)\n',onLine:l=>lines.push(l)});assert.equal(r.output,'literal $(echo secret)\n');assert.equal(lines[0],'literal $(echo secret)');
  await assert.rejects(command('/definitely/not/installed',[]),/ENOENT/);
  await assert.rejects(command(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:80}),/timed out/);
});
test('artifact paths reject traversal and symlink escapes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'align-path-'));try{assert.throws(()=>inside(root,'../secret'));await fs.symlink('/etc',path.join(root,'escape'));await assert.rejects(realInside(root,'escape/hosts'),/outside/);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('checkpoints preserve preexisting edits, restore creations/deletions, and refuse newer edits',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'align-snapshot-'));const root=path.join(dir,'project'),backup=path.join(dir,'backup');await fs.mkdir(root);await fs.writeFile(path.join(root,'app.js'),'user uncommitted changes');await fs.writeFile(path.join(root,'old.css'),'old');await fs.writeFile(path.join(root,'.env'),'secret');
  try{const before=await snapshot(root,backup);assert.ok(!before['.env']);await fs.writeFile(path.join(root,'app.js'),'agent changes');await fs.unlink(path.join(root,'old.css'));await fs.writeFile(path.join(root,'new.css'),'new');const {after,files}=await changed(root,before);assert.equal(files.length,3);
    await fs.writeFile(path.join(root,'app.js'),'new human changes');await assert.rejects(restore(root,backup,before,after),/newer edits/);assert.equal(await fs.readFile(path.join(root,'app.js'),'utf8'),'new human changes');
    await fs.writeFile(path.join(root,'app.js'),'agent changes');await restore(root,backup,before,after);assert.equal(await fs.readFile(path.join(root,'app.js'),'utf8'),'user uncommitted changes');assert.equal(await fs.readFile(path.join(root,'old.css'),'utf8'),'old');await assert.rejects(fs.stat(path.join(root,'new.css')));assert.equal(await fs.readFile(path.join(root,'.env'),'utf8'),'secret');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('pixel diff is a measured diagnostic and refuses mismatched image dimensions',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'align-diff-'));try{const png=new PNG({width:4,height:4});png.data.fill(255);const a=path.join(dir,'a.png'),b=path.join(dir,'b.png'),out=path.join(dir,'diff.png');await fs.writeFile(a,PNG.sync.write(png));await fs.writeFile(b,PNG.sync.write(png));assert.equal((await imageDiff(a,b,out)).changedPercent,0);await fs.writeFile(b,PNG.sync.write(new PNG({width:5,height:4})));assert.equal((await imageDiff(a,b,out)).comparable,false);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
