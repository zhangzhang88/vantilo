export type WorkspaceSession = { workspaceRoot: string | null };
export type ProjectEntry = { root: string; pinned: boolean; removed: boolean };
export type ProjectSessionGroup<T extends WorkspaceSession> = { workspaceRoot: string; pinned: boolean; sessions: T[] };

/** Keep every project's history visible while distinguishing pinned, removed, and unknown ownership. */
export function partitionSessionsByWorkspace<T extends WorkspaceSession>(sessions: readonly T[], workspaceRoot: string | null, projects: readonly ProjectEntry[] = []) {
  const projectSessions = workspaceRoot ? sessions.filter(session => session.workspaceRoot === workspaceRoot) : [] as T[];
  const entries = new Map(projects.map(project => [project.root, project]));
  for (const session of sessions) {
    if (session.workspaceRoot && !entries.has(session.workspaceRoot)) entries.set(session.workspaceRoot, { root: session.workspaceRoot, pinned: false, removed: false });
  }
  const activeRoots = [...entries.values()].filter(project => !project.removed && project.root !== workspaceRoot);
  const otherProjectGroups = activeRoots.map(project => ({
    workspaceRoot: project.root,
    pinned: project.pinned,
    sessions: sessions.filter(session => session.workspaceRoot === project.root),
  })).sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const removedProjectGroups = [...entries.values()].filter(project => project.removed).map(project => ({
    workspaceRoot: project.root,
    pinned: false,
    sessions: sessions.filter(session => session.workspaceRoot === project.root),
  })).filter(group => group.sessions.length > 0);
  return {
    projectSessions,
    otherProjectGroups,
    removedProjectGroups,
    unassignedSessions: sessions.filter(session => session.workspaceRoot === null),
  };
}
