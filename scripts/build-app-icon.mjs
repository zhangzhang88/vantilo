import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const resources=path.join(repo,'resources');
const png=path.join(resources,'vantilo-icon.png');
const icns=path.join(resources,'vantilo.icns');

await fs.access(png);
const metadata=execFileSync('/usr/bin/sips',['-g','pixelWidth','-g','pixelHeight','-g','hasAlpha',png],{encoding:'utf8'});
const width=Number(metadata.match(/pixelWidth:\s*(\d+)/)?.[1]??0);
const height=Number(metadata.match(/pixelHeight:\s*(\d+)/)?.[1]??0);
const hasAlpha=metadata.match(/hasAlpha:\s*(\w+)/)?.[1]??'';
if(width!==1024||height!==1024||hasAlpha!=='yes'){
  throw new Error(`Expected resources/vantilo-icon.png to be a 1024x1024 RGBA PNG with alpha, got ${width}x${height} (hasAlpha=${hasAlpha||'unknown'})`);
}

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
console.log('Generated macOS ICNS icon from resources/vantilo-icon.png');
