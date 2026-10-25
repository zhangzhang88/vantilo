import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { InsertTextMenuItem, PromptField, PromptFieldSubmitButton, PromptFieldToolbar, PromptFieldValue, PromptTokenField } from '@react-spectrum/ai';
import { ActionButton, Button, Header, Menu, MenuItem, MenuSection, MenuTrigger, Text } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ArrowUpSend from '@react-spectrum/s2/icons/ArrowUpSend';

export type ComposerCompletion = { id: string; label: string; description: string; insert: string };
export type ComposerHandle = { focus: () => void };

function promptValue(text: string) {
  const segments = new PromptFieldValue([]).tokenize(text);
  const last = segments.length - 1;
  return new PromptFieldValue(segments).withCaretPosition(last >= 0 ? { index: last, offset: segments[last]!.text.length } : { index: 0, offset: 0 });
}

export const AgentComposer = forwardRef<ComposerHandle, {
  value: string; onChange: (value: string) => void; placeholder: string; disabled: boolean; busy: boolean; referenceBusy: boolean;
  note: string; triggerValue: string | null; completions: readonly ComposerCompletion[]; onPickReferences: () => void;
  onSubmit: (value: string) => void; onCancel: () => void; modelControl: ReactNode;
}>(({ value, onChange, placeholder, disabled, busy, referenceBusy, note, triggerValue, completions, onPickReferences, onSubmit, onCancel, modelControl }, forwardedRef) => {
  const root = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState(() => ({ text: value, parsed: promptValue(value) }));
  let activeEditor = editor;
  if (value !== editor.text) { activeEditor = { text: value, parsed: promptValue(value) }; setEditor(activeEditor); }
  useImperativeHandle(forwardedRef, () => ({ focus: () => root.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus() }), []);
  const update = (next: PromptFieldValue) => { const text = next.toString(); setEditor({ text, parsed: next }); if (text !== value) onChange(text); };
  const completionItems = (filter: string) => !triggerValue || filter !== triggerValue ? null : completions.map(item => <InsertTextMenuItem key={item.id} id={item.id} text={`${item.insert}${item.id.startsWith('slash:') ? ' ' : ''}`} textValue={item.label}>
    <Text slot="label">{item.label}</Text><Text slot="description">{item.description}</Text>
  </InsertTextMenuItem>);
  const submit = busy ? <PromptFieldSubmitButton /> : value.trim() && !disabled ? <PromptFieldSubmitButton /> : <Button variant="primary" size="S" isDisabled aria-label="发送"><ArrowUpSend /></Button>;
  return <div ref={root} className="composer-field" aria-disabled={disabled} inert={disabled}>
    <PromptField size="S" variant="subtle" value={activeEditor.parsed} onChange={update} onSubmit={item => onSubmit(item.toString())}
      isGenerating={busy} onStop={onCancel} aiDisclaimer={<></>}>
      <div role="group" aria-label="任务输入框"><PromptTokenField placeholder={placeholder} completionTrigger={/(?<=^|\s)[@/]/} renderCompletions={completionItems} menuWidth={320} /></div>
      <PromptFieldToolbar><div className="composer-toolbar">
        <MenuTrigger align="start" direction="top">
          <ActionButton isQuiet size="S" aria-label="添加内容" isDisabled={disabled || referenceBusy}><Add /></ActionButton>
          <Menu aria-label="添加内容" size="M" onAction={key => key === 'reference-files' && onPickReferences()}>
            <MenuSection><Header>输入内容</Header><MenuItem id="reference-files" textValue="选择工作区引用" isDisabled={disabled || referenceBusy}>
              <Add /><Text slot="label">{referenceBusy ? '正在选择…' : '文件或文件夹'}</Text><Text slot="description">从当前授权工作区选择</Text>
            </MenuItem></MenuSection>
          </Menu>
        </MenuTrigger>
        <span className="readonly-badge" title="仅允许读取工作区内容；每次工具调用都需单独审批。">◈ 只读</span>
        <span className="composer-note">{note}</span>
        {modelControl}{submit}
      </div></PromptFieldToolbar>
    </PromptField>
  </div>;
});
AgentComposer.displayName = 'AgentComposer';
