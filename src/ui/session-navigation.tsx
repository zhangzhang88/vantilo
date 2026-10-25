import { useState } from 'react';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import PinOn from '@react-spectrum/s2/icons/PinOn';
import { partitionSessionsByWorkspace, type ProjectEntry } from '../model/session-projects';
import { sidebarBody } from './workspace-sidebar';

export type SessionNavigationItem = {
  id: string; title: string; updatedAt: string; workspaceRoot: string | null; codexThreadId?: string | null; pinned?: boolean;
};

function folderLabel(path: string) {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path;
}

export function SessionNavigation({ sessions, projects, selectedId, workspaceRoot, loading, onOpen, onSessionMenu, onProjectMenu }: {
  sessions: readonly SessionNavigationItem[]; projects: readonly ProjectEntry[]; selectedId: string | null; workspaceRoot: string | null;
  loading: boolean; onOpen: (id: string) => void; onSessionMenu: (id: string) => void; onProjectMenu: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const groups = partitionSessionsByWorkspace(sessions, workspaceRoot, projects);
  const renderSessions = (records: readonly SessionNavigationItem[]) => [...records]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt))
    .map(record => <button key={record.id} type="button" className="session-entry" aria-current={record.id === selectedId ? 'page' : undefined}
      data-current={record.id === selectedId ? '' : undefined} title={record.workspaceRoot ? `${record.title} · ${record.workspaceRoot}` : record.title}
      onClick={() => onOpen(record.id)} onContextMenu={event => { event.preventDefault(); onSessionMenu(record.id); }}>
      {record.pinned && <span className="session-entry-pin" aria-label="已置顶"><PinOn aria-hidden="true" /></span>}
      <span className="session-entry-label">{record.title || '未命名会话'}</span>
    </button>);

  const unknown = groups.unassignedSessions.filter(record => record.codexThreadId);
  const unlinked = groups.unassignedSessions.filter(record => !record.codexThreadId);
  return <div className={`${sidebarBody} session-navigation`} aria-label="最近会话">
    <div className="session-section-heading">{workspaceRoot ? `当前项目 · ${folderLabel(workspaceRoot)}` : '最近'}</div>
    {renderSessions(groups.projectSessions)}
    {workspaceRoot && !loading && groups.projectSessions.length === 0 && <div className="session-empty">此项目暂无会话</div>}
    {loading && <div className="session-empty">正在载入历史会话…</div>}

    {groups.otherProjectGroups.map(group => {
      const isOpen = expanded.has(group.workspaceRoot);
      const Arrow = isOpen ? ChevronDown : ChevronRight;
      return <section key={group.workspaceRoot} aria-label={`项目 ${folderLabel(group.workspaceRoot)}`}>
        <button type="button" className="session-project-toggle" title={group.workspaceRoot} aria-expanded={isOpen}
          onContextMenu={event => { event.preventDefault(); onProjectMenu(group.workspaceRoot); }}
          onClick={() => setExpanded(previous => { const next = new Set(previous); isOpen ? next.delete(group.workspaceRoot) : next.add(group.workspaceRoot); return next; })}>
          <Arrow aria-hidden="true" />{group.pinned && <PinOn aria-label="已置顶" />}<span>项目 · {folderLabel(group.workspaceRoot)}</span>
        </button>
        {isOpen && (group.sessions.length ? renderSessions(group.sessions) : <div className="session-empty">此项目暂无会话</div>)}
      </section>;
    })}
    {groups.removedProjectGroups.map(group => <section key={`removed:${group.workspaceRoot}`}>
      <div className="session-section-heading unassigned-heading" title={group.workspaceRoot}>最近 · {folderLabel(group.workspaceRoot)}（项目已移除）</div>{renderSessions(group.sessions)}
    </section>)}
    {unknown.length > 0 && <section><div className="session-section-heading unassigned-heading">项目归属未知</div>{renderSessions(unknown)}</section>}
    {unlinked.length > 0 && <section><div className="session-section-heading unassigned-heading">未关联项目</div>{renderSessions(unlinked)}</section>}
  </div>;
}
