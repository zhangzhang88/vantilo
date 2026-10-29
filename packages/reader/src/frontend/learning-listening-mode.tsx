import { useEffect, useState } from "react";
import type { AssemblyStep, LearningMaterial } from "../shared/learning-material";
import { LearningIcon } from "./learning-game-settings";
function gap(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort",finish); resolve(); };
    const timer = window.setTimeout(finish,milliseconds); signal.addEventListener("abort",finish,{ once: true });
  });
}
/** Original listening mode: active lesson queue from the start, each expression twice. */
export function LearningListeningMode({ queue,material,speakOnce,cancelSpeech,hasSpeech,exit }: { queue: AssemblyStep[]; material: LearningMaterial; speakOnce: (text: string) => Promise<boolean>; cancelSpeech: () => void; hasSpeech: (text: string) => boolean; exit: () => void }) {
  const [index,setIndex] = useState(0), [missing,setMissing] = useState(false);
  useEffect(() => {
    const controller = new AbortController(), { signal } = controller;
    void (async () => {
      // Let StrictMode cancel its first setup before any audible playback starts.
      await Promise.resolve();
      for (const [i,step] of queue.entries()) {
        if (signal.aborted) return;
        setIndex(i);
        if (!hasSpeech(step.english)) { setMissing(true); return; }
        if (!await speakOnce(step.english) || signal.aborted) return;
        await gap(1200,signal); if (signal.aborted) return;
        if (!await speakOnce(step.english) || signal.aborted) return;
        await gap(1000,signal);
      }
    })();
    return () => { controller.abort(); cancelSpeech(); };
  },[queue,hasSpeech,speakOnce,cancelSpeech]);
  const step = queue[index];
  return <section className="worm-listening" role="dialog" aria-modal="true" aria-label="听力模式" onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") exit(); if (event.key === "Tab") { event.preventDefault(); event.currentTarget.querySelector("button")?.focus(); } }}>
    {step && <div className="worm-listening-sentence"><p className="worm-listening-english" lang="en">{step.english}</p><p className="worm-listening-chinese">{step.meaningZh}</p><p className="worm-listening-pronunciation">{material.audio?.pronunciations?.[step.id]}</p></div>}
    {missing && <p role="status">这段朗读尚未准备好，请在阶段选择页补齐朗读音频。</p>}
    <button autoFocus onClick={exit}><LearningIcon name="headphones" />退出听力模式</button>
  </section>;
}
