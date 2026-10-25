import { useEffect, useRef, useState } from 'react';
import { UserMessage } from '@react-spectrum/ai';
import { ActionButton, Text, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import Copy from '@react-spectrum/s2/icons/Copy';
import { MarkdownView } from './markdown-view';

export type ConversationMessageData = {
  id: string; role: 'user' | 'assistant'; text: string; status?: 'pending' | 'completed' | 'failed' | 'cancelled';
  createdAt: string; finishedAt?: string; error?: string | null;
};

export function ConversationMessage({ message, onOpenLink }: { message: ConversationMessageData; onOpenLink?: (href: string) => void }) {
  if (message.role === 'user') return <div className="transcript-user-row">
    <UserMessage><div className="transcript-user-text">{message.text}</div></UserMessage>
    <div className="transcript-user-controls"><CopyText text={message.text} /></div>
  </div>;
  return <div className="transcript-agent-row">
    <span className="transcript-agent-mark" aria-hidden="true"><AIMark /></span>
    <div className="transcript-agent-content"><div className="transcript-agent-text"><MarkdownView text={message.text} onOpenLink={onOpenLink} /></div>
      {message.error && <div className="message-error">{message.error}</div>}
      <div className="transcript-agent-meta"><WorkDuration message={message} /><span className="transcript-meta-spacer" />{message.text && <CopyText text={message.text} label="复制" withText />}</div>
    </div>
  </div>;
}

function WorkDuration({ message }: { message: ConversationMessageData }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { if (message.status !== 'pending') return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [message.status]);
  if (message.status === 'failed') return <span className="transcript-status">失败</span>;
  if (message.status === 'cancelled') return <span className="transcript-status">已取消</span>;
  const started = Date.parse(message.createdAt);
  const ended = message.status === 'pending' ? clock : message.finishedAt ? Date.parse(message.finishedAt) : NaN;
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return <span className="transcript-status">{message.status === 'pending' ? '正在工作…' : '已完成'}</span>;
  const seconds = Math.floor((ended - started) / 1000);
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <span className="transcript-status">{message.status === 'pending' ? '正在工作' : '已工作'} {elapsed}</span>;
}

function CopyText({ text, label = '复制', withText = false }: { text: string; label?: string; withText?: boolean }) {
  const [done, setDone] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch { ToastQueue.negative('复制失败', { timeout: 5000 }); return; }
    setDone(true); if (timeout.current) clearTimeout(timeout.current); timeout.current = setTimeout(() => setDone(false), 2000);
  };
  const textLabel = done ? '已复制' : label;
  const control = <ActionButton isQuiet size="XS" aria-label={textLabel} onPress={copy}>{done ? <CheckmarkCircle /> : <Copy />}{withText && <Text>{textLabel}</Text>}</ActionButton>;
  return withText ? control : <TooltipTrigger delay={400}>{control}<Tooltip>{textLabel}</Tooltip></TooltipTrigger>;
}
