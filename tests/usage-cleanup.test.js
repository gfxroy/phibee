import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {collectUsage} from '../desktop/usage.js';import {cleanupPlan,performCleanup} from '../desktop/cleanup.js';
async function tmp(){return fs.mkdtemp(path.join(os.tmpdir(),'align-features-'));}
test('usage hook reports exact cumulative provider counts and collector avoids double counting',async()=>{const dir=await tmp();try{const usage=path.join(dir,'usage/manager');const run=p=>spawnSync(process.execPath,['desktop/usage-hook.cjs'],{env:{...process.env,ALIGN_USAGE_DIR:usage,ALIGN_USAGE_ROLE:'manager',ALIGN_USAGE_PROVIDER:'antigravity'},input:JSON.stringify(p),encoding:'utf8'});assert.equal(run({conversation_id:'one',context_window:{total_input_tokens:120,total_output_tokens:35}}).status,0);let u=await collectUsage(dir);assert.equal(u.input,120);assert.equal(u.output,35);assert.equal((await collectUsage(dir,u)).input,120);run({conversation_id:'one',context_window:{total_input_tokens:160,total_output_tokens:45}});u=await collectUsage(dir,u);assert.equal(u.input,160);assert.equal(u.output,45);run({conversation_id:'two',context_window:{total_input_tokens:20,total_output_tokens:5}});u=await collectUsage(dir,u);assert.equal(u.input,180);assert.equal(u.output,50);assert.equal(u.builder.reported,false);}finally{await fs.rm(dir,{recursive:true,force:true});}});
test('usage collector falls back to high-accuracy manual token counting from events.jsonl and terminal logs when provider metrics are unavailable',async()=>{const dir=await tmp();try{await fs.mkdir(path.join(dir,'logs'),{recursive:true});
  // Simulate events.jsonl with prompt inputs
  await fs.writeFile(path.join(dir,'logs','events.jsonl'),JSON.stringify({at:new Date().toISOString(),type:'prompt',role:'manager',ticket:'t1',prompt:'Design the landing page hero section with dark background and rounded buttons'})+'\n'+JSON.stringify({at:new Date().toISOString(),type:'prompt',role:'builder',ticket:'t1',prompt:'Implement the React components for the landing page'})+'\n');
  // Simulate manager and builder logs with generated outputs
  await fs.writeFile(path.join(dir,'logs','manager.log'),'Inspecting the Figma design nodes. Creating context and reference screenshots for the builder.\n');
  await fs.writeFile(path.join(dir,'logs','builder.log'),'Created Hero.jsx, imported lucide icons, set up Vite styles and verified layout.\n');
  const u=await collectUsage(dir);
  assert.ok(u.input>0,'Input tokens should be counted');
  assert.ok(u.output>0,'Output tokens should be counted');
  assert.equal(u.manager.reported,true);
  assert.equal(u.builder.reported,true);
  assert.equal(u.input,u.manager.input+u.builder.input);
  assert.equal(u.output,u.manager.output+u.builder.output);
}finally{await fs.rm(dir,{recursive:true,force:true});}});

test('extractTerminalTokens parses CLI reports and collector uses exact terminal counts',async()=>{
  const dir=await tmp();
  try{
    await fs.mkdir(path.join(dir,'logs'),{recursive:true});
    // Terminal prints real token counts (e.g. Claude or Antigravity)
    await fs.writeFile(path.join(dir,'logs','manager.log'),'\x1b[32m✔\x1b[0m Evaluated\nTokens: 1,450 in · 320 out\n');
    await fs.writeFile(path.join(dir,'logs','builder.log'),'Building components...\n\x1b[1mTokens: 3,200 in · 850 out\x1b[0m\n');
    const u=await collectUsage(dir);
    assert.equal(u.manager.input,1450);
    assert.equal(u.manager.output,320);
    assert.equal(u.builder.input,3200);
    assert.equal(u.builder.output,850);
    assert.equal(u.input,4650);
    assert.equal(u.output,1170);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

