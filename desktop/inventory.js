import fs from 'node:fs/promises';
import path from 'node:path';
import {pageDirectory} from './prompts.js';
export async function writeInventory(run){
 const root=run.project.directory,entries=await fs.readdir(root,{withFileTypes:true});let pkg=null;try{const p=await fs.readFile(path.join(root,'package.json'),'utf8');if(p.length<100000)pkg=JSON.parse(p);}catch{}
 const inventory={root,observedAt:new Date().toISOString(),entries:entries.filter(e=>!['.align','.git','node_modules'].includes(e.name)).map(e=>({name:e.name,type:e.isDirectory()?'directory':e.isSymbolicLink()?'symlink':'file'})),package:pkg?{scripts:pkg.scripts,dependencies:pkg.dependencies,devDependencies:pkg.devDependencies}:null,assets:'asset-map.json',note:'Snapshot at handoff. Inspect files or refresh checks when implementation changes; this is not verification.'};
 await fs.writeFile(path.join(pageDirectory(run),'project-inventory.json'),JSON.stringify(inventory));return inventory;
}
