import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import type { ComponentType } from 'react';
import Asset from '@react-spectrum/s2/icons/Asset';
import Clock from '@react-spectrum/s2/icons/Clock';
import GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
import Home from '@react-spectrum/s2/icons/Home';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import Settings from '@react-spectrum/s2/icons/Settings';
import Tools from '@react-spectrum/s2/icons/Tools';

export function MainNavigation({ active, onHome, onBrowser }: { active: 'agent' | 'browser'; onHome: () => void; onBrowser: () => void }) {
  const entries: { name: string; Icon: ComponentType; action?: () => void; active?: boolean }[] = [
    { name: '对话', Icon: Home, action: onHome, active: active === 'agent' },
    { name: '空间', Icon: Asset }, { name: '技能', Icon: Lightbulb }, { name: '工具', Icon: Tools },
    { name: '浏览器', Icon: GlobeGrid, action: onBrowser, active: active === 'browser' }, { name: '任务', Icon: Clock },
  ];
  const renderEntry = ({ name, Icon, action, active: selected }: typeof entries[number]) => <div key={name} className={`app-rail-cell ${selected ? 'is-active' : ''}`}>
    <TooltipTrigger placement="end" delay={300}><ActionButton isQuiet size="S" aria-label={name} onPress={action} isDisabled={!action}><Icon /></ActionButton><Tooltip>{action ? name : `${name} · 即将支持`}</Tooltip></TooltipTrigger>
  </div>;
  return <nav className="app-rail" aria-label="主导航"><div className="app-rail-group">{entries.slice(0, 4).map(renderEntry)}<hr />{entries.slice(4).map(renderEntry)}</div><div className="app-rail-group"><div className="app-rail-cell"><TooltipTrigger placement="end" delay={300}><ActionButton isQuiet size="S" aria-label="设置" isDisabled><Settings /></ActionButton><Tooltip>设置 · 即将支持</Tooltip></TooltipTrigger></div></div></nav>;
}
