export function ConversationHeading({ title }: { title: string }) {
  return <div className="conversation-title-bar"><span className="conversation-title" title={title}>{title || '新会话'}</span></div>;
}
