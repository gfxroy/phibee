import {packager} from '@electron/packager';
const apps=await packager({dir:process.cwd(),name:'Phibee',appBundleId:'local.phibee.desktop',appVersion:'0.3.0',icon:'assets/icon.icns',platform:'darwin',arch:process.arch,out:'release',overwrite:true,asar:{unpack:'**/node-pty/**'},ignore:[/^\/test-artifacts($|\/)/,/^\/release($|\/)/,/^\/\.align-data($|\/)/,/^\/\.git($|\/)/,/^\/tests($|\/)/,/^\/src($|\/)/,/^\/scripts($|\/)/,/^\/node_modules\/\.cache/],prune:true});
for(const p of apps)console.log(p+'/Phibee.app');

