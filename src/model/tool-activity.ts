export type ToolActivityStage = 'started'|'completed'|'failed'|'denied'|'cancelled'|'interrupted';
export type ToolActivity = { approvalId:string;sessionId:string;taskId:string;toolName:string;stage:ToolActivityStage;summary:string;error:string|null };
export type TaskTerminal = { sessionId:string;taskId:string;status:string;cause?:'runtime-disconnected' };

export function toolActivityLabel(stage: ToolActivityStage): string {
  switch(stage) {
    case 'started': return '已批准，执行中';
    case 'completed': return '成功';
    case 'failed': return '失败';
    case 'denied': return '已拒绝';
    case 'cancelled': return '已取消';
    case 'interrupted': return '执行中断，结果未知';
  }
}

export function settleTaskToolActivities(activities:ToolActivity[], terminal:TaskTerminal):ToolActivity[] {
  const nextStage = terminal.status === 'cancelled' ? 'cancelled'
    : terminal.status === 'failed' && terminal.cause === 'runtime-disconnected' ? 'interrupted'
    : null;
  if(!nextStage) return activities;
  return activities.map(activity => activity.sessionId === terminal.sessionId && activity.taskId === terminal.taskId && activity.stage === 'started'
    ? { ...activity, stage:nextStage, summary:nextStage === 'interrupted' ? `${activity.summary}（Runtime 连接中断，操作结果未知）` : `${activity.summary}（任务已取消）`, error:nextStage === 'interrupted' ? 'Runtime connection lost; operation outcome is unknown.' : 'The task was cancelled.' }
    : activity);
}
