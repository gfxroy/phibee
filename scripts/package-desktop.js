import {packager} from '@electron/packager';
import {execFileSync} from 'node:child_process';
const apps=await packager({dir:process.cwd(),name:'Phibee',appBundleId:'local.phibee.desktop',appVersion:'0.3.0',icon:'assets/icon.icns',platform:process.platform,arch:process.arch,out:'release',overwrite:true,asar:{unpack:'**/node-pty/**'},ignore:[/^\/(test-artifacts|release|output|landing|\.git|\.github|tests|src|scripts|\.align-data)($|\/)/,/^\/node_modules\/\.cache/],prune:true});
for(const p of apps){
  if(process.platform==='darwin')execFileSync('codesign',['--force','--deep','--sign','-',`${p}/Phibee.app`],{stdio:'inherit'});
  console.log(p);
}

