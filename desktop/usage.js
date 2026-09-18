import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function readClaudeProjectUsage(projectDir, sessionId = ''){
  try{
    if(!projectDir)return null;
    let cleanDir = projectDir;
    const alignMatch = cleanDir.match(/^(.*?)[/\\]\.align(?:[/\\]|$)/);
    if (alignMatch && alignMatch[1]) {
      cleanDir = alignMatch[1];
    }
    const slug = cleanDir.replace(/[:\\/]+/g, '-');
    let claudeProjDir = path.join(os.homedir(), '.claude', 'projects', slug);
    let stat = await fs.stat(claudeProjDir).catch(() => null);
    if ((!stat || !stat.isDirectory()) && slug.startsWith('-')) {
      const alt = path.join(os.homedir(), '.claude', 'projects', slug.replace(/^-+/, ''));
      const altStat = await fs.stat(alt).catch(() => null);
      if (altStat?.isDirectory()) {
        claudeProjDir = alt;
        stat = altStat;
      }
    }
    if (!stat || !stat.isDirectory()) {
      const base = path.join(os.homedir(), '.claude', 'projects');
      const entries = await fs.readdir(base).catch(() => []);
      const folderName = path.basename(cleanDir);
      const match = entries.find(e => e.endsWith(folderName) || (slug.length > 15 && e.includes(slug.slice(-18))));
      if (match) {
        claudeProjDir = path.join(base, match);
        stat = await fs.stat(claudeProjDir).catch(() => null);
      }
    }
    if (!stat || !stat.isDirectory()) return null;
    const files=await fs.readdir(claudeProjDir).catch(()=>[]);
    const jsonlFiles=files.filter(f=>f.endsWith('.jsonl'));
    if(!jsonlFiles.length)return null;
    let targetFile=null;
    if(sessionId){
      targetFile=jsonlFiles.find(f=>f.startsWith(sessionId)||f.includes(sessionId));
    }
    if(!targetFile){
      let latestMtime=0;
      for(const f of jsonlFiles){
        const s=await fs.stat(path.join(claudeProjDir,f)).catch(()=>null);
        if(s&&s.mtimeMs>latestMtime){
          latestMtime=s.mtimeMs;
          targetFile=f;
        }
      }
    }
    if(!targetFile)return null;
    const raw=await fs.readFile(path.join(claudeProjDir,targetFile),'utf8');
    const lines=raw.trim().split('\n');

    // 1. Check cumulative cost-state from the latest event backwards
    for(let i=lines.length-1;i>=0;i--){
      try{
        const ev=JSON.parse(lines[i]);
        if(ev.type==='cost-state'&&ev.modelUsage){
          let totalInput=0,totalOutput=0;
          for(const m of Object.values(ev.modelUsage)){
            totalInput+=(m.inputTokens??m.input_tokens??0)+
                        (m.cacheReadInputTokens??m.cache_read_input_tokens??0)+
                        (m.cacheCreationInputTokens??m.cache_creation_input_tokens??0);
            totalOutput+=(m.outputTokens??m.output_tokens??0)+
                         (m.thinkingTokens??m.thinking_tokens??0);
          }
          if(totalInput>0||totalOutput>0){
            return {input:totalInput,output:totalOutput};
          }
        }
      }catch{}
    }

    // 2. Fallback: Sum assistant message usage entries (for streaming turns or Bedrock sessions where cost-state has not yet written)
    let sumInput=0,sumOutput=0;
    for(const line of lines){
      try{
        const ev=JSON.parse(line);
        if(ev.type==='assistant'&&ev.message?.usage){
          const u=ev.message.usage;
          sumInput+=(u.input_tokens??u.inputTokens??0)+
                    (u.cache_read_input_tokens??u.cacheReadInputTokens??0)+
                    (u.cache_creation_input_tokens??u.cacheCreationInputTokens??0);
          sumOutput+=(u.output_tokens??u.outputTokens??0)+
                     (u.output_tokens_details?.thinking_tokens??u.thinkingTokens??0);
        }
      }catch{}
    }
    if(sumInput>0||sumOutput>0){
      return {input:sumInput,output:sumOutput};
    }
  }catch{}
  return null;
}

export function extractTerminalTokens(text){
  if(!text||typeof text!=='string')return null;
  const clean=text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\].*?(\x07|\x1b\\)/g,'').replace(/\r/g,'');
  let latest=null;
  const r1=/Tokens:\s*([0-9,]+)\s*(?:in|input)\s*[·•,/-]\s*([0-9,]+)\s*(?:out|output)/gi;
  let m;
  while((m=r1.exec(clean))!==null){
    const i=parseInt(m[1].replace(/,/g,''),10),o=parseInt(m[2].replace(/,/g,''),10);
    if(Number.isFinite(i)&&Number.isFinite(o))latest={input:i,output:o};
  }
  const r2=/(?:input|prompt)\s*(?:tokens?)?[:\s]+([0-9,]+)[^\n\r]*?(?:output|completion)\s*(?:tokens?)?[:\s]+([0-9,]+)/gi;
  while((m=r2.exec(clean))!==null){
    const i=parseInt(m[1].replace(/,/g,''),10),o=parseInt(m[2].replace(/,/g,''),10);
    if(Number.isFinite(i)&&Number.isFinite(o))latest={input:i,output:o};
  }
  const r3=/([0-9,]+)\s*(?:input|in)\s*(?:tokens?)?,\s*([0-9,]+)\s*(?:output|out)\s*(?:tokens?)?/gi;
  while((m=r3.exec(clean))!==null){
    const i=parseInt(m[1].replace(/,/g,''),10),o=parseInt(m[2].replace(/,/g,''),10);
    if(Number.isFinite(i)&&Number.isFinite(o))latest={input:i,output:o};
  }
  if(!latest){
    const r4=/total\s+tokens?[:\s]+([0-9,]+)/gi;
    while((m=r4.exec(clean))!==null){
      const total=parseInt(m[1].replace(/,/g,''),10);
      if(Number.isFinite(total))latest={input:Math.round(total*0.75),output:Math.round(total*0.25)};
    }
  }
  return latest;
}

