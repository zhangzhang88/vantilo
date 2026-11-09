// Canonical Vantilo game audio assets. No dependency on a sibling repository
// or test-only environment variables. Source and built copies are SHA-256 checked.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const ORIGINAL_GAME_SOUND_HASHES=Object.freeze({
  'typing.mp3':'6a76b3ec259fc1b615950e93fce8bfd86e3b7d6e2ee5f9f041b2f2e1c156afb2',
  'correct.mp3':'0281b156f9b155e02044c3175bf4355e6cf1ebcdde119a7043204da6ef6a405f',
  'error.mp3':'7974d8227ed7c320b6ea1012e3c97ef729da33b6bbf491c8024a58c9dcb4d0f7',
});

export async function verifyOriginalGameSoundDirectory(directory) {
  const verified=new Map();
  for(const [name, expected] of Object.entries(ORIGINAL_GAME_SOUND_HASHES)){
    let bytes;
    try{bytes=await fs.readFile(path.join(directory,name));}
    catch{throw new Error(`Missing original game audio ${name} in ${directory}. Restore packages/reader/assets/worm before building.`);}
    const actual=createHash('sha256').update(bytes).digest('hex');
    if(actual!==expected)throw new Error(`Original game audio hash mismatch: ${name}. Refusing to package altered sound.`);
    verified.set(name,bytes);
  }
  return verified;
}

export async function copyOriginalGameSoundsToWeb(webRoot) {
  // Validate all three input files before touching the output tree.
  const source=path.join(repo,'packages/reader/assets/worm');
  const verified=await verifyOriginalGameSoundDirectory(source);
  const dest=path.join(webRoot,'worm');
  await fs.mkdir(dest,{recursive:true});
  for(const [name,bytes] of verified)await fs.writeFile(path.join(dest,name),bytes,{mode:0o644});
  await verifyOriginalGameSoundDirectory(dest);
}

export async function assertBundledOriginalGameSounds(webRoot) {
  await verifyOriginalGameSoundDirectory(path.join(webRoot,'worm'));
}
