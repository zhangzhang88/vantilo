import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/style.css';
import '../../src/ui/magazine-reader-module.css';
import { ReadingGrowthPage } from '../../src/reader/growth-page';

createRoot(document.getElementById('root')!).render(
  <div className="magazine-reader-module" style={{ width: '100vw', height: '100vh' }}>
    <ReadingGrowthPage onBack={() => {}} />
  </div>,
);
