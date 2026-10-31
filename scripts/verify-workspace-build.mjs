import { execFileSync } from 'node:child_process';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const kind = process.argv[2];
const manager = '/Volumes/Workspace/Development/Vantilo';
const uuid = '2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE';
const result = execFileSync('/bin/sh', ['/Volumes/Workspace/_System/verify-workspace-volume.sh'], { encoding: 'utf8' });
if (!result.includes(uuid) || !result.includes('APFS') || !/writable/i.test(result)) throw new Error('拒绝构建：Workspace 身份、APFS 或可写检查未通过');
const root = await realpath(process.cwd());
const builds = path.join(manager, 'workspaces');
const inExternalBuildCopy = root.startsWith(`${builds}${path.sep}`);
if (kind === 'app') {
  if (!inExternalBuildCopy) throw new Error('拒绝在正式源码工作区写入 dist；请从 Workspace 下独立构建副本运行 npm run build。');
} else if (kind === 'reader') {
  const output = process.env.VANTILO_READER_BUILD_OUTPUT;
  if (output) {
    const resolvedOutput = path.resolve(output);
    if (!path.isAbsolute(output) || !resolvedOutput.startsWith(`${manager}/`)) throw new Error('Reader 构建输出必须位于已验证的 Workspace 管理根目录');
    const parent = path.dirname(resolvedOutput);
    if (!(await stat(parent)).isDirectory()) throw new Error('Reader 构建输出的父目录必须存在且为目录');
    const actualParent = await realpath(parent);
    if (!actualParent.startsWith(`${manager}/`)) throw new Error('Reader 构建输出不能通过符号链接逃离 Workspace 管理根目录');
    try {
      if ((await lstat(resolvedOutput)).isSymbolicLink()) throw new Error('Reader 构建输出不能是符号链接');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  } else if (!inExternalBuildCopy) {
    throw new Error('拒绝在正式源码工作区写入 build/reader；请指定 Workspace 输出目录或从外置构建副本运行。');
  }
} else throw new Error('未知构建类型');