export function countTokens(text){
  if(!text||typeof text!=='string')return 0;
  const clean=text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\].*?(\x07|\x1b\\)/g,'').replace(/\r/g,'').trim();
  if(!clean)return 0;
  const pattern=/'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
  const matches=clean.match(pattern);
  if(!matches)return Math.ceil(clean.length/3.7);
  let tokens=0;
  for(const m of matches){
    if(m.length<=4)tokens+=1;
    else tokens+=Math.ceil(m.length/3.7);
  }
  return tokens;
}

export async function collectUsage(directory,previous={},options={}){
  const sessions={...previous.sessions};
  const roles=['manager','builder','responsive'];
  const terminalTokens={manager:null,builder:null,responsive:null};
  const manualInput={manager:0,builder:0,responsive:0};
  const manualOutput={manager:0,builder:0,responsive:0};

  // 1. Check for provider-reported usage files
  for(const role of roles){
    const dir=path.join(directory,'usage',role);
    for(const file of await fs.readdir(dir).catch(()=>[])){
      if(!file.endsWith('.json'))continue;
      try{
        const p=path.join(dir,file);
        const st=await fs.lstat(p);
        if(!st.isFile()||st.size>10000)continue;
        const r=JSON.parse(await fs.readFile(p,'utf8'));
        if(r.role!==role||!Number.isFinite(r.input)||!Number.isFinite(r.output)||r.input<0||r.output<0||typeof r.session!=='string')continue;
        const key=role+':'+r.session,old=sessions[key];
        sessions[key]={...r,input:Math.max(old?.input||0,r.input),output:Math.max(old?.output||0,r.output)};
      }catch{}
    }
  }

  // 2. Scan terminal logs for exact token output statements printed by CLI
  for(const role of roles){
    try{
      const logPath=path.join(directory,'logs',role+'.log');
      const text=await fs.readFile(logPath,'utf8').catch(()=>'');
      if(text){
        const extracted=extractTerminalTokens(text);
        if(extracted){
          terminalTokens[role]=extracted;
        }else{
          // Fallback clean token estimation without terminal spinner redraws
          const lines=text.split('\n').filter(l=>l.trim().length>0);
          const deduped=[];
          let last='';
          for(const l of lines){
            const c=l.trim();
            if(c!==last&&!c.startsWith('\x1b[')&&!c.includes('Waiting for the manager to retrieve Figma context')&&!c.includes('SESSION MEMORY LOADED')&&!c.includes('Session paused at this exact state')){
              deduped.push(c);
              last=c;
            }
          }
          if(deduped.length>0){
            manualOutput[role]=countTokens(deduped.join('\n'));
          }
        }
      }
    }catch{}
  }

  // 3. Scan events.jsonl for prompt input tokens across providers
  try{
    const eventsPath=path.join(directory,'logs','events.jsonl');
    const content=await fs.readFile(eventsPath,'utf8').catch(()=>'');
    if(content){
      for(const line of content.split('\n')){
        if(!line.trim())continue;
        try{
          const ev=JSON.parse(line);
          if(ev.type==='prompt'&&ev.role&&ev.prompt){
            manualInput[ev.role]=(manualInput[ev.role]||0)+countTokens(ev.prompt);
          }
        }catch{}
      }
    }
  }catch{}

  const result={sessions,manager:{input:0,output:0,reported:false},builder:{input:0,output:0,reported:false},responsive:{input:0,output:0,reported:false},input:0,output:0};
  for(const s of Object.values(sessions)){
    if(s&&result[s.role]){
      result[s.role].input+=s.input||0;
      result[s.role].output+=s.output||0;
      result[s.role].reported=true;
    }
  }

  // Priority order: 1) Provider files -> 2) Exact terminal CLI tokens -> 3) Role-specific Claude cost metrics -> 4) Manual log tokens
  for(const role of roles){
    if(result[role].reported){
      continue;
    }

    if(terminalTokens[role]){
      result[role].input=terminalTokens[role].input;
      result[role].output=terminalTokens[role].output;
      result[role].reported=true;
      continue;
    }

    const roleProvider=role==='responsive'
      ?(options.project?.responsiveProvider||options.run?.project?.responsiveProvider||options.project?.builder||options.run?.project?.builder||null)
      :(options.project?.[role]||(options.run?.project?options.run.project[role]:null));

    const roleSession=options.sessions?.[`claude:${role}`]||(roleProvider==='claude'?options.sessions?.[role]:null);
    if(roleProvider==='claude'||roleSession){
      const claudeUsage=await readClaudeProjectUsage(directory,roleSession||'');
      if(claudeUsage&&(claudeUsage.input>0||claudeUsage.output>0)){
        result[role].input=claudeUsage.input;
        result[role].output=claudeUsage.output;
        result[role].reported=true;
        continue;
      }
    }

    const roleHasActivity=(manualInput[role]>0)||(manualOutput[role]>0);
    if(!roleHasActivity){
      result[role].input=0;
      result[role].output=0;
      result[role].reported=false;
      continue;
    }

    result[role].input=manualInput[role]||0;
    result[role].output=manualOutput[role]||0;
    if(result[role].input>0||result[role].output>0){
      result[role].reported=true;
    }
  }

  result.input=result.manager.input+result.builder.input+result.responsive.input;
  result.output=result.manager.output+result.builder.output+result.responsive.output;
  return result;
}
