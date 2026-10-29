import fs from 'node:fs/promises';
import path from 'node:path';

export function runtimeModuleInventoryPlugin(filename) {
  const output = path.resolve(filename);
  return {
    name: 'vantilo-runtime-module-inventory',
    async generateBundle(_options, bundle) {
      const modules = new Set();
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') for (const id of Object.keys(item.modules)) modules.add(id);
      }
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, JSON.stringify([...modules].sort(), null, 2) + '\n');
    },
  };
}
