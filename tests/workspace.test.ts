import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink, link, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkspaceAuthority, MAX_READ_BYTES } = require('../electron/workspace.cjs') as { WorkspaceAuthority:new(options:any)=>any; MAX_READ_BYTES:number };
const roots:string[]=[];
async function fixture(){const base=await mkdtemp(path.join(os.tmpdir(),'vantilo-workspace-test-'));roots.push(base);const root=path.join(base,'project');const userData=path.join(base,'user-data');await mkdir(root);const workspace=new WorkspaceAuthority({userDataPath:userData});await workspace.setWorkspace(root);return {base,root,userData,workspace};}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});

describe('authorized workspace boundary',()=>{
  it('persists only the explicit canonical workspace path and restores it',async()=>{
    const {root,userData}=await fixture();const document=JSON.parse(await readFile(path.join(userData,'workspace.json'),'utf8'));
    const canonical=await realpath(root);expect(document).toEqual({version:1,root:canonical});expect((await stat(userData)).mode&0o777).toBe(0o700);expect((await stat(path.join(userData,'workspace.json'))).mode&0o777).toBe(0o600);const restored=new WorkspaceAuthority({userDataPath:userData});await restored.load();expect(restored.state().root).toBe(canonical);
    const before=restored.state().revision;await restored.clearWorkspace();expect(restored.state()).toMatchObject({root:null,revision:before+1});
  });
  it('refuses the disk root, whole home, and non-directory selections',async()=>{
    const {workspace}=await fixture();await expect(workspace.setWorkspace(path.parse(os.homedir()).root)).rejects.toMatchObject({code:'workspace_too_broad'});
    await expect(workspace.setWorkspace(os.homedir())).rejects.toMatchObject({code:'workspace_too_broad'});
    await expect(workspace.setWorkspace(path.join(os.tmpdir(),'missing-vantilo-dir'))).rejects.toMatchObject({code:'invalid_workspace'});
  });
  it('lists bounded regular files while excluding sensitive names, build/dependency trees, and symlinks',async()=>{
    const {root,workspace}=await fixture();await mkdir(path.join(root,'src'));await mkdir(path.join(root,'node_modules'));await writeFile(path.join(root,'README.md'),'safe');await writeFile(path.join(root,'src','app.ts'),'code');await writeFile(path.join(root,'.env'),'secret=hidden');await writeFile(path.join(root,'token.json'),'private');await writeFile(path.join(root,'node_modules','ignored.js'),'ignored');await mkdir(path.join(root,'.ssh'));await writeFile(path.join(root,'.ssh','id_ed25519'),'key');await writeFile(path.join(root,'id_rsa'),'key');
    const outside=path.join(os.tmpdir(),`vantilo-outside-${Date.now()}`);await writeFile(outside,'outside');roots.push(outside);await symlink(outside,path.join(root,'escape.txt'));
    const result=await workspace.listFiles('.',200);
    expect(result.files.map((file:any)=>file.path).sort()).toEqual(['README.md','src/app.ts']);expect(result.files.some((file:any)=>file.path.includes('escape'))).toBe(false);
    expect(result.files.length).toBeLessThanOrEqual(200);await expect(workspace.openReadOnly('.ssh/id_ed25519')).rejects.toMatchObject({code:'sensitive_path'});await expect(workspace.openReadOnly('id_rsa')).rejects.toMatchObject({code:'sensitive_path'});
  });
  it('rejects absolute paths, traversal, symlink escapes, sensitive files, directories, binaries, and oversized files',async()=>{
    const {root,workspace}=await fixture();await mkdir(path.join(root,'subdir'));await writeFile(path.join(root,'safe.txt'),'actual text');await writeFile(path.join(root,'.env.local'),'SECRET=value');await writeFile(path.join(root,'private.pem'),'private key');await writeFile(path.join(root,'binary.dat'),Buffer.from([65,0,66]));await writeFile(path.join(root,'large.txt'),Buffer.alloc(MAX_READ_BYTES+1,65));
    const outside=path.join(os.tmpdir(),`vantilo-outside-read-${Date.now()}`);await writeFile(outside,'outside');roots.push(outside);await symlink(outside,path.join(root,'external.txt'));await link(outside,path.join(root,'hardlink.txt'));
    await expect(workspace.openReadOnly('../outside')).rejects.toMatchObject({code:'out_of_scope'});
    await expect(workspace.openReadOnly('/etc/passwd')).rejects.toMatchObject({code:'invalid_path'});
    await expect(workspace.openReadOnly('C:\\Users\\secret.txt')).rejects.toMatchObject({code:'invalid_path'});
    await expect(workspace.openReadOnly('external.txt')).rejects.toMatchObject({code:'symlink_rejected'});
    await expect(workspace.openReadOnly('hardlink.txt')).rejects.toMatchObject({code:'hard_link_rejected'});
    await expect(workspace.openReadOnly('.env.local')).rejects.toMatchObject({code:'sensitive_path'});
    await expect(workspace.openReadOnly('private.pem')).rejects.toMatchObject({code:'sensitive_path'});
    await expect(workspace.openReadOnly('subdir')).rejects.toMatchObject({code:'not_regular_file'});
    await expect(workspace.openReadOnly('binary.dat')).rejects.toMatchObject({code:'binary_file'});
    await expect(workspace.openReadOnly('large.txt')).rejects.toMatchObject({code:'file_too_large'});
    await expect(workspace.openReadOnly('safe.txt')).resolves.toMatchObject({path:'safe.txt',content:'actual text',bytes:11});
  });
  it('validates user-selected references inside the authorized workspace without reading file contents',async()=>{
    const {root,workspace}=await fixture();await mkdir(path.join(root,'docs'));await writeFile(path.join(root,'docs','guide.md'),'do not return this content');await writeFile(path.join(root,'.env'),'secret');
    const outside=path.join(os.tmpdir(),`vantilo-reference-outside-${Date.now()}`);await writeFile(outside,'private');roots.push(outside);await symlink(outside,path.join(root,'link.md'));await link(outside,path.join(root,'hardlink.md'));
    const canonicalRoot=workspace.state().root;
    await expect(workspace.validateReferences([path.join(canonicalRoot,'docs','guide.md'),path.join(canonicalRoot,'docs')])).resolves.toEqual([{path:'docs/guide.md',kind:'file'},{path:'docs',kind:'directory'}]);
    await expect(workspace.validateReferences([outside])).rejects.toMatchObject({code:'out_of_scope'});
    await expect(workspace.validateReferences([path.join(canonicalRoot,'link.md')])).rejects.toMatchObject({code:'symlink_rejected'});
    await expect(workspace.validateReferences([path.join(canonicalRoot,'hardlink.md')])).rejects.toMatchObject({code:'hard_link_rejected'});
    await expect(workspace.validateReferences([path.join(canonicalRoot,'.env')])).rejects.toMatchObject({code:'sensitive_path'});
    await expect(workspace.validateReferences(Array.from({length:21},(_,index)=>path.join(canonicalRoot,`${index}.txt`)))).rejects.toMatchObject({code:'invalid_input'});
  });
  it('bounds listings and refuses an unauthorized workspace',async()=>{
    const base=await mkdtemp(path.join(os.tmpdir(),'vantilo-no-workspace-'));roots.push(base);const workspace=new WorkspaceAuthority({userDataPath:base});
    await expect(workspace.listFiles('.')).rejects.toMatchObject({code:'workspace_unavailable'});
    const {root,workspace:authorized}=await fixture();for(let i=0;i<5;i++)await writeFile(path.join(root,`f${i}.txt`),'x');
    const result=await authorized.listFiles('.',2);expect(result.files).toHaveLength(2);expect(result.truncated).toBe(true);
  });
});
