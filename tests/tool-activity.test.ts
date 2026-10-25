import { describe, expect, it } from 'vitest';
import { settleTaskToolActivities, toolActivityLabel, type ToolActivity } from '../src/model/tool-activity';

const activity=(overrides:Partial<ToolActivity>={}):ToolActivity=>({approvalId:'approval-1',sessionId:'session-a',taskId:'task-a',toolName:'read_workspace_file',stage:'started',summary:'read file',error:null,...overrides});

describe('tool activity state reconciliation',()=>{
  it('marks only the matching in-flight task activity interrupted on Runtime disconnect',()=>{
    const source=[activity(),activity({approvalId:'approval-other-session',sessionId:'session-b',taskId:'task-b'}),activity({approvalId:'approval-other-task',taskId:'task-other'})];
    const next=settleTaskToolActivities(source,{sessionId:'session-a',taskId:'task-a',status:'failed',cause:'runtime-disconnected'});
    expect(next[0]).toMatchObject({stage:'interrupted',error:expect.stringContaining('outcome is unknown')});
    expect(next[1]).toEqual(source[1]);expect(next[2]).toEqual(source[2]);expect(source[0].stage).toBe('started');
    expect(toolActivityLabel(next[0].stage)).toBe('执行中断，结果未知');
  });
  it('marks explicit cancellation as cancelled, not interrupted',()=>{
    const [next]=settleTaskToolActivities([activity()],{sessionId:'session-a',taskId:'task-a',status:'cancelled'});
    expect(next).toMatchObject({stage:'cancelled',error:'The task was cancelled.'});expect(toolActivityLabel(next.stage)).toBe('已取消');
  });
  it('does not replace already terminal activity states on later task events',()=>{
    const source=[activity({stage:'completed'}),activity({approvalId:'failed',stage:'failed'}),activity({approvalId:'denied',stage:'denied'}),activity()];
    const next=settleTaskToolActivities(source,{sessionId:'session-a',taskId:'task-a',status:'failed',cause:'runtime-disconnected'});
    expect(next.slice(0,3)).toEqual(source.slice(0,3));expect(next[3].stage).toBe('interrupted');
    expect(settleTaskToolActivities(next,{sessionId:'session-a',taskId:'task-a',status:'cancelled'})).toEqual(next);
  });
  it('renders all reading-tool approval and execution terminal stages distinctly',()=>{
    expect(['started','completed','failed','denied','cancelled'].map(stage=>toolActivityLabel(stage as ToolActivity['stage']))).toEqual(['已批准，执行中','成功','失败','已拒绝','已取消']);
  });
  it('does not infer a Runtime interruption from an ordinary task failure',()=>{
    const source=[activity()];expect(settleTaskToolActivities(source,{sessionId:'session-a',taskId:'task-a',status:'failed'})).toEqual(source);
  });
});
