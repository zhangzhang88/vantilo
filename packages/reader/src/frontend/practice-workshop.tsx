import { useEffect, useRef, useState } from "react";
import type { AiProviderSettingsPublic } from "../shared/types";
import type { BookLesson } from "../shared/book-lesson";
import { createBasicMaterial } from "../shared/basic-learning";
import { parseOrderedExercises, type OrderedExercise } from "../shared/ordered-practice";
import { parseWorkshopVocabulary, type WorkshopVocabulary } from "../shared/workshop-vocabulary";
import { fetchAiProviderSettings } from "./api";
import { AiProviderSettingsPanel } from "./ai-provider-settings-panel";
import { AssemblyTypingGame } from "./assembly-typing-game";
import { VocabularySelection } from "./vocabulary-selection";
import { VocabularyPreparationGame } from "./vocabulary-preparation-game";
import { LearningStageCompletion } from "./learning-stage-completion";
import { newLearningProgress, type LearningProgress } from "./learning-state";
import { startLearning } from "./learning-state";
import { orderedPracticeMaterial } from "./ordered-practice-adapter";
import { workshopVocabularyMaterial } from "./workshop-vocabulary-adapter";
import { loadSavedVocabularyPractices, saveSavedVocabularyPractices, saveVocabularyWorkshopPrompt, PRACTICE_WORKSHOP_VOCABULARY_PROMPT_KEY, type SavedVocabularyPractice } from "./workshop-vocabulary-storage";
import { getReaderStorage } from "./reader-storage";
import { loadSavedPractices, saveSavedPractices, saveWorkshopPrompt, PRACTICE_WORKSHOP_PROMPT_KEY, type SavedPractice } from "./practice-workshop-storage";
import type { LearningMaterial } from "../shared/learning-material";
import { ensureVisibleWorkshopTitleRule } from "../shared/workshop-title";
import "./practice-workshop.css";
import "./practice-lab-native.css";

type ProviderChoice = "vantilo-custom-api" | "deepseek" | "profile";
type VantiloCustomApiProfile = { id: string; name: string; model: string; hasApiKey?: boolean };
type PracticeMode = "vocabulary" | "assembly";
const MODE_KEY = "vantilo:practice-workshop-selected-mode:v1";

