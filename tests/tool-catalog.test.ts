import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkspaceAuthority } = require('../electron/workspace.cjs') as { WorkspaceAuthority:new(options:any)=>any };
const { ToolCatalog, TOOL_CATALOG_VERSION, jsonSchemaFor } = require('../electron/tool-catalog.cjs') as { ToolCatalog:new(options:any)=>any; TOOL_CATALOG_VERSION:number; jsonSchemaFor:(name:string)=>any };
const roots:string[]=[];
async function fixture(){const base=await mkdtemp(path.join(os.tmpdir(),'vantilo-catalog-test-'));roots.push(base);const root=path.join(base,'workspace');await mkdir(root);const workspace=new WorkspaceAuthority({userDataPath:path.join(base,'user-data')});await workspace.setWorkspace(root);return {base,root,workspace,catalog:new ToolCatalog({workspace})};}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});

describe('Vantilo read-only Tool Catalog',()=>{
  it('publishes only stable typed tool names with one-time approval metadata and strict schemas',async()=>{
    const {catalog}=await fixture();expect(TOOL_CATALOG_VERSION).toBe(1);
    expect(catalog.list()).toMatchObject([
      {name:'list_workspace_files',effect:'read-only',requiredScope:'workspace:read',approval:'every-call'},
      {name:'read_workspace_file',effect:'read-only',requiredScope:'workspace:read',approval:'every-call'}
    ]);
    expect(catalog.dynamicTools().map((tool:any)=>tool.name)).toEqual(['list_workspace_files','read_workspace_file']);
    expect(jsonSchemaFor('read_workspace_file')).toMatchObject({type:'object',additionalProperties:false,required:['reason','path']});
    expect(catalog.validateCall('read_workspace_file',{path:'file.txt',reason:'Need this source'}).input.path).toBe('file.txt');
    expect(()=>catalog.validateCall('read_workspace_file',{path:'file.txt',reason:'ok',extra:true})).toThrow(/published input schema/);
    expect(()=>catalog.validateCall('unknown_tool',{})).toThrow(/not available/);
  });
  it('rejects absolute, traversing, sensitive, and malformed inputs before execution',async()=>{
    const {catalog}=await fixture();
    for(const file of ['../outside','/etc/passwd','C:\\Windows\\win.ini','.env','private.pem']) {
      expect(()=>catalog.validateCall('read_workspace_file',{path:file,reason:'Read this'})).toThrow();
    }
    expect(()=>catalog.validateCall('list_workspace_files',{path:'../../',reason:'List outside'})).toThrow();
    expect(()=>catalog.validateCall('list_workspace_files',{limit:201,reason:'Too many'})).toThrow(/published input schema/);
  });
  it('executes through bounded WorkspaceAuthority and redacts credential-like text in output',async()=>{
    const {root,catalog}=await fixture();await writeFile(path.join(root,'README.md'),'hello\nTOKEN=abcdef123456\n');
    const result=await catalog.execute('read_workspace_file',{path:'README.md',reason:'Inspect project context'});
    expect(result).toMatchObject({ok:true,data:{path:'README.md',content:'hello\nTOKEN=[REDACTED]\n'}});
    expect(await catalog.execute('list_workspace_files',{reason:'Find relevant files',limit:10})).toMatchObject({ok:true,data:{directory:'.',files:[{path:'README.md'}]}});
  });
  it('times out execution and aborts the tool signal',async()=>{
    const {workspace}=await fixture();const catalog=new ToolCatalog({workspace,timeoutMs:15});const operation=vi.fn((_input:any,{signal}:any)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{code:'cancelled'})))));
    catalog.tools.get('list_workspace_files').execute=operation;
    await expect(catalog.execute('list_workspace_files',{reason:'List the project'})).rejects.toMatchObject({code:'timeout'});
    expect(operation).toHaveBeenCalledOnce();
  });
  it('propagates task cancellation into an active executor',async()=>{
    const {workspace}=await fixture();const catalog=new ToolCatalog({workspace,timeoutMs:1000});const controller=new AbortController();const operation=vi.fn((_input:any,{signal}:any)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))));
    catalog.tools.get('list_workspace_files').execute=operation;const pending=catalog.execute('list_workspace_files',{reason:'List the project'},{signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));controller.abort();await expect(pending).rejects.toMatchObject({code:'cancelled'});
  });
});
