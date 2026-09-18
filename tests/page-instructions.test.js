import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeProjectSchema} from '../desktop/queue.js';
import {managerPrompt,builderPrompt} from '../desktop/prompts.js';
test('page instructions persist in schema and only the current page enters either agent prompt',()=>{
 const project=nativeProjectSchema.parse({name:'Phiby test',instructionMode:'pages',prompt:'Shared visual direction',pages:[{name:'Login',url:'https://www.figma.com/design/test/a?node-id=1-1',notes:'Login-specific interaction'},{name:'Profile',url:'https://www.figma.com/design/test/a?node-id=1-2',notes:'Profile-specific avatar'}],viewport:{width:1440,height:900},manager:'codex',builder:'antigravity'});
 assert.equal(project.instructionMode,'pages');const run={project,directory:'/tmp/project/.align/run',pageIndex:0,pages:[],ticket:'test'};
 for(const prompt of [managerPrompt(run),builderPrompt(run,'Build')]){assert.match(prompt,/Shared visual direction/);assert.match(prompt,/Login-specific interaction/);assert.doesNotMatch(prompt,/Profile-specific avatar/);}
 run.pageIndex=1;for(const prompt of [managerPrompt(run),builderPrompt(run,'Build')]){assert.match(prompt,/Profile-specific avatar/);assert.doesNotMatch(prompt,/Login-specific interaction/);}
});
