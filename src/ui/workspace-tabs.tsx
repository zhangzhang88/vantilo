import { useLayoutEffect, useRef, useState } from 'react';
import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Close from '@react-spectrum/s2/icons/Close';
import Comment from '@react-spectrum/s2/icons/Comment';
import GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
import More from '@react-spectrum/s2/icons/More';
import { SidebarToggle } from './sidebar-toggle';

export type BrowserTabInfo = { id: string; title: string; url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; error: BrowserTabError | null };
export type BrowserTabError = { kind: 'blocked'; reason: string; url: string } | { kind: 'failed'; code: number; description: string; url: string } | { kind: 'crashed' };

export function WorkspaceTabs({ conversationTitle, activeTabId, browserTabs, sidebarHidden, sidebarWidth, onToggleSidebar, onSelectConversation, onSelectBrowser, onCreateBrowser, onCloseBrowser, onBack, onForward }: {
  conversationTitle: string; activeTabId: string; browserTabs: BrowserTabInfo[]; sidebarHidden: boolean; sidebarWidth: number;
  onToggleSidebar: () => void; onSelectConversation: () => void; onSelectBrowser: (id: string) => void;
  onCreateBrowser: () => void; onCloseBrowser: (id: string) => void; onBack: () => void; onForward: () => void;
}) {
  const currentWeb = browserTabs.find(tab => tab.id === activeTabId);
  const barRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const bar = barRef.current?.getBoundingClientRect(); const tabs = tabsRef.current?.getBoundingClientRect();
      if (!bar || !tabs) return;
      const compact = window.innerWidth <= 600;
      const occupied = (compact ? 48 : 56) + (sidebarHidden ? 0 : compact ? 64 : sidebarWidth) + 16;
      const next = Math.max(0, bar.left + occupied - tabs.right - 8);
      setOffset(value => Math.abs(value - next) < 1 ? value : next);
    };
    measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure);
  }, [sidebarHidden, sidebarWidth]);
  const mac = navigator.platform.toLowerCase().includes('mac');
  return <div ref={barRef} className="app-toolbar" role="toolbar" aria-label="工作区导航" style={{ paddingInlineStart: mac ? 84 : 8 }}>
    <div className="app-toolbar-nav">
      <TooltipTrigger placement="bottom"><ActionButton isQuiet size="S" aria-label="后退" isDisabled={!currentWeb?.canGoBack} onPress={onBack}><ChevronLeft /></ActionButton><Tooltip>后退</Tooltip></TooltipTrigger>
      <TooltipTrigger placement="bottom"><ActionButton isQuiet size="S" aria-label="前进" isDisabled={!currentWeb?.canGoForward} onPress={onForward}><ChevronRight /></ActionButton><Tooltip>前进</Tooltip></TooltipTrigger>
      <SidebarToggle collapsed={sidebarHidden} onToggle={onToggleSidebar} />
    </div>
    <div ref={tabsRef} className="app-tabs" role="tablist" aria-label="已打开的标签页" style={{ marginInlineStart: offset }}>
      <button type="button" role="tab" aria-selected={activeTabId === 'conversation'} className={`app-tab ${activeTabId === 'conversation' ? 'selected' : ''}`} onClick={onSelectConversation} title={conversationTitle}>
        <Comment aria-hidden="true" /><span>{conversationTitle || '新会话'}</span>
      </button>
      {browserTabs.map(tab => <div className={`app-tab-wrap ${activeTabId === tab.id ? 'selected' : ''}`} key={tab.id}>
        <button type="button" role="tab" aria-selected={activeTabId === tab.id} className="app-tab" onClick={() => onSelectBrowser(tab.id)} title={tab.title}><GlobeGrid aria-hidden="true" /><span>{tab.title || '新标签页'}</span></button>
        {tab.loading && <span className="app-tab-loading" aria-hidden="true" />}
        <TooltipTrigger placement="bottom"><ActionButton isQuiet size="S" aria-label={`关闭${tab.title || '浏览器标签页'}`} onPress={() => onCloseBrowser(tab.id)}><Close /></ActionButton><Tooltip>关闭标签页</Tooltip></TooltipTrigger>
      </div>)}
    </div>
    <TooltipTrigger placement="bottom"><ActionButton isQuiet size="S" aria-label="新建浏览器标签页" onPress={onCreateBrowser}><Add /></ActionButton><Tooltip>新建浏览器标签页</Tooltip></TooltipTrigger>
    <div className="app-toolbar-spacer" />
    <TooltipTrigger placement="bottom"><ActionButton isQuiet size="S" aria-label="更多工作区操作（即将支持）" isDisabled><More /></ActionButton><Tooltip>更多工作区操作即将支持</Tooltip></TooltipTrigger>
  </div>;
}

export function ConversationHeading({ title }: { title: string }) {
  return <div className="conversation-title-bar"><span className="conversation-title" title={title}>{title || '新会话'}</span>
    <TooltipTrigger placement="bottom"><ActionButton isQuiet size="S" aria-label="更多会话操作（即将支持）" isDisabled><More /></ActionButton><Tooltip>更多会话操作即将支持</Tooltip></TooltipTrigger>
  </div>;
}
