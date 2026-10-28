import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const resources=path.join(repo,'resources');
const svg=path.join(resources,'vantilo-icon.svg');
const png=path.join(resources,'vantilo-icon.png');
const icns=path.join(resources,'vantilo.icns');
execFileSync('/usr/bin/sips',['-s','format','png',svg,'--out',png],{stdio:'inherit'});
const tempRoot=await fs.mkdtemp(path.join(os.tmpdir(),'vantilo-iconset-'));
const iconset=path.join(tempRoot,'Vantilo.iconset');
await fs.mkdir(iconset);
try {
  const variants=[
    ['icon_16x16.png',16],['icon_16x16@2x.png',32],
    ['icon_32x32.png',32],['icon_32x32@2x.png',64],
    ['icon_128x128.png',128],['icon_128x128@2x.png',256],
    ['icon_256x256.png',256],['icon_256x256@2x.png',512],
    ['icon_512x512.png',512],['icon_512x512@2x.png',1024],
  ];
  for(const [name,size] of variants)execFileSync('/usr/bin/sips',['-z',String(size),String(size),png,'--out',path.join(iconset,name)],{stdio:'ignore'});
  execFileSync('/usr/bin/iconutil',['-c','icns','-o',icns,iconset],{stdio:'inherit'});
} finally {
  await fs.rm(tempRoot,{recursive:true,force:true});
}
console.log('Generated Vantilo PNG and macOS ICNS icons from resources/vantilo-icon.svg');
