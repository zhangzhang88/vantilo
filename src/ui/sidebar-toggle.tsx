import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';

export function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? '显示侧栏' : '隐藏侧栏';
  return <TooltipTrigger placement="bottom" delay={400}>
    <ActionButton isQuiet size="S" aria-label={label} onPress={onToggle}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <rect x="2.75" y="3.25" width="14.5" height="13.5" rx="2" />
        <path d="M7.5 3.5v13" />
        {collapsed ? <path d="m10 8 2 2-2 2" /> : null}
      </svg>
    </ActionButton><Tooltip>{label}</Tooltip>
  </TooltipTrigger>;
}
