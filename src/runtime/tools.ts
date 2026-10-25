import { z } from 'zod';
import { realpath, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
export const listInput = z.object({ path: z.string().default('.') }).strict();
export const readInput = z.object({ path: z.string().min(1) }).strict();
export type ToolError = { code: 'INVALID_INPUT'|'OUT_OF_SCOPE'|'NOT_FOUND'|'IO_ERROR'; message: string };
export function createReadOnlyCatalog(root: string) {
  const base = path.resolve(root);
  async function scoped(input: unknown, schema: typeof listInput | typeof readInput) {
    const parsed=schema.safeParse(input); if(!parsed.success) throw Object.assign(new Error('Invalid tool input'),{code:'INVALID_INPUT'});
    const candidate=path.resolve(base, parsed.data.path);
    if(candidate!==base && !candidate.startsWith(base+path.sep)) throw Object.assign(new Error('Path is outside authorized workspace'),{code:'OUT_OF_SCOPE'});
    const realBase=await realpath(base); let real;
    try { real=await realpath(candidate); } catch { throw Object.assign(new Error('Path not found'),{code:'NOT_FOUND'}); }
    if(real!==realBase && !real.startsWith(realBase+path.sep)) throw Object.assign(new Error('Path is outside authorized workspace'),{code:'OUT_OF_SCOPE'});
    return real;
  }
  return {
    list: { name:'workspace.list_files', effect:'read-only', approval:'none', inputSchema:listInput, execute: async(input:unknown)=>readdir(await scoped(input,listInput),{withFileTypes:true}).then(xs=>xs.map(x=>({name:x.name,directory:x.isDirectory()}))) },
    read: { name:'workspace.read_file', effect:'read-only', approval:'none', inputSchema:readInput, execute: async(input:unknown)=>readFile(await scoped(input,readInput),'utf8') }
  };
}