export function PracticeWorkshop() {
  const [article,setArticle] = useState("");
  const [title,setTitle] = useState("我的英语练习");
  const manuallyNamed=useRef<Record<PracticeMode,boolean>>({vocabulary:false,assembly:false});
  const editMode=useRef<PracticeMode|null>(null);
  const [editRevision,setEditRevision]=useState(0);
  const [saveStatus,setSaveStatus]=useState<"idle"|"saving"|"saved"|"error">("idle");
  const [renaming,setRenaming]=useState<{mode:PracticeMode;id:string;value:string}|null>(null);
  const [pendingDeletion,setPendingDeletion]=useState<{mode:PracticeMode;id:string}|null>(null);
  const [stage,setStage] = useState<PracticeMode | null>(null);
  const drafts=useRef<Partial<Record<PracticeMode,{article:string;title:string}>>>({});
  const [vocabularySource,setVocabularySource]=useState<string|null>(null);
  const [assemblySource,setAssemblySource]=useState<string|null>(null);
  const [vocabularyPrompt,setVocabularyPrompt] = useState("");
  const [originalVocabularyPrompt,setOriginalVocabularyPrompt] = useState("");
  const [vocabulary,setVocabulary] = useState<WorkshopVocabulary[]>([]);
  const [savedVocabulary,setSavedVocabulary] = useState<SavedVocabularyPractice[]>([]);
  const [currentVocabularyId,setCurrentVocabularyId] = useState<string|null>(null);
  const [prompt,setPrompt] = useState("");
  const [originalPrompt,setOriginalPrompt] = useState("");
  const [provider,setProvider] = useState<ProviderChoice>("vantilo-custom-api");
  const [vantiloApiAvailable,setVantiloApiAvailable] = useState(false);
  const [legacyAiAvailable,setLegacyAiAvailable] = useState(false);
  const [vantiloProfiles,setVantiloProfiles] = useState<VantiloCustomApiProfile[]>([]);
  const [vantiloProfileId,setVantiloProfileId] = useState("");
  const [profileId,setProfileId] = useState("");
  const [deepseekModel,setDeepseekModel] = useState("deepseek-chat");
  const [apiKey,setApiKey] = useState("");
  const [profiles,setProfiles] = useState<AiProviderSettingsPublic | null>(null);
  const [exercises,setExercises] = useState<OrderedExercise[]>([]);
  const [saved,setSaved] = useState<SavedPractice[]>([]);
  const [currentId,setCurrentId] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [material,setMaterial] = useState<LearningMaterial | null>(null);
  const [progress,setProgress] = useState<LearningProgress | null>(null);
  const [storageReady,setStorageReady] = useState(false);
  const [assemblyLoadError,setAssemblyLoadError]=useState("");
  const [vocabularyLoadError,setVocabularyLoadError]=useState("");

  async function refreshVantiloProfiles() {
    try {
      const response = await fetch("/api/vantilo-custom-api/settings", { cache: "no-store" });
      if (!response.ok) return false;
      const data = await response.json() as { activeId?: string; profiles?: VantiloCustomApiProfile[] };
      const list = Array.isArray(data.profiles) ? data.profiles : [];
      setVantiloApiAvailable(true);
      setVantiloProfiles(list);
      setVantiloProfileId(current => list.some(item => item.id === current) ? current : (data.activeId && list.some(item => item.id === data.activeId) ? data.activeId : list[0]?.id ?? ""));
      return true;
    } catch { return false; }
  }
  async function refreshProfiles() {
    const vantiloOk = await refreshVantiloProfiles();
    if (!legacyAiAvailable && vantiloOk) return;
    try {
      const next = await fetchAiProviderSettings();
      setLegacyAiAvailable(true);
      setProfiles(next);
    } catch {
      if (!vantiloOk) setError("无法读取自定义 API 配置，请检查 Reader 服务");
    }
  }
  useEffect(() => {
    let active = true;
    const storage=getReaderStorage();
    try{
      const remembered=storage.getItem(MODE_KEY);
      if(!storage.getSnapshot().readFailed && (remembered==="assembly"||remembered==="vocabulary"))setStage(remembered);
    }catch{/* View preference must never prevent loading saved exercises. */}
    try{
      if(storage.getSnapshot().readFailed)throw new Error("本机练习存储不可读，已停止写入");
      try{setSaved(loadSavedPractices(storage));}catch(cause){setAssemblyLoadError(cause instanceof Error?cause.message:"句子组装存档不可读");}
      try{setSavedVocabulary(loadSavedVocabularyPractices(storage));}catch(cause){setVocabularyLoadError(cause instanceof Error?cause.message:"原文填词存档不可读");}
      setStorageReady(true);
    }catch(cause){setError(cause instanceof Error?cause.message:"练习存储不可读");}
    void fetch("/api/practice-workshop/prompt").then(async response => {
      if (!response.ok) throw new Error("无法读取句子组装生成规则");
      return response.json() as Promise<{ prompt:string }>;
    }).then(value => {
      if (!active) return;
      const prior=storage.getItem(PRACTICE_WORKSHOP_PROMPT_KEY);
      if(storage.getSnapshot().readFailed)throw new Error("无法读取句子组装生成规则");
      setOriginalPrompt(ensureVisibleWorkshopTitleRule(value.prompt));
      setPrompt(ensureVisibleWorkshopTitleRule(prior??value.prompt));
    }).catch(cause => { if (active) setAssemblyLoadError(cause instanceof Error?cause.message:"句子组装生成规则加载失败"); });
    void refreshVantiloProfiles().then(available => { if (active && !available) setProvider("profile"); });
    const onCustomApiUpdated = () => { void refreshVantiloProfiles(); };
    window.addEventListener("vantilo-custom-api-updated", onCustomApiUpdated);
    void fetchAiProviderSettings().then(value => {
      if (!active) return;
      setLegacyAiAvailable(true);
      setProfiles(value);
      setProfileId(value.activeProfileId ?? value.profiles[0]?.id ?? "");
    }).catch(() => {});
    return () => { active = false; window.removeEventListener("vantilo-custom-api-updated", onCustomApiUpdated); };
  }, []);
  useEffect(()=>{
    if(stage!=="vocabulary"||originalVocabularyPrompt)return;
    let active=true;
    void fetch("/api/practice-workshop/vocabulary-prompt").then(async response=>{
      if(!response.ok)throw new Error("无法读取原文填词生成规则");
      return response.json() as Promise<{prompt:string}>;
    }).then(value=>{
      if(!active)return;
      const storage=getReaderStorage();
      const prior=storage.getItem(PRACTICE_WORKSHOP_VOCABULARY_PROMPT_KEY);
      if(storage.getSnapshot().readFailed)throw new Error("无法读取原文填词生成规则");
      setOriginalVocabularyPrompt(ensureVisibleWorkshopTitleRule(value.prompt));
      setVocabularyPrompt(ensureVisibleWorkshopTitleRule(prior??value.prompt));
    }).catch(cause=>{if(active)setVocabularyLoadError(cause instanceof Error?cause.message:"原文填词生成规则加载失败");});
    return ()=>{active=false;};
  },[stage,originalVocabularyPrompt]);

  function chooseMode(next:PracticeMode) {
    if (busy || stage===next) return;
    if(stage)drafts.current[stage]={article,title};
    const draft=drafts.current[next];
    if(draft){setArticle(draft.article);setTitle(draft.title);}
    else drafts.current[next]={article,title};
    setStage(next);setError("");setNotice("");setRenaming(null);setPendingDeletion(null);editMode.current=null;setSaveStatus("idle");
    try{getReaderStorage().setItem(MODE_KEY,next);}catch{/* Selection works without persistence. */}
  }
  function updateArticle(value:string) {
    setArticle(value);
    if(stage)drafts.current[stage]={article:value,title};
  }
  function updateTitle(value:string) {
    setTitle(value);
    if(stage){manuallyNamed.current[stage]=true;drafts.current[stage]={article,title:value};markEdited();}
  }
  function markEdited() {
    if(!stage)return;
    editMode.current=stage;
    setEditRevision(n=>n+1);
    setError("");setNotice("");
    const id=stage==="vocabulary"?currentVocabularyId:currentId;
    if(id)setSaveStatus("saving");
  }
  const currentSource=stage==="vocabulary"?vocabularySource:stage==="assembly"?assemblySource:null;
  const currentResultCount=stage==="vocabulary"?vocabulary.length:stage==="assembly"?exercises.length:0;
  const sourceMismatch=!!(currentResultCount&&currentSource!==null&&article!==currentSource);
  const currentModeLabel=stage==="vocabulary"?"原文填词":stage==="assembly"?"句子组装":"";
  const providerLabel=provider==="vantilo-custom-api"?(vantiloProfiles.find(item=>item.id===vantiloProfileId)?.name??"AI 模型服务"):provider==="deepseek"?"DeepSeek":profiles?.profiles.find(item=>item.id===profileId)?.name??"AI 模型服务";

  const resolveGeneratedTitle=(mode:PracticeMode,suggestion:unknown)=>{
    const fromAi=typeof suggestion==="string"&&suggestion.trim().length<=30&&/[\u3400-\u9fff]/.test(suggestion)?suggestion.trim():null;
    return manuallyNamed.current[mode]&&title.trim()?title.trim():fromAi??"我的英语练习";
  };
  const activeProviderLabel=()=>provider==="deepseek"?`DeepSeek · ${deepseekModel}`:provider==="vantilo-custom-api"?(vantiloProfiles.find(item=>item.id===vantiloProfileId)?.name??"AI 模型服务"):profiles?.profiles.find(item=>item.id===profileId)?.name??"AI 模型服务";
  function commitVocabulary(items:WorkshopVocabulary[],name:string,source:string,rule:string,id:string|null,label:string):string {
    const validated=parseWorkshopVocabulary(items,source);
    if(!name.trim()||name.length>200||!rule||rule.length>16000)throw new Error("标题或原文填词生成规则无效");
    const now=new Date().toISOString(),targetId=id??crypto.randomUUID();
    const old=savedVocabulary.find(item=>item.id===targetId);
    const record:SavedVocabularyPractice={id:targetId,title:name.trim(),article:source,prompt:rule,providerLabel:old?.providerLabel??label,
      vocabulary:validated,createdAt:old?.createdAt??now,updatedAt:now};
    const next=[record,...savedVocabulary.filter(item=>item.id!==targetId)];
    saveSavedVocabularyPractices(next);setSavedVocabulary(next);setCurrentVocabularyId(targetId);
    return targetId;
  }
  function commitAssembly(items:OrderedExercise[],name:string,source:string,rule:string,id:string|null,label:string):string {
    const validated=parseOrderedExercises(items,{requirePronunciation:true});
    if(!source.trim()||source.length>2000||!name.trim()||name.length>200||rule.length>16000)throw new Error("文章、标题或句子组装生成规则无效");
    const now=new Date().toISOString(),targetId=id??crypto.randomUUID();
    const old=saved.find(item=>item.id===targetId);
    const record:SavedPractice={id:targetId,title:name.trim(),article:source,prompt:rule,providerLabel:old?.providerLabel??label,
      exercises:validated,createdAt:old?.createdAt??now,updatedAt:now};
    const next=[record,...saved.filter(item=>item.id!==targetId)];
    saveSavedPractices(next);setSaved(next);setCurrentId(targetId);
    return targetId;
  }
  async function generate() {
    setError(""); setNotice(""); setBusy(true);
    if(!stage){setError("请先选择一种练习方式");setBusy(false);return;}
    try {
      const response = await fetch("/api/practice-workshop/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage,article, prompt:stage==="vocabulary"?vocabularyPrompt:prompt, provider,
          ...(provider === "vantilo-custom-api" ? { profileId: vantiloProfileId } : {}),
          ...(provider === "profile" ? { profileId } : {}),
          ...(provider === "deepseek" ? { apiKey,deepseekModel } : {}) }),
      });
      const value = await response.json().catch(() => ({})) as { exercises?: unknown; vocabulary?: unknown; titleZh?: unknown; error?: string };
      if (!response.ok) throw new Error(value.error || "AI 生成失败");
      if(stage==="vocabulary"){
        const generated=parseWorkshopVocabulary(value.vocabulary,article).map(({sentenceIndex,sentence,word,occurrence,meaningZh,sentenceMeaningZh,pronunciation})=>({sentenceIndex,sentence,word,occurrence,meaningZh,sentenceMeaningZh,pronunciation}));
        const chosenTitle=resolveGeneratedTitle("vocabulary",value.titleZh);
        setVocabulary(generated);setVocabularySource(article);setCurrentVocabularyId(null);setTitle(chosenTitle);
        drafts.current.vocabulary={article,title:chosenTitle};
        editMode.current=null;setSaveStatus("idle");
        try{
          commitVocabulary(generated,chosenTitle,article,vocabularyPrompt,null,activeProviderLabel());
          setSaveStatus("saved");setNotice(`已生成并自动保存 ${generated.length} 个原文填词练习。`);
        }catch(cause){setSaveStatus("error");setError(`生成成功，但尚未保存：${cause instanceof Error?cause.message:"保存失败"}`);}

      }else{
        const generated = parseOrderedExercises(value.exercises,{ requirePronunciation: true });
        const chosenTitle=resolveGeneratedTitle("assembly",value.titleZh);
        setExercises(generated);setAssemblySource(article);setCurrentId(null);setTitle(chosenTitle);
        drafts.current.assembly={article,title:chosenTitle};
        editMode.current=null;setSaveStatus("idle");
        try{
          commitAssembly(generated,chosenTitle,article,prompt,null,activeProviderLabel());
          setSaveStatus("saved");setNotice(`已生成并自动保存 ${generated.length} 条句子组装练习。`);
        }catch(cause){setSaveStatus("error");setError(`生成成功，但尚未保存：${cause instanceof Error?cause.message:"保存失败"}`);}

      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失败，原有结果保留"); }
    finally { setBusy(false); }
  }

  function edit(index:number,field:keyof OrderedExercise,value:string) {
    setExercises(items => items.map((item,i) => i === index ? { ...item,[field]:value } : item)); markEdited();
  }
  function swap(index:number,direction:number) {
    setExercises(items => {
      const next = [...items],other = index+direction;
      if (other < 0 || other >= next.length) return items;
      [next[index],next[other]]=[next[other],next[index]]; return next;
    }); markEdited();
  }
  function editVocabulary(index:number,field:"word"|"meaningZh"|"sentenceMeaningZh"|"pronunciation",value:string){
    setVocabulary(items=>items.map((item,i)=>i===index?{...item,[field]:value}:item));markEdited();
  }
  function swapVocabulary(index:number,direction:number){
    setVocabulary(items=>{const other=index+direction;if(other<0||other>=items.length)return items;
      const next=[...items];[next[index],next[other]]=[next[other],next[index]];return next;});markEdited();
  }
  function persist() {
    try {
      if(!stage)throw new Error("请先选择一种练习方式");
      if(sourceMismatch)throw new Error("当前文章与生成练习时的原文不同，请恢复原文或重新生成");
      if(stage==="vocabulary")commitVocabulary(vocabulary,title,article,vocabularyPrompt,currentVocabularyId,activeProviderLabel());
      else commitAssembly(exercises,title,article,prompt,currentId,activeProviderLabel());
      editMode.current=null;setSaveStatus("saved");setError("");setNotice("练习已保存到本机。");
    }catch(cause){setSaveStatus("error");setError(cause instanceof Error?cause.message:"保存失败");}
  }
  // Only user edits to an already saved record are autosaved. Opening a record,
  // changing the mode, or deleting a record cannot cause it to be recreated.
  useEffect(()=>{
    if(!storageReady||!editRevision||!stage||editMode.current!==stage||busy||sourceMismatch)return;
    const id=stage==="vocabulary"?currentVocabularyId:currentId;
    if(!id)return;
    const timer=setTimeout(()=>{
      if(editMode.current!==stage)return;
      try{
        if(stage==="vocabulary")commitVocabulary(vocabulary,title,article,vocabularyPrompt,id,activeProviderLabel());
        else commitAssembly(exercises,title,article,prompt,id,activeProviderLabel());
        setSaveStatus("saved");setError("");setNotice("修改已自动保存。");
      }catch(cause){
        setSaveStatus("error");
        setError(`修改尚未保存：${cause instanceof Error?cause.message:"存储写入失败"}`);
      }
    },650);
    return ()=>clearTimeout(timer);
  },[editRevision,stage,title,article,vocabulary,exercises,vocabularyPrompt,prompt,storageReady,busy,sourceMismatch,currentId,currentVocabularyId]);
  function openSaved(item: SavedPractice) {
    editMode.current=null;manuallyNamed.current.assembly=false;setRenaming(null);setPendingDeletion(null);setSaveStatus("saved");
    drafts.current.assembly={article:item.article,title:item.title};setArticle(item.article);setTitle(item.title);setPrompt(ensureVisibleWorkshopTitleRule(item.prompt));setExercises(item.exercises);setAssemblySource(item.article);
    setCurrentId(item.id); setError("");setNotice(`已打开「${item.title}」；没有调用 AI。`);
  }
  function openSavedVocabulary(item:SavedVocabularyPractice){
    chooseMode("vocabulary");editMode.current=null;manuallyNamed.current.vocabulary=false;setRenaming(null);setPendingDeletion(null);setSaveStatus("saved");
    drafts.current.vocabulary={article:item.article,title:item.title};setArticle(item.article);setTitle(item.title);setVocabularyPrompt(ensureVisibleWorkshopTitleRule(item.prompt));setVocabulary(item.vocabulary);setVocabularySource(item.article);
    setCurrentVocabularyId(item.id);setError("");setNotice(`已打开原文填词「${item.title}」；没有调用 AI。`);
  }
  // Browser confirm() is blocked in Vantilo's sandboxed Reader iframe
  // (without allow-modals). Use explicit in-page confirmation instead.
  function requestDeletion(mode:PracticeMode,id:string){
    setPendingDeletion({mode,id});setRenaming(null);setError("");setNotice("");
  }
  function deleteSavedVocabulary(id:string){
    if(pendingDeletion?.mode!=="vocabulary"||pendingDeletion.id!==id)return;
    const storage=getReaderStorage();
    let attemptedWrite=false;
    try{
      if(storage.getPendingKeys().includes("vantilo:practice-workshop-vocabulary:v1"))throw new Error("尚有未完成的原文填词存储写入，暂不能删除");
      if(!savedVocabulary.some(item=>item.id===id))throw new Error("这份练习已不存在，请刷新");
      const next=savedVocabulary.filter(item=>item.id!==id);
      attemptedWrite=true;
      saveSavedVocabularyPractices(next,storage);
      if(currentVocabularyId===id){editMode.current=null;setCurrentVocabularyId(null);setSaveStatus("idle");}
      setSavedVocabulary(next);setPendingDeletion(null);
      setError("");setNotice("已删除这份原文填词练习，句子组装不受影响。");
    }catch(cause){
      // Unlike an ordinary text edit, a failed delete must never be retried
      // implicitly by the Reader's storage queue.
      if(attemptedWrite)storage.discardPendingKey("vantilo:practice-workshop-vocabulary:v1");
      setError(cause instanceof Error?cause.message:"删除失败，原有练习已保留");
    }
  }
  function deleteSaved(id:string) {
    if(pendingDeletion?.mode!=="assembly"||pendingDeletion.id!==id)return;
    const storage=getReaderStorage();
    let attemptedWrite=false;
    try {
      if(storage.getPendingKeys().includes("vantilo:practice-workshop:v1"))throw new Error("尚有未完成的句子组装存储写入，暂不能删除");
      if(!saved.some(item=>item.id===id))throw new Error("这份练习已不存在，请刷新");
      const next=saved.filter(item=>item.id!==id);
      attemptedWrite=true;
      saveSavedPractices(next,storage);
      if(currentId===id){editMode.current=null;setCurrentId(null);setSaveStatus("idle");}
      setSaved(next);setPendingDeletion(null);
      setNotice("已删除这份句子组装练习。");setError("");
    }catch(cause){
      if(attemptedWrite)storage.discardPendingKey("vantilo:practice-workshop:v1");
      setError(cause instanceof Error?cause.message:"删除失败，原有练习已保留");
    }
  }
  function saveRenamedTitle() {
    if(!renaming)return;
    const name=renaming.value.trim();
    if(!name||name.length>200){setError("标题不能为空，且不能超过 200 字符");return;}
    try{
      if(renaming.mode==="vocabulary"){
        const prior=savedVocabulary.find(item=>item.id===renaming.id);
        if(!prior)throw new Error("练习已删除，无法重命名");
        const next=savedVocabulary.map(item=>item.id===renaming.id?{...item,title:name,updatedAt:new Date().toISOString()}:item);
        saveSavedVocabularyPractices(next);setSavedVocabulary(next);
        if(currentVocabularyId===renaming.id&&stage==="vocabulary"){setTitle(name);drafts.current.vocabulary={article,title:name};}
      }else{
        const prior=saved.find(item=>item.id===renaming.id);
        if(!prior)throw new Error("练习已删除，无法重命名");
        const next=saved.map(item=>item.id===renaming.id?{...item,title:name,updatedAt:new Date().toISOString()}:item);
        saveSavedPractices(next);setSaved(next);
        if(currentId===renaming.id&&stage==="assembly"){setTitle(name);drafts.current.assembly={article,title:name};}
      }
      editMode.current=null;setRenaming(null);setError("");setNotice("标题已保存，无需重新生成练习。");setSaveStatus("saved");
    }catch(cause){setError(cause instanceof Error?cause.message:"重命名失败，旧标题仍保留");}
  }
  function start() {
    try {
      if(!stage)throw new Error("请先选择一种练习方式");
      if(sourceMismatch)throw new Error("当前文章与生成练习时的原文不同，请恢复练习原文或重新生成");
      if(stage==="vocabulary" && !vocabulary.length)throw new Error("尚未生成原文填词练习");
      if(stage==="assembly" && !exercises.length)throw new Error("尚未生成句子组装练习");
      const now = new Date().toISOString();
      const lesson: BookLesson = {
        id: (stage==="vocabulary"?currentVocabularyId:currentId) ?? "unsaved-workshop",bookId:"practice-workshop",bookTitle:"Practice Lab",
        sourceFingerprint:(stage==="vocabulary"?currentVocabularyId:currentId) ?? "unsaved",createdAt:now,
        titleZh:title || "Practice Lab",teaserZh:"",english:article,explanationZh:"",keywords:[],evidence:[],
        wordCount:article.trim().split(/\s+/).length,adaptation:"AI 简易英文改写，非原著引文",
      };
      const basic = createBasicMaterial(lesson,(stage==="vocabulary"?currentVocabularyId:currentId) ?? "unsaved");
      if(stage==="vocabulary"){
        const next=workshopVocabularyMaterial(lesson,basic,vocabulary);
        setMaterial(next);
        setProgress({...newLearningProgress(next,[]),practiceStage:"vocabulary",phase:"vocabulary-selection",stageTotal:vocabulary.length});
      }else{
        const validated = parseOrderedExercises(exercises,{requirePronunciation:true});
        const next = orderedPracticeMaterial(lesson,basic,validated);
        setMaterial(next);
        setProgress({ ...newLearningProgress(next,[]), practiceStage:"assembly",phase:"assembly",stageTotal:validated.length });
      }
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法进入练习"); }
  }
  function restartVocabulary(selection=false){
    if(!material)return;
    const next=newLearningProgress(material,[]);
    setProgress({...next,practiceStage:"vocabulary",phase:selection?"vocabulary-selection":"vocabulary",stageTotal:material.vocabulary.length});
  }
  if(material&&progress?.practiceStage==="vocabulary"&&progress.phase==="vocabulary-selection")
    return <VocabularySelection material={material} progress={progress} update={setProgress} exit={()=>setProgress(null)} reset={()=>restartVocabulary(true)}/>;
  if(material&&progress?.practiceStage==="vocabulary"&&["vocabulary","vocabulary-review"].includes(progress.phase))
    return <VocabularyPreparationGame key={progress.runId} material={material} progress={progress} update={setProgress} exit={()=>setProgress(null)} reset={()=>restartVocabulary(false)}/>;
  if(material&&progress?.practiceStage==="vocabulary"&&progress.phase==="vocabulary-complete")
    return <LearningStageCompletion title={title} stage="vocabulary" total={progress.selectedVocabularyIds.length} progress={progress} exit={()=>setProgress(null)} repeat={()=>restartVocabulary(true)}/>;
  if (material && progress?.phase === "assembly") return <AssemblyTypingGame material={material} progress={progress} update={setProgress} exit={() => setProgress(null)} />;
  if (material && progress?.phase === "assembly-complete") return <LearningStageCompletion title={title} stage="assembly" total={exercises.length} progress={progress} exit={() => setProgress(null)} repeat={start} />;

  const wordCount = article.trim() ? article.trim().split(/\s+/).length : 0;
  const charCount = article.length;
  const activeSavedId = stage === "vocabulary" ? currentVocabularyId : stage === "assembly" ? currentId : null;
  const providerReady = provider === "vantilo-custom-api" ? !!vantiloProfileId : provider === "profile" ? !!profileId : !!apiKey.trim();

  return <section className="practice-workshop" aria-label="Practice Lab">
    <header className="practice-lab-header">
      <div className="practice-lab-header-main">
        <div className="practice-lab-brand-row">
          <span className="practice-lab-claude-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2.5L13.7 8.8L19.2 5.4L15.8 10.9L22 12L15.8 13.1L19.2 18.6L13.7 15.2L12 21.5L10.3 15.2L4.8 18.6L8.2 13.1L2 12L8.2 10.9L4.8 5.4L10.3 8.8L12 2.5Z" fill="currentColor" />
            </svg>
          </span>
          <h1>Practice Lab</h1>
        </div>
        <p>把英文文章变成互动练习，选择喜欢的方式开始。</p>
      </div>
      <div className="practice-lab-header-meta" aria-label="工坊状态">
        <span className={`practice-lab-status-pill ${providerReady ? "is-ready" : "is-warn"}`}>
          <span className="practice-lab-status-dot" aria-hidden="true" />
          <span>{providerReady ? providerLabel : "待配置 AI 服务"}</span>
        </span>
        <span className="practice-lab-stat-pill">
          词库 {savedVocabulary.length} · 句库 {saved.length}
        </span>
      </div>
    </header>

    <div className="practice-workshop-mode-header">
      <span>选择练习方式</span>
      <span className="practice-workshop-mode-sub">两种玩法可单独使用，文章草稿与练习存档彼此独立</span>
    </div>
    <div className="practice-workshop-mode-cards" role="group" aria-label="选择练习方式">
      <button type="button" className={`practice-workshop-mode-card ${stage==="vocabulary"?"is-selected":""}`}
        aria-pressed={stage==="vocabulary"} disabled={busy} onClick={()=>chooseMode("vocabulary")}>
        <span className="practice-workshop-mode-top">
          <span className="practice-workshop-mode-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.2 2.4a1.6 1.6 0 0 1 2.3 2.3L6.2 12l-3.2.8.8-3.2 7.4-7.2Z" />
              <path d="M9.6 4l2.4 2.4" />
            </svg>
          </span>
          <strong>原文填词</strong>
          <span className="practice-workshop-mode-count">{savedVocabulary.length} 份存档</span>
          <span className="practice-workshop-mode-check" aria-hidden="true">{stage==="vocabulary"?"✓":""}</span>
        </span>
        <span className="practice-workshop-mode-description">看原句，填关键词 · 练单词记忆与语境理解</span>
        <span className="practice-workshop-mode-preview">
          <span className="practice-workshop-mode-example" lang="en">The boy <span className="practice-lab-blank-chip">____</span> the dog.</span>
          <span className="practice-workshop-mode-caption">提示：注意到 → noticed</span>
        </span>
      </button>
      <button type="button" className={`practice-workshop-mode-card ${stage==="assembly"?"is-selected":""}`}
        aria-pressed={stage==="assembly"} disabled={busy} onClick={()=>chooseMode("assembly")}>
        <span className="practice-workshop-mode-top">
          <span className="practice-workshop-mode-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2.5" width="5" height="4" rx="1.2" />
              <rect x="9" y="2.5" width="5" height="4" rx="1.2" />
              <rect x="2" y="9.5" width="12" height="4" rx="1.2" />
            </svg>
          </span>
          <strong>句子组装</strong>
          <span className="practice-workshop-mode-count">{saved.length} 份存档</span>
          <span className="practice-workshop-mode-check" aria-hidden="true">{stage==="assembly"?"✓":""}</span>
        </span>
        <span className="practice-workshop-mode-description">从单词到完整句 · 逐词输入，练习英文表达</span>
        <span className="practice-workshop-mode-preview">
          <span className="practice-workshop-mode-example" lang="en">noticed → noticed the dog</span>
          <span className="practice-workshop-mode-caption" lang="en">The boy noticed the dog.</span>
        </span>
      </button>
    </div>

    <div className="practice-workshop-grid">
      <section className="practice-workshop-pane practice-lab-compose-pane" aria-label="准备练习">
        <div className="practice-lab-pane-head">
          <h2>准备练习{stage? ` · ${currentModeLabel}`:""}</h2>
          <span className="practice-lab-counter" aria-live="polite">{wordCount} 词 · {charCount}/2000 字符</span>
        </div>

        <label className="practice-lab-field">
          <span className="practice-lab-label">练习标题</span>
          <input className="practice-lab-title-input" value={title} maxLength={200} onChange={event => updateTitle(event.target.value)} />
        </label>

        <label className="practice-lab-field">
          <span className="practice-lab-label">英文文章</span>
          <textarea className="practice-lab-article-input" rows={9} value={article} maxLength={2000} placeholder="粘贴英文文章（最多 2000 字符），可从书架或精选文章复制" onChange={event => updateArticle(event.target.value)} />
        </label>

        <p className="practice-workshop-note">支持使用「设置 → AI 模型服务」中已保存的 DeepSeek、Gemini 或局域网模型直接生成练习。</p>

        {stage && <details className="practice-workshop-advanced">
          <summary>
            <span>高级设置</span>
            <span className="practice-lab-advanced-summary">AI 服务：{providerLabel} · 生成规则</span>
          </summary>
          <div className="practice-lab-advanced-body">
            <label>AI 服务<select value={provider} onChange={event => setProvider(event.target.value as ProviderChoice)}>
              <option value="vantilo-custom-api">AI 模型服务（设置中已保存）</option>
              <option value="deepseek">DeepSeek API（手动输入 Key）</option>
              {(!vantiloApiAvailable || legacyAiAvailable) && <option value="profile">Reader 内置 AI 服务</option>}
            </select></label>
            {provider === "vantilo-custom-api" && <div className="practice-lab-inline-row">
              <label>已保存的 AI 模型服务<select value={vantiloProfileId} onChange={event => setVantiloProfileId(event.target.value)}>
                {vantiloProfiles.length === 0 ? <option value="">尚未配置，请先在顶部「设置」中添加 AI 模型服务</option> : vantiloProfiles.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
              </select></label>
              <button type="button" className="practice-lab-ghost-btn" onClick={() => void refreshVantiloProfiles()}>刷新服务列表</button>
            </div>}
            {provider === "deepseek" && <div className="practice-lab-two-col">
              <label>DeepSeek 模型<select value={deepseekModel} onChange={event=>setDeepseekModel(event.target.value)}>
                <option value="deepseek-chat">deepseek-chat</option><option value="deepseek-reasoner">deepseek-reasoner</option>
              </select></label>
              <label>DeepSeek API Key<input type="password" autoComplete="off" value={apiKey} onChange={event=>setApiKey(event.target.value)} placeholder="仅用于当前请求，不保存在练习或浏览器存储中" /></label>
            </div>}
            {provider === "profile" && <>
              <div className="practice-lab-inline-row">
                <label>已保存的服务<select value={profileId} onChange={event => setProfileId(event.target.value)}>{profiles?.profiles.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></label>
                <button type="button" className="practice-lab-ghost-btn" onClick={() => void refreshProfiles()}>刷新服务列表</button>
              </div>
              <details className="practice-lab-nested-details"><summary>在本页管理自定义 API 服务</summary><AiProviderSettingsPanel /></details>
            </>}
            <label>AI 生成规则（可修改）<textarea className="practice-workshop-prompt" rows={8} value={stage==="vocabulary"?vocabularyPrompt:prompt} onChange={event => stage==="vocabulary"?setVocabularyPrompt(event.target.value):setPrompt(event.target.value)} /></label>
            <p className="practice-workshop-note">此处显示实际发送给 AI 的完整生成规则，包含可修改的中文标题要求 <code>titleZh</code>，不会暗中追加第二份提示词。保留一次 <code>{"{{ARTICLE_JSON}}"}</code> 占位符。{stage==="vocabulary"?"只从原文选择单词并验证词位。":"从词到句生成有序练习。"}{!(stage==="vocabulary"?vocabularyPrompt:prompt).includes("titleZh") && <strong> 当前规则没有中文标题要求，AI 可能使用默认标题；可适当缩短旧提示词后加入标题要求。</strong>}</p>
            <div className="practice-workshop-actions">
              <button type="button" disabled={stage==="vocabulary"?!originalVocabularyPrompt:!originalPrompt} onClick={() => { if(stage==="vocabulary")setVocabularyPrompt(originalVocabularyPrompt);else setPrompt(originalPrompt);setNotice("已恢复本阶段内置提示词，尚未保存。"); }}>恢复默认提示词</button>
              <button type="button" disabled={!storageReady} onClick={() => {try {if(stage==="vocabulary")saveVocabularyWorkshopPrompt(vocabularyPrompt);else saveWorkshopPrompt(prompt);setNotice("已独立保存当前阶段提示词。");setError("");} catch(cause){setError(cause instanceof Error?cause.message:"保存失败");}}}>保存当前提示词</button>
            </div>
          </div>
        </details>}

        <button className={`primary-button practice-lab-generate-btn ${busy ? "is-busy" : ""}`} type="button" disabled={busy || !stage || !(stage==="vocabulary"?vocabularyPrompt:prompt) || !article.trim() || !storageReady || (provider === "profile" && !profileId) || (provider === "vantilo-custom-api" && !vantiloProfileId)} onClick={() => void generate()}>
          {busy?"正在生成…":stage==="vocabulary"?"生成原文填词练习":stage==="assembly"?"生成句子组装练习":"请先选择练习方式"}
        </button>
      </section>

      <section className="practice-workshop-pane practice-lab-stage-pane" aria-label="练习内容">
        {stage ? <>
          <div className="practice-lab-stage-head">
            <h2>{currentModeLabel} · 生成结果（{currentResultCount} {stage==="vocabulary"?"个单词":"条"}）</h2>
            <div className="practice-workshop-actions practice-lab-launch-bar">
              {saveStatus==="error" && currentResultCount>0 && <button type="button" disabled={sourceMismatch || !storageReady || busy} onClick={persist}>重试保存</button>}
              {saveStatus==="saved" && !sourceMismatch && <span className="practice-workshop-saved-status is-saved" role="status">✓ 已自动保存</span>}
              {saveStatus==="saving" && !sourceMismatch && <span className="practice-workshop-saved-status is-saving" role="status">正在保存修改…</span>}
              <button type="button" className="primary-button practice-lab-start-btn" disabled={!currentResultCount || sourceMismatch || busy} onClick={start}>{stage==="vocabulary"?"开始原文填词":"开始句子组装"}</button>
            </div>
          </div>

          {sourceMismatch && <div className="practice-workshop-source-warning" role="status">
            <span>当前文章与这些练习的原文不同。可以恢复原文继续练习，也可以重新生成。</span>
            <button type="button" onClick={()=>{if(currentSource!==null)updateArticle(currentSource);}}>恢复练习原文</button>
          </div>}
          {(stage==="vocabulary"?vocabularyLoadError:assemblyLoadError) && <p role="alert" className="practice-workshop-error practice-lab-banner">{stage==="vocabulary"?vocabularyLoadError:assemblyLoadError}</p>}
          {error && <p role="alert" className="practice-workshop-error practice-lab-banner">{error}</p>}
          {notice && <p role="status" className="practice-lab-notice practice-lab-banner">{notice}</p>}

          {stage==="vocabulary" && <>
            <p className="practice-workshop-note">仅原文单词填空。程序验证原句、词形及出现位置；可编辑中文及 IPA，AI 解释和音标仍需人工核查。</p>
            {vocabulary.length===0 ? <div className="practice-lab-result-empty">
              <div className="practice-lab-flow-steps" aria-hidden="true">
                <span>1. 粘贴英文文章</span><span>→</span><span>2. AI 提取关键词</span><span>→</span><span>3. 进入原文填词</span>
              </div>
              <p>生成后可以预览、编辑原文填词练习。切换玩法不会清空原有内容。</p>
            </div> :
              <ol className="practice-workshop-results">{vocabulary.map((item,index)=><li key={index} className="practice-lab-item-card">
                <div className="practice-workshop-item-head">
                  <span className="practice-lab-item-badge">第 {index+1} 个单词 · 原句 {item.sentenceIndex+1}</span>
                  <div className="practice-lab-item-controls">
                    <button aria-label={`上移词汇第 ${index+1} 项`} disabled={index===0} onClick={()=>swapVocabulary(index,-1)}>↑</button>
                    <button aria-label={`下移词汇第 ${index+1} 项`} disabled={index===vocabulary.length-1} onClick={()=>swapVocabulary(index,1)}>↓</button>
                    <button className="is-danger" aria-label={`删除词汇第 ${index+1} 项`} onClick={()=>{setVocabulary(items=>items.filter((_,i)=>i!==index));markEdited();}}>删除</button>
                  </div>
                </div>
                <p lang="en" className="practice-lab-quote">{item.sentence}</p>
                <div className="practice-lab-item-grid">
                  <label>原文单词<input lang="en" value={item.word} maxLength={100} onChange={event=>editVocabulary(index,"word",event.target.value)}/></label>
                  <label>词形 IPA<input lang="en" value={item.pronunciation} maxLength={100} onChange={event=>editVocabulary(index,"pronunciation",event.target.value)}/></label>
                  <label>语境中文<input value={item.meaningZh} maxLength={300} onChange={event=>editVocabulary(index,"meaningZh",event.target.value)}/></label>
                  <label>整句中文<input value={item.sentenceMeaningZh} maxLength={750} onChange={event=>editVocabulary(index,"sentenceMeaningZh",event.target.value)}/></label>
                </div>
              </li>)}</ol>}
          </>}

          {stage==="assembly" && <>
            <p className="practice-workshop-note">可修改英文、中文及音标，或调整顺序。不支持的符号、缺失的音标会在开始练习时提示；AI 音标未经过人工语音审核。</p>
            {exercises.length===0 ? <div className="practice-lab-result-empty">
              <div className="practice-lab-flow-steps" aria-hidden="true">
                <span>1. 粘贴英文文章</span><span>→</span><span>2. AI 拆解词句阶梯</span><span>→</span><span>3. 进入句子组装</span>
              </div>
              <p>生成后可在此预览。失败时不会清空之前成功的练习。</p>
            </div> :
              <ol className="practice-workshop-results">{exercises.map((item,index) =>
                <li key={index} className="practice-lab-item-card">
                  <div className="practice-workshop-item-head">
                    <span className="practice-lab-item-badge">第 {index+1} 条</span>
                    <div className="practice-lab-item-controls">
                      <button aria-label={`上移第 ${index+1} 条`} disabled={index===0} onClick={()=>swap(index,-1)}>↑</button>
                      <button aria-label={`下移第 ${index+1} 条`} disabled={index===exercises.length-1} onClick={()=>swap(index,1)}>↓</button>
                      <button className="is-danger" aria-label={`删除第 ${index+1} 条`} onClick={()=>{setExercises(items=>items.filter((_,i)=>i!==index));markEdited();}}>删除</button>
                    </div>
                  </div>
                  <div className="practice-lab-item-grid practice-lab-assembly-grid">
                    <label className="is-full">英文<input lang="en" value={item.sentence} maxLength={250} onChange={event=>edit(index,"sentence",event.target.value)} /></label>
                    <label>中文<input value={item.chinese} maxLength={250} onChange={event=>edit(index,"chinese",event.target.value)} /></label>
                    <label>音标 IPA<input lang="en" value={item.pronunciation ?? ""} maxLength={750} onChange={event=>edit(index,"pronunciation",event.target.value)} /></label>
                  </div>
                </li>)}</ol>}
          </>}

          <div className="practice-lab-library-section">
            <div className="practice-lab-library-head">
              <h2>{stage==="vocabulary" ? `已保存的原文填词（${savedVocabulary.length}）` : `已保存的句子组装（${saved.length}）`}</h2>
              <span className="practice-workshop-note">点击「打开」直接进入复习，不消耗 AI 调用</span>
            </div>
            {stage==="vocabulary" ? (
              savedVocabulary.length === 0 ? <p className="practice-lab-library-empty">还没有保存的原文填词练习，生成后会自动保存在这里。</p> :
              <ul className="practice-workshop-saved">{savedVocabulary.map(item=><li key={item.id} className={`${pendingDeletion?.mode==="vocabulary"&&pendingDeletion.id===item.id?"is-confirming-delete":""} ${activeSavedId===item.id?"is-active-lesson":""}`.trim()}>
                <div className="practice-workshop-saved-detail">
                  {renaming?.mode==="vocabulary"&&renaming.id===item.id?
                    <label>修改中文标题<input aria-label="修改中文标题" autoFocus maxLength={200} value={renaming.value} onChange={event=>setRenaming({...renaming,value:event.target.value})} onKeyDown={event=>{if(event.key==="Enter")saveRenamedTitle();if(event.key==="Escape")setRenaming(null);}} /></label>:
                    <><strong>{item.title}</strong><small>{item.vocabulary.length} 个单词 · {item.providerLabel}</small></>}
                </div><div className="practice-workshop-saved-controls">
                  {renaming?.mode==="vocabulary"&&renaming.id===item.id?<><button className="is-accent" onClick={saveRenamedTitle}>保存名称</button><button onClick={()=>setRenaming(null)}>取消</button></>:<>
                    <button className="is-accent" onClick={()=>openSavedVocabulary(item)}>打开</button>
                    <button aria-label={`重命名 ${item.title}`} onClick={()=>setRenaming({mode:"vocabulary",id:item.id,value:item.title})}>改名</button>
                    <button type="button" className="is-danger" onClick={()=>requestDeletion("vocabulary",item.id)}>删除</button></>}
                </div>
                {pendingDeletion?.mode==="vocabulary"&&pendingDeletion.id===item.id && <div className="practice-workshop-delete-confirm" role="group" aria-label={`确认删除 ${item.title}`}>
                  <span>确定删除「{item.title}」？删除后不可恢复，其他练习不受影响。</span>
                  <button type="button" onClick={()=>deleteSavedVocabulary(item.id)}>确认删除</button>
                  <button type="button" onClick={()=>setPendingDeletion(null)}>取消</button>
                </div>}
              </li>)}</ul>
            ) : (
              saved.length === 0 ? <p className="practice-lab-library-empty">还没有保存的句子组装练习，生成后会自动保存在这里。</p> :
              <ul className="practice-workshop-saved">{saved.map(item=><li key={item.id} className={`${pendingDeletion?.mode==="assembly"&&pendingDeletion.id===item.id?"is-confirming-delete":""} ${activeSavedId===item.id?"is-active-lesson":""}`.trim()}>
                <div className="practice-workshop-saved-detail">
                  {renaming?.mode==="assembly"&&renaming.id===item.id?
                    <label>修改中文标题<input aria-label="修改中文标题" autoFocus maxLength={200} value={renaming.value} onChange={event=>setRenaming({...renaming,value:event.target.value})} onKeyDown={event=>{if(event.key==="Enter")saveRenamedTitle();if(event.key==="Escape")setRenaming(null);}} /></label>:
                    <><strong>{item.title}</strong><small>{item.exercises.length} 条 · {item.providerLabel}</small></>}
                </div><div className="practice-workshop-saved-controls">
                  {renaming?.mode==="assembly"&&renaming.id===item.id?<><button className="is-accent" onClick={saveRenamedTitle}>保存名称</button><button onClick={()=>setRenaming(null)}>取消</button></>:<>
                    <button className="is-accent" onClick={()=>openSaved(item)}>打开</button>
                    <button aria-label={`重命名 ${item.title}`} onClick={()=>setRenaming({mode:"assembly",id:item.id,value:item.title})}>改名</button>
                    <button type="button" className="is-danger" onClick={()=>requestDeletion("assembly",item.id)}>删除</button></>}
                </div>
                {pendingDeletion?.mode==="assembly"&&pendingDeletion.id===item.id && <div className="practice-workshop-delete-confirm" role="group" aria-label={`确认删除 ${item.title}`}>
                  <span>确定删除「{item.title}」？删除后不可恢复，其他练习不受影响。</span>
                  <button type="button" onClick={()=>deleteSaved(item.id)}>确认删除</button>
                  <button type="button" onClick={()=>setPendingDeletion(null)}>取消</button>
                </div>}
              </li>)}</ul>
            )}
          </div>
        </> : <div className="practice-workshop-empty">
          <div className="practice-lab-empty-icon" aria-hidden="true">✦</div>
          <strong>选一种玩法，开始制作练习</strong>
          <p>选中上方卡片后，这里会显示相应的生成结果与已保存的练习。</p>
        </div>}
      </section>
    </div>
  </section>;
}
