import ts from 'typescript';
import postcss from 'postcss';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function adaptScopedAssistant(source, filename) {
  if (!filename.endsWith('/frontend/codex-prep-panel.tsx')) return source;
  source = 'import {useContext} from "react";\nimport {AppAppearanceContext} from "./appearance-context";\nimport {ReaderSharedComposer} from "vantilo:reader-composer";\n' + source;
  source=source.replace('  const root = book ?', `  const sharedComposerColorScheme=useContext(AppAppearanceContext)==='dark'?'dark':'light';\n  const root = book ?`);
  const input = /<label className="codex-prep-composer-input">[\s\S]*?<\/label>/;
  if (!input.test(source)) throw new Error('Original Reader composer changed; review adapter');
  source = source.replace(input, `<ReaderSharedComposer scopeKind={book ? "book" : scope?.kind ?? "all"} value={message} onChange={setMessage} onSubmit={() => void converse(submissionMode === "draft")} colorScheme={sharedComposerColorScheme} disabled={!historyReady || !auth?.sharing || modelBusy} busy={busy}
    models={modelCatalog} modelId={modelPreferences.modelMode === "manual" ? modelPreferences.model : null}
    effort={modelPreferences.reasoningMode === "manual" ? modelPreferences.reasoningEffort : null}
    catalogState={modelBusy ? "loading" : modelCatalogLoaded ? "ready" : modelNotice ? "error" : "loading"}
    modelError={modelNotice} modelBusy={modelBusy} onRetryModels={() => void refreshModelCatalog()}
    onModelChange={(id,effort) => void saveComposerModelSettings(id,effort)} onCancel={() => discussionRequest.current?.abort()} />`);
  source = source.replace('    if (!auth?.pending) return;\n', '');
  const draftCode=`const draftStorageKey = 'vantilo.reader.draft:' + root + scopeQuery + (book?.sourceFingerprint ?? '');
    const loadScopedDraft = () => {try{return window.localStorage.getItem(draftStorageKey)?.slice(0,2000) || '';}catch{return '';}};
    const [message, setMessage] = useState(loadScopedDraft);
    useEffect(()=>{try{if(message)window.localStorage.setItem(draftStorageKey,message.slice(0,2000));else window.localStorage.removeItem(draftStorageKey);}catch{}},[draftStorageKey,message]);`;
  source=source.replace('const [message, setMessage] = useState("");',draftCode).replace('setHistoryReady(false); setHistory([]); setMessage("");','setHistoryReady(false); setHistory([]); setMessage(loadScopedDraft());');
  source = source.replaceAll('连接与模型设置', '登录状态与模型').replaceAll('从官方 ChatGPT 登录', '使用窗口顶部的 ChatGPT 登录');
  source=source.replace('  async function saveModelSettings()', `  useEffect(()=>{if(auth?.sharing)void refreshModelCatalog();},[auth?.sharing]);
    async function saveComposerModelSettings(model:string|null,reasoningEffort:string|null) {
      if(busy || modelBusy)return;
      setModelBusy(true);setError('');
      try {setModelPreferences(await saveCodexPrepModelPreferences({modelMode:model===null?'auto':'manual',model,reasoningMode:reasoningEffort===null?'auto':'manual',reasoningEffort}));}
      catch(err){setError(err instanceof Error ? err.message : '模型设置保存失败');}
      finally{setModelBusy(false);}
    }
  async function saveModelSettings()`);
  // Preserve Reader's original readReply() and stopReplyAudio() functions.
  // They already use streamChineseTts -> /api/prep/tts -> the selected Qwen3-TTS
  // service. Replacing readReply with speechSynthesis silently made Vantilo
  // play the macOS voice even when the independent TTS API was configured.
  const originalTree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const readReply = originalTree.statements.flatMap(statement => {
    if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== 'CodexPrepPanel') return [];
    const functions = [];
    const visit = node => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'readReply') functions.push(node);
      ts.forEachChild(node, visit);
    };
    visit(statement);
    return functions;
  });
  if (readReply.length !== 1 || !readReply[0].getText(originalTree).includes('streamChineseTts(')) {
    throw new Error('Reader assistant Qwen3-TTS readReply seam changed; review adapter');
  }
  const tree=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const result=ts.transform(tree,[context=>{
    const visit=node=>{
      if(ts.isFunctionDeclaration(node) && node.name?.text==='connect') return undefined;
      if(ts.isJsxElement(node)) {
        const text=node.openingElement.getText(tree);
        if(text.includes('className="codex-prep-submit-row"') || text.includes('className="codex-prep-model-settings"')) return undefined;
      }
      if(ts.isJsxExpression(node) && node.expression) {
        const text=node.expression.getText(tree);
        if(text.includes('void connect()') || text.includes('/api/prep/auth/disconnect') || text.startsWith('authUrl &&')) return undefined;
      }
      return ts.visitEachChild(node,visit,context);
    };return root=>ts.visitNode(root,visit);
  }]);
  const output=ts.createPrinter().printFile(result.transformed[0]);result.dispose();return output;
}

export function sharedReaderComposerPlugin() {
  return {name:'vantilo-shared-reader-composer',enforce:'pre',generateBundle(_options,bundle){
    for(const asset of Object.values(bundle)){
      if(asset.type!=='asset'||!asset.fileName.endsWith('.css')||typeof asset.source!=='string')continue;
      const css=postcss.parse(asset.source);
      css.walkAtRules('font-face',rule=>{if(/https?:\/\//.test(rule.toString()))rule.remove();});
      asset.source=css.toString();
    }
  },resolveId(id,importer){if(importer?.includes('/@react-spectrum/s2/') && /(?:^|\/)Fonts(?:\.[cm]?[jt]sx?)?$/.test(id))return '\0vantilo-system-fonts';if(id==='vantilo:reader-composer')return '\0vantilo-reader-composer.tsx';},load(id){if(id==='\0vantilo-system-fonts')return 'export function Fonts(){return null}';if(id==='\0vantilo-reader-composer.tsx')return `export {ReaderSharedComposer} from ${JSON.stringify(path.join(repo,'src/ui/reader-shared-composer.tsx'))};`;}};
}
