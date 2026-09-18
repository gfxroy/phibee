import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {command,executable} from '../server/providers.js';
export function modelArgs(model){if(!model)return [];if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(model))throw Error('Enter a valid provider model ID.');return ['--model',model];}
export const DEFAULT_ANTIGRAVITY_MODELS = [
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', badge: 'Recommended', category: 'flash' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)', badge: 'Fast', category: 'flash' },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)', category: 'flash' },
  { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)', badge: 'Thinking', category: 'flash' },
  { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)', category: 'flash' },
  { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)', category: 'flash' },
  { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)', category: 'flash' },
  { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)', category: 'flash' },
  { id: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (Low)', category: 'flash' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)', badge: 'Reasoning', category: 'pro' },
  { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)', category: 'pro' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)', badge: 'Thinking', category: 'claude' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)', badge: 'Deep', category: 'claude' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)', category: 'oss' }
];

export const DEFAULT_CLAUDE_MODELS = [
  { id: 'sonnet', label: 'Claude Sonnet 5', badge: 'Recommended', category: 'sonnet' },
  { id: 'opus', label: 'Claude Opus 5', badge: 'Reasoning', category: 'opus' },
  { id: 'fable', label: 'Claude Fable 5.1', badge: 'Frontier', category: 'fable' },
  { id: 'haiku', label: 'Claude Haiku 4.5', badge: 'Fast', category: 'haiku' }
];

export const DEFAULT_CODEX_MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o', badge: 'Recommended', category: 'gpt' },
  { id: 'o3-mini', label: 'o3-mini', badge: 'Reasoning', category: 'reasoning' },
  { id: 'o1', label: 'o1', badge: 'Deep', category: 'reasoning' }
];

export async function listModels(provider){
  if(provider==='antigravity'){
    try{
      const bin=await executable(provider);
      if(bin){
        const {output}=await command(bin,['models'],{timeout:20000});
        const parsed=output.split('\n')
          .map(s=>s.trim().split(/\t+|\s{2,}/))
          .filter(a=>a.length>=2&&/^[a-zA-Z0-9._:/-]+$/.test(a[0]))
          .map(([id,label])=>{
            const matched=DEFAULT_ANTIGRAVITY_MODELS.find(m=>m.id===id);
            return {id,label:label||id,badge:matched?.badge||'',category:matched?.category||'general'};
          });
        if(parsed.length>0){
          // Merge with any defaults not in output
          const ids=new Set(parsed.map(p=>p.id));
          for(const def of DEFAULT_ANTIGRAVITY_MODELS){
            if(!ids.has(def.id))parsed.push(def);
          }
          return parsed;
        }
      }
    }catch{}
    return DEFAULT_ANTIGRAVITY_MODELS;
  }
  if(provider==='codex'){
    try{
      const cache=JSON.parse(await fs.readFile(path.join(os.homedir(),'.codex','models_cache.json'),'utf8'));
      const list=(cache.models||[]).filter(m=>m.slug).map(m=>{
        const matched=DEFAULT_CODEX_MODELS.find(d=>d.id===m.slug);
        return {id:m.slug,label:m.display_name||m.slug,badge:matched?.badge||'',category:matched?.category||'gpt'};
      });
      if(list.length)return list;
    }catch{}
    return DEFAULT_CODEX_MODELS;
  }
  if(provider==='claude')return DEFAULT_CLAUDE_MODELS;
  return [];
}
