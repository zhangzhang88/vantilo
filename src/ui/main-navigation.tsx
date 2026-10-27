import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import type { ComponentType } from 'react';
import Asset from '@react-spectrum/s2/icons/Asset';
import Clock from '@react-spectrum/s2/icons/Clock';
import Home from '@react-spectrum/s2/icons/Home';
import Folder from '@react-spectrum/s2/icons/Folder';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import Settings from '@react-spectrum/s2/icons/Settings';
import Tools from '@react-spectrum/s2/icons/Tools';

type MainSection = 'agent' | 'magazine-reader' | 'settings';

export function MainNavigation({ onHome, onMagazineReader, onSettings, activeSection = 'agent' }: {
  onHome: () => void;
  onMagazineReader: () => void;
  onSettings?: () => void;
  activeSection?: MainSection;
}) {
  const entries: { name: string; Icon: ComponentType; action?: () => void; active?: boolean }[] = [
    { name: '对话', Icon: Home, action: onHome, active: activeSection === 'agent' },
    { name: '阅读', Icon: Folder, action: onMagazineReader, active: activeSection === 'magazine-reader' },
    { name: '空间', Icon: Asset }, { name: '技能', Icon: Lightbulb }, { name: '工具', Icon: Tools }, { name: '任务', Icon: Clock },
  ];
  const renderEntry = ({ name, Icon, action, active }: typeof entries[number]) => <div key={name} className={`app-rail-cell ${active ? 'is-active' : ''}`}>
    <TooltipTrigger placement="end" delay={300}><ActionButton isQuiet size="S" aria-label={name} onPress={action} isDisabled={!action}><Icon /></ActionButton><Tooltip>{action ? name : `${name} · 即将支持`}</Tooltip></TooltipTrigger>
  </div>;
  return <nav className="app-rail" aria-label="主导航"><div className="app-rail-group">{entries.map(renderEntry)}</div><div className="app-rail-group"><div className={`app-rail-cell ${activeSection === 'settings' ? 'is-active' : ''}`}><TooltipTrigger placement="end" delay={300}><ActionButton isQuiet size="S" aria-label="设置" onPress={onSettings} isDisabled={!onSettings}><Settings /></ActionButton><Tooltip>设置</Tooltip></TooltipTrigger></div></div></nav>;
}