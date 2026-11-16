import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {mkdir, mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {assertUniversalOutputAbsent, universalOutputDirectory} from '../scripts/universal-output-path.mjs';

describe('Universal release output directory',()=>{
  it('scopes artifacts to an out/<version> directory',()=>{
    expect(universalOutputDirectory('/Volumes/Workspace/Development/Vantilo/workspaces/0.1.11-build','0.1.11'))
      .toBe(path.join('/Volumes/Workspace/Development/Vantilo/workspaces/0.1.11-build','out','0.1.11'));
  });

  it('supports semantic-version prerelease/build metadata',()=>{
    expect(universalOutputDirectory('/tmp/vantilo','0.1.12-rc.1+build.7'))
      .toBe(path.join('/tmp/vantilo','out','0.1.12-rc.1+build.7'));
  });

  it('supports an explicit isolated output root without changing the app version',()=>{
    expect(universalOutputDirectory('/tmp/vantilo','0.1.10','/tmp/vantilo-release-output/0.1.10-rebuild-abc123'))
      .toBe('/tmp/vantilo-release-output/0.1.10-rebuild-abc123/0.1.10');
  });

  it('wires the Universal packager to the version-scoped directory',()=>{
    const scriptPath=process.env.VANTILO_UNIVERSAL_SCRIPT_UNDER_TEST ?? path.join(process.cwd(),'scripts/build-mac-universal.mjs');
    const source=readFileSync(scriptPath,'utf8');
    expect(source).toContain('universalOutputDirectory(repo,metadata.version,');
  });

  it('rejects an existing version directory or a broken link at the output path',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'vantilo-release-output-'));
    try {
      const directory=universalOutputDirectory(root,'0.1.17');
      const link=universalOutputDirectory(root,'0.1.18');
      await expect(assertUniversalOutputAbsent(directory)).resolves.toBeUndefined();
      await mkdir(directory,{recursive:true});
      await symlink(path.join(root,'missing'),link);
      await expect(assertUniversalOutputAbsent(directory)).rejects.toThrow('发行产物目录已存在');
      await expect(assertUniversalOutputAbsent(link)).rejects.toThrow('发行产物目录已存在');
    } finally {
      await rm(root,{recursive:true,force:true});
    }
  });

  it('rejects relative roots and path traversal/non-version input',()=>{
    expect(()=>universalOutputDirectory('relative','0.1.11')).toThrow();
    expect(()=>universalOutputDirectory('/tmp/vantilo','0.1.11','relative-output')).toThrow();
    expect(()=>universalOutputDirectory('/tmp/vantilo','../0.1.11')).toThrow();
    expect(()=>universalOutputDirectory('/tmp/vantilo','0.1.11/../../tmp')).toThrow();
  });
});
