import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Explicit workspace grants also feed Antigravity's macOS sandbox mounts.
// Keep existing deny/ask rules and never grant unsandboxed command execution.
export async function prepareWorkspaceAccess(directory,settingsFile=path.join(os.homedir(),'.gemini/antigravity-cli/settings.json')){
  const root=await fs.realpath(directory);
  if(root===path.parse(root).root||root===os.homedir()||/[\r\n()]/.test(root))throw Error('Choose a dedicated project folder for autonomous execution.');
  let raw;try{raw=await fs.readFile(settingsFile,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;raw='{}';}
  const settings=JSON.parse(raw),permissions=settings.permissions||{};
  const allow=[...new Set([...(permissions.allow||[]),`write_file(${root})`,'read_url(registry.npmjs.org)','read_url(localhost)','read_url(127.0.0.1)','execute_url(localhost)','execute_url(127.0.0.1)','mcp(align-figma-export/read_design_context)','mcp(align-figma-export/prepare_design_bundle)','mcp(align-figma-export/get_screenshot)','mcp(align-figma-export/submit_builder_prompt)'])];
  const next={...settings,enableTerminalSandbox:true,toolPermission:'proceed-in-sandbox',artifactReviewPolicy:'always-proceed',permissions:{...permissions,allow}};
  if(JSON.stringify(next)!==JSON.stringify(settings)){
    await fs.mkdir(path.dirname(settingsFile),{recursive:true});
    await fs.writeFile(settingsFile+'.align-workspace-backup-'+Date.now(),raw,{mode:0o600});
    const temp=settingsFile+'.align-'+process.pid+'.tmp';await fs.writeFile(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600});await fs.rename(temp,settingsFile);
  }
  return root;
}
