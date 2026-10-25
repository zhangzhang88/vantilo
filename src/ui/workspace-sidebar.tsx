import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export const sidebarBody = 'workspace-sidebar-body';

export function WorkspaceSidebar({ label, width, onResize, children, className = '' }: {
  label: string; width: number; onResize: (width: number) => void; children: ReactNode; className?: string;
}) {
  const drag = useRef<{ x: number; width: number; id: number } | null>(null);
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, width, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = drag.current;
    if (origin?.id === event.pointerId) onResize(Math.max(190, Math.min(360, origin.width + event.clientX - origin.x)));
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <aside className={`sidebar ${className}`} style={{ width }} aria-label={label}>
    {children}
    <div className="sidebar-resize-handle" role="separator" tabIndex={0} aria-orientation="vertical" aria-label="调整侧栏宽度" aria-valuemin={190} aria-valuemax={360} aria-valuenow={width}
      onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={() => onResize(230)}
      onKeyDown={event => { if (event.key === 'ArrowLeft') onResize(Math.max(190, width - 10)); else if (event.key === 'ArrowRight') onResize(Math.min(360, width + 10)); else return; event.preventDefault(); }} />
  </aside>;
}

export function SidebarHeading({ children }: { children: ReactNode }) {
  return <h2 className="sidebar-heading">{children}</h2>;
}
