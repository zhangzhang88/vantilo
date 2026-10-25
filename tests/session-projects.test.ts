import { describe, expect, it } from 'vitest';
import { partitionSessionsByWorkspace } from '../src/model/session-projects';

describe('workspace-scoped session navigation', () => {
  const sessions = [
    { id: 'a1', workspaceRoot: '/projects/a' },
    { id: 'a2', workspaceRoot: '/projects/a' },
    { id: 'b1', workspaceRoot: '/projects/b' },
    { id: 'legacy', workspaceRoot: null },
  ];

  it('keeps sessions from other projects visible and sorts pinned projects first', () => {
    const projects = [
      { root: '/projects/a', pinned: false, removed: false },
      { root: '/projects/b', pinned: true, removed: false },
    ];
    expect(partitionSessionsByWorkspace(sessions, '/projects/a', projects)).toEqual({
      projectSessions: [sessions[0], sessions[1]],
      otherProjectGroups: [{ workspaceRoot: '/projects/b', pinned: true, sessions: [sessions[2]] }],
      removedProjectGroups: [],
      unassignedSessions: [sessions[3]],
    });
  });

  it('shows all registered project groups when no project is active', () => {
    const projects = [
      { root: '/projects/a', pinned: false, removed: false },
      { root: '/projects/b', pinned: false, removed: false },
    ];
    expect(partitionSessionsByWorkspace(sessions, null, projects)).toEqual({
      projectSessions: [],
      otherProjectGroups: [
        { workspaceRoot: '/projects/a', pinned: false, sessions: [sessions[0], sessions[1]] },
        { workspaceRoot: '/projects/b', pinned: false, sessions: [sessions[2]] },
      ],
      removedProjectGroups: [],
      unassignedSessions: [sessions[3]],
    });
  });

  it('keeps removed-project conversation history accessible outside the project list', () => {
    expect(partitionSessionsByWorkspace(sessions, null, [
      { root: '/projects/a', pinned: false, removed: true },
      { root: '/projects/b', pinned: false, removed: false },
    ])).toMatchObject({
      otherProjectGroups: [{ workspaceRoot: '/projects/b', sessions: [sessions[2]] }],
      removedProjectGroups: [{ workspaceRoot: '/projects/a', sessions: [sessions[0], sessions[1]] }],
    });
  });
});
