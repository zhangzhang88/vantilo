import { beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { readerSourceRoot } from '../scripts/reader-source-path.mjs';
import { adaptChineseAudioPlayer } from '../scripts/reader-chinese-audio-adapter.mjs';
let audioModule, speechModule;
beforeAll(async () => {
  async function load(file) {
    const result = await build({ entryPoints:[`${readerSourceRoot}/src/frontend/${file}`], bundle:true, write:false, format:'esm', platform:'node',
      plugins:[{name:'adapt-chinese-audio',setup(builder){builder.onLoad({filter:/\.ts$/},async args=>({contents:adaptChineseAudioPlayer(await readFile(args.path,'utf8'),args.path),loader:'ts'}));}}] });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
  }
  audioModule=await load('chinese-audio-player.ts'); speechModule=await load('chinese-listening-state.ts');
});
const flush = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
class FakeAudio {
  currentTime=0; duration=10; playbackRate=1; onended=null; onerror=null; onabort=null; ontimeupdate=null;
  play=vi.fn(async()=>{}); pause=vi.fn(); removeAttribute=vi.fn(); load=vi.fn(); addEventListener(){}
}

describe('continuous Chinese narration',()=>{
  it('prepares following paragraphs while the first is generating, bounded to two requests, and plays them in order',async()=>{
    let active=0,maxActive=0;const requests=[];const audios=[];const phases=[];const positions=[];
    const synthesize=vi.fn((text,signal)=>new Promise((resolve,reject)=>{
      active++;maxActive=Math.max(maxActive,active);
      const done=()=>{active--;resolve(new Blob(['ID3audio']));};
      signal.addEventListener('abort',()=>{active--;reject(new Error('aborted'));},{once:true});
      requests.push({text,done});
    }));
    const player=new audioModule.ChineseAudioPlayer({indices:[0,1,2],getText:async i=>`第${i}段。`,synthesize,
      phase:(...p)=>phases.push(p),position:(...p)=>positions.push(p),createUrl:()=>`blob:${audios.length}`,revokeUrl:()=>{},audio:()=>{const audio=new FakeAudio();audios.push(audio);return audio;}});
    const run=player.start({paragraphIndex:0,chunkIndex:0});await flush();
    expect(requests.map(x=>x.text)).toEqual(['第0段。','第1段。']);expect(maxActive).toBe(2);expect(audios).toHaveLength(0);
    requests[1].done();await flush();expect(requests.map(x=>x.text)).toEqual(['第0段。','第1段。','第2段。']);expect(maxActive).toBe(2);
    requests[0].done();await flush();expect(audios).toHaveLength(1);expect(audios[0].play).toHaveBeenCalledTimes(1);
    requests[2].done();await flush();audios[0].onended();await flush();expect(audios).toHaveLength(2);expect(phases.at(-1)[0]).toBe('playing');
    audios[1].onended();await flush();expect(audios).toHaveLength(3);audios[2].onended();await run;
    expect(phases.at(-1)[0]).toBe('complete');expect(positions.at(-1)[0].paragraphIndex).toBe(2);
  });
  it('stops both active requests and queued preparation without playing stale audio',async()=>{
    const requests=[];const phases=[];const createUrl=vi.fn();
    const player=new audioModule.ChineseAudioPlayer({indices:[0,1,2],getText:async i=>`第${i}段。`,
      synthesize:(text,signal)=>new Promise((_resolve,reject)=>{requests.push(text);signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}),
      phase:(...p)=>phases.push(p),position:()=>{},createUrl,revokeUrl:()=>{},audio:()=>new FakeAudio()});
    const run=player.start({paragraphIndex:0,chunkIndex:0});await flush();expect(requests).toHaveLength(2);
    player.stop();await run;await flush();expect(createUrl).not.toHaveBeenCalled();expect(phases.some(p=>p[0]==='error')).toBe(false);
  });
  it('keeps the current paragraph playing when the next synthesis fails, then reports the failure without skipping it',async()=>{
    vi.useFakeTimers();
    try {
      const audios=[];const phases=[];const calls=[];
      const player=new audioModule.ChineseAudioPlayer({indices:[0,1,2],getText:async i=>`第${i}段。`,
        synthesize:async text=>{calls.push(text);if(text==='第1段。')throw new Error('语音服务不可用');return new Blob(['ID3audio']);},
        phase:(...p)=>phases.push(p),position:()=>{},createUrl:()=>`blob:${audios.length}`,revokeUrl:()=>{},audio:()=>{const audio=new FakeAudio();audios.push(audio);return audio;}});
      const run=player.start({paragraphIndex:0,chunkIndex:0});await flush();
      expect(audios).toHaveLength(1);expect(phases.at(-1)[0]).toBe('playing');
      await vi.advanceTimersByTimeAsync(500);await flush();
      expect(calls.filter(text=>text==='第1段。')).toHaveLength(2);expect(phases.at(-1)[0]).toBe('playing');
      audios[0].onended();await run;
      expect(audios).toHaveLength(1);expect(phases.at(-1)).toEqual(['error','语音服务不可用']);
    } finally { vi.useRealTimers(); }
  });
  it('keeps long Chinese text intact and limits each synthesis segment',()=>{
    const text='这是测试句子。'.repeat(80)+'结尾';const chunks=speechModule.splitChineseSpeech(text);
    expect(chunks.join('')).toBe(text);expect(chunks.every(chunk=>Array.from(chunk).length<=200)).toBe(true);
    expect(chunks.length).toBeLessThan(speechModule.splitChineseSpeech(text,130).length);
    const punctuated = '甲'.repeat(120)+'。'+'乙'.repeat(190)+'。';
    expect(speechModule.splitChineseSpeech(punctuated)[0]).toBe('甲'.repeat(120)+'。');
  });
  it('resumes an old segment safely when the new split boundaries differ',async()=>{
    const positions=[];const audios=[];const text='第一句。'.repeat(80);
    const player=new audioModule.ChineseAudioPlayer({indices:[0],getText:async()=>text,synthesize:async()=>new Blob(['ID3audio']),
      phase:()=>{},position:(...p)=>positions.push(p),createUrl:()=>`blob:${audios.length}`,revokeUrl:()=>{},audio:()=>{const audio=new FakeAudio();audios.push(audio);return audio;}});
    const run=player.start({paragraphIndex:0,chunkIndex:1,chunkText:'旧分段',seconds:6});await flush();
    expect(positions[0][0]).toMatchObject({paragraphIndex:0,chunkIndex:0,seconds:0});
    player.stop();await run;
  });
});
