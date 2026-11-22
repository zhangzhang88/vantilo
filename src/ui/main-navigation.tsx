import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import type { ComponentType } from 'react';
import Home from '@react-spectrum/s2/icons/Home';
import Folder from '@react-spectrum/s2/icons/Folder';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import Settings from '@react-spectrum/s2/icons/Settings';

type MainSection = 'agent' | 'magazine-reader' | 'practice' | 'settings';

export function MainNavigation({ onHome, onMagazineReader, onPractice, onSettings, activeSection = 'agent' }: {
  onHome: () => void;
  onMagazineReader: () => void;
  onPractice: () => void;
  onSettings?: () => void;
  activeSection?: MainSection;
}) {
  const entries: { name: string; shortcut: string; Icon: ComponentType; action?: () => void; active?: boolean }[] = [
    { name: '对话', shortcut: '⌘1', Icon: Home, action: onHome, active: activeSection === 'agent' },
    { name: '阅读', shortcut: '⌘2', Icon: Folder, action: onMagazineReader, active: activeSection === 'magazine-reader' },
    { name: 'Practice Lab', shortcut: '⌘3', Icon: Lightbulb, action: onPractice, active: activeSection === 'practice' },
  ];
  const renderEntry = ({ name, shortcut, Icon, action, active }: typeof entries[number]) => <div key={name} className={`app-rail-cell ${active ? 'is-active' : ''}`}>
    <TooltipTrigger placement="end" delay={300}><ActionButton isQuiet size="S" aria-label={name} onPress={action} isDisabled={!action}><Icon /></ActionButton><Tooltip>{`${name}  ${shortcut}`}</Tooltip></TooltipTrigger>
  </div>;
  return <nav className="app-rail" aria-label="主导航"><div className="app-rail-group">{entries.map(renderEntry)}</div><div className="app-rail-group"><div className={`app-rail-cell ${activeSection === 'settings' ? 'is-active' : ''}`}><TooltipTrigger placement="end" delay={300}><ActionButton isQuiet size="S" aria-label="设置" onPress={onSettings} isDisabled={!onSettings}><Settings /></ActionButton><Tooltip>设置  ⌘,</Tooltip></TooltipTrigger></div></div></nav>;
}