import {Provider} from '@react-spectrum/s2';
import {CodexModelPicker, type CatalogState} from './codex-model-picker';
import {AgentComposer} from './agent-composer';
import './agent-composer.css';
import './reader-shared-composer.css';

type ReaderModel = {model:string;displayName:string;description:string;isDefault:boolean;defaultReasoningEffort:string; supportedReasoningEfforts:{reasoningEffort:string;description:string}[]};

export function ReaderSharedComposer(props: {
  value:string; onChange:(value:string)=>void; onSubmit:(value:string)=>void;
  disabled:boolean; busy:boolean; onCancel:()=>void; colorScheme?:'light'|'dark'; scopeKind?:string;
  models:readonly ReaderModel[]; modelId:string|null; effort:string|null; catalogState:CatalogState; modelError?:string; modelBusy:boolean;
  onModelChange:(id:string|null,effort:string|null)=>void; onRetryModels:()=>void;
}) {
  const prompts:Record<string,string> = {
    all:'输入问题，或告诉我你想读什么…',
    books:'想找什么样的书？',
    magazines:'想读哪类文章？',
    publication:'想了解这本杂志的哪些内容？',
    issue:'想了解这一期的哪些内容？',
    article:'对这篇文章有什么疑问？',
    book:'想了解这本书的哪些内容？',
    chapter:'这一章有哪些地方想进一步理解？',
    lesson:'想练习或理解这篇阅读的哪些内容？',
  };
  return <div className="reader-shared-composer"><Provider colorScheme={props.colorScheme ?? "light"}><AgentComposer {...props}
    placeholder={prompts[props.scopeKind ?? 'all'] ?? prompts.all!} referenceBusy={false} note=""
    triggerValue={null} completions={[]} onPickReferences={()=>{}}
    showReferences={false}
    modelControl={<CodexModelPicker models={props.models.map(model=>({id:model.model,displayName:model.displayName,description:model.description,isDefault:model.isDefault,defaultEffort:model.defaultReasoningEffort||null,efforts:model.supportedReasoningEfforts.map(effort=>({id:effort.reasoningEffort,description:effort.description}))}))}
      modelId={props.modelId} effort={props.effort} state={props.catalogState} error={props.modelError}
      disabled={props.disabled||props.busy||props.modelBusy} onChange={props.onModelChange} onRetry={props.onRetryModels}/>}/></Provider></div>;
}
