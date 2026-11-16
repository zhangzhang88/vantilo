import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { publishBeta, validateAcceptance } from './release-beta-state.mjs';
import { assertUniversalOutputAbsent, universalOutputDirectory } from './universal-output-path.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const volume = '/Volumes/Workspace';
const outputRoot = `${volume}/Development/Vantilo/out`;
const uuid = '2BA2763B-3ED8-47DF-B569-EC8A2F0AFAAE';
const commitPattern = /^[a-f0-9]{40}$/;
const gibibyte = 1024 ** 3;

function command(file, args, { timeout = 30_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, {
      cwd: repo, timeout, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const httpStatus = /\bHTTP (\d{3})\b/.exec(stderr)?.[1];
      const reason = httpStatus ? `HTTP ${httpStatus}` : error.killed ? '超时' : `退出状态 ${error.code}`;
      reject(Object.assign(new Error(`${path.basename(file)} ${args[0]} 执行失败（${reason}）`), { code: error.code, httpStatus }));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const git = (...args) => command('/usr/bin/git', args);
const github = (endpoint, ...flags) => command('gh', ['api', '--hostname', 'github.com', ...flags, endpoint]).then(JSON.parse);
const hashText = value => createHash('sha256').update(value).digest('hex');

async function githubRepository() {
  const remotes = await Promise.all([
    git('remote', 'get-url', '--all', 'origin'), git('remote', 'get-url', '--push', '--all', 'origin'),
  ]);
  const slugs = remotes.map(remote => /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/i.exec(remote.trim())?.[1]);
  if (!slugs[0] || slugs[0].toLowerCase() !== slugs[1]?.toLowerCase()) {
    throw new Error('origin 必须有唯一且一致的 GitHub 读取与推送仓库');
  }
  const info = await github(`repos/${slugs[0]}`);
  if (info.permissions?.push !== true || info.private || info.default_branch !== 'main') {
    throw new Error('发布需要当前 GitHub 账号对 origin 公共仓库的推送权限及默认 main 分支');
  }
  if (info.full_name?.toLowerCase() !== slugs[0].toLowerCase()) throw new Error('origin 与 GitHub 返回的仓库身份不一致');
  return info.full_name;
}

async function isAncestor(older, newer) {
  try {
    await git('merge-base', '--is-ancestor', older, newer);
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    throw new Error('无法核对 main 与候选提交的关系，请先获取 origin/main 的最新历史');
  }
}

async function localTagCommit(tag) {
  try {
    await git('show-ref', '--verify', '--quiet', `refs/tags/${tag}`);
  } catch (error) {
    if (error.code === 1) return null;
    throw error;
  }
  return (await git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)).trim();
}

async function remoteTagCommit(base, tag) {
  let ref;
  try {
    ref = (await github(`${base}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  } catch (error) {
    if (error.httpStatus === '404') return null;
    throw error;
  }
  for (let depth = 0; depth < 5 && ref?.type === 'tag' && commitPattern.test(ref.sha); depth++) {
    ref = (await github(`${base}/git/tags/${ref.sha}`)).object;
  }
  if (ref?.type !== 'commit' || !commitPattern.test(ref.sha)) throw new Error('远端标签未指向可核验的提交');
  return ref.sha;
}

function remoteReader(slug, tag) {
  const base = `repos/${slug}`;
  return async commit => {
    const [main, localTag, remoteTag, pages] = await Promise.all([
      github(`${base}/git/ref/heads/main`), localTagCommit(tag), remoteTagCommit(base, tag),
      github(`${base}/releases?per_page=100`, '--paginate', '--slurp'),
    ]);
    const matches = pages.flat().filter(release => release.tag_name === tag);
    if (matches.length > 1) throw new Error('GitHub 有多个同名 Release，须先核对草稿与公开记录');
    const release = matches[0] ?? null;
    const remoteMain = main.object?.sha;
    if (main.object?.type !== 'commit' || !commitPattern.test(remoteMain)) throw new Error('无法核对 origin/main 的提交');
    const mainState = remoteMain === commit || await isAncestor(commit, remoteMain) ? 'contains'
      : await isAncestor(remoteMain, commit) ? 'fast-forward' : 'diverged';
    return { remoteMain, mainState, localTag, remoteTag, release };
  };
}

async function checkWorkspace(requiredGiB) {
  const result = await command('/bin/sh', [`${volume}/_System/verify-workspace-volume.sh`]);
  if (!result.startsWith('OK:') || !result.includes(uuid) || !result.includes(`mounted at ${volume} (`) || !/\bAPFS\b.*\bwritable\b/.test(result)) {
    throw new Error('Workspace 的 UUID、挂载位置、APFS 或可写状态校验失败');
  }
  const info = await statfs(volume);
  const available = info.bavail * info.bsize / gibibyte;
  if (requiredGiB !== undefined && available < Number(requiredGiB)) {
    throw new Error(`Workspace 剩余 ${available.toFixed(1)} GiB，低于所需 ${requiredGiB} GiB`);
  }
  if (await realpath(outputRoot) !== outputRoot) throw new Error('Workspace 发行输出根的真实路径与约定不符');
  return `Workspace APFS 可写，剩余 ${available.toFixed(1)} GiB`;
}

async function preflight({ version, directory, commit, tag, requiredGiB }) {
  const checks = [
    ['本地源码', async () => {
      const status = await git('status', '--porcelain=v1', '-z', '--untracked-files=all');
      const problems = [];
      if (status) problems.push('工作树有修改或未跟踪文件');
      await sourceMetadata(commit, version).catch(error => problems.push(error.message));
      if (problems.length) throw new Error(problems.join('，'));
      return commit;
    }],
    ['外置卷', () => checkWorkspace(requiredGiB)],
    ['目标产物', async () => {
      await assertUniversalOutputAbsent(directory);
      return directory;
    }],
    ['本地标签', async () => {
      const localTag = await localTagCommit(tag);
      if (localTag) throw new Error(`标签已存在并指向 ${localTag}，已有候选请使用 release:resume`);
      return tag;
    }],
    ['远端版本', async () => {
      const slug = await githubRepository();
      const remote = await remoteReader(slug, tag)(commit);
      const conflicts = [];
      if (remote.remoteTag) conflicts.push(`标签指向 ${remote.remoteTag}`);
      if (remote.release) conflicts.push(remote.release.draft ? 'GitHub 已有草稿' : 'GitHub 已公开该版本');
      if (remote.mainState === 'diverged') conflicts.push('origin/main 与候选已分叉');
      if (conflicts.length) throw new Error(conflicts.join('，'));
      return `${slug} main ${remote.remoteMain}`;
    }],
  ];
  const results = await Promise.allSettled(checks.map(([, check]) => check()));
  for (const [index, result] of results.entries()) {
    console.log(`${result.status === 'fulfilled' ? '通过' : '待处理'} · ${checks[index][0]} · ${result.value ?? result.reason?.message}`);
  }
  if (requiredGiB === undefined) console.log('按本次构建估算核对空间，可传入 --required-gib 验证。');
  if (results.some(result => result.status === 'rejected')) process.exitCode = 1;
}

async function sourceMetadata(commit, version) {
  const metadata = JSON.parse(await git('show', `${commit}:package.json`));
  if (metadata.version !== version) throw new Error(`候选提交中的版本为 ${metadata.version}，目标为 ${version}`);
}

async function regularReleaseFile(directory, name) {
  const file = path.join(directory, name);
  const info = await lstat(file);
  if (!info.isFile() || await realpath(file) !== file) throw new Error(`候选文件必须是版本目录中的普通文件：${name}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { file, name, size: info.size, sha256: hash.digest('hex') };
}

async function candidate({ directory, version, commit, evidencePath, notesPath, title }) {
  await checkWorkspace();
  await sourceMetadata(commit, version);
  if (await realpath(directory) !== directory) throw new Error('候选版本目录的真实路径不符');
  const stem = `Vantilo-Beta-${version}-universal`;
  const reportPath = path.join(directory, `${stem}.report.json`);
  if (!(await lstat(reportPath)).isFile()) throw new Error('构建报告必须是版本目录中的普通文件');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const lock = await git('show', `${commit}:package-lock.json`);
  const swiftSource = await git('show', `${commit}:scripts/reader-system-dictionary.swift`);
  if (report.sourceCommit !== commit || report.version !== version || report.sourceTreeClean !== true ||
      report.packageLockSha256 !== hashText(lock) || report.artifact !== `${stem}.zip` || report.architecture !== 'arm64+x86_64' ||
      report.bundledEpubCount !== 0 || report.defaultMagazineSeedIncluded !== false ||
      report.nativeDictionary?.sourceSha256 !== hashText(swiftSource) ||
      report.nativeDictionary.preparedMatchesFreshExceptUuid !== true) {
    throw new Error('构建报告的来源、架构、EPUB 或 Intel 词典完整性与候选不一致');
  }
  const [zip, checksum, notes, evidence] = await Promise.all([
    regularReleaseFile(directory, `${stem}.zip`), regularReleaseFile(directory, `${stem}.zip.sha256`),
    readFile(notesPath, 'utf8'), readFile(evidencePath, 'utf8').then(JSON.parse),
  ]);
  const checksumLine = `${zip.sha256}  ${zip.name}`;
  if (report.bytes !== zip.size || report.sha256 !== zip.sha256 || checksum.sha256 !== hashText(`${checksumLine}\n`)) {
    throw new Error('ZIP 实测大小、SHA-256 或校验文件与构建报告不一致');
  }
  validateAcceptance(evidence, { version, commit, sha256: zip.sha256 });
  if (!/^#{1,6}\s+一、本次更新\s*$/m.test(notes) || !/^#{1,6}\s+五、安装与更新说明\s*$/m.test(notes)) {
    throw new Error('请按发布手册准备简体中文发布说明，包含「一、本次更新」与「五、安装与更新说明」');
  }
  const defaultTitle = `Vantilo ${version} 测试版`;
  if (title && title !== defaultTitle && (!title.startsWith(`${defaultTitle} · `) || !/\p{Script=Han}/u.test(title.slice(defaultTitle.length)) || /[\r\n]/.test(title))) {
    throw new Error(`发布标题使用「${defaultTitle}」或添加简体中文更新摘要`);
  }
  return { commit, assets: [zip, checksum], checksumLine, notes, title: title || defaultTitle };
}

async function resume({ tag, publish, ...options }) {
  const target = await candidate(options);
  const slug = await githubRepository();
  const observe = remoteReader(slug, tag);
  const release = (operation, args, settings) => command('gh', ['release', operation, '--repo', `github.com/${slug}`, tag, ...args], settings);
  const push = ref => git('push', '--no-follow-tags', 'origin', ref);
  const downloadRoot = `https://github.com/${slug}/releases/download/${encodeURIComponent(tag)}`;
  const curl = (name, proxy, args) => command('/usr/bin/curl', [
    '--disable', '--silent', '--show-error', '--fail', '--location', '--proto', '=https', '--proto-redir', '=https',
    '--max-time', '12', ...proxy, ...args, `${downloadRoot}/${encodeURIComponent(name)}`,
  ]);
  async function verifyDownloads() {
    const [zip, checksum] = target.assets;
    const systemProxy = await macHttpsProxy();
    const routes = systemProxy ? [['--proxy', systemProxy], []] : [[]];
    for (const route of routes) {
      // Settle both reads before switching routes and keep the range request bounded.
      const [status, line] = await Promise.allSettled([
        curl(zip.name, route, ['--range', '0-0', '--max-filesize', '1', '--output', '/dev/null', '--write-out', '%{http_code}']),
        curl(checksum.name, route, ['--max-filesize', '4096']),
      ]);
      if (status.value === '206' && line.value?.trimEnd() === target.checksumLine) return;
    }
    throw new Error('Beta 已公开，ZIP 范围请求或校验文件的匿名下载暂未确认。恢复网络后可续跑核验');
  }
  const plan = await publishBeta(target, {
    observe: () => observe(target.commit),
    pushSource: () => push(`${target.commit}:refs/heads/main`),
    pushTag: async () => {
      if (!(await localTagCommit(tag))) await git('tag', '-a', tag, target.commit, '-m', target.title);
      if (await localTagCommit(tag) !== target.commit) throw new Error('本地标签已发生变化');
      await push(`refs/tags/${tag}:refs/tags/${tag}`);
    },
    createDraft: () => release('create', [
      '--draft', '--prerelease', '--verify-tag', '--title', target.title, '--notes-file', '-',
    ], { input: target.notes }),
    upload: asset => release('upload', ['--', asset.file], { timeout: 20 * 60_000 }),
    publish: () => release('edit', ['--draft=false', '--prerelease']),
    verifyDownloads,
    confirmed: label => console.log(`远端已确认 · ${label}`),
  }, { publish });
  if (publish || !plan.publish) {
    if (!publish) await verifyDownloads();
    console.log(`GitHub Beta 与匿名下载已验证 · https://github.com/${slug}/releases/tag/${encodeURIComponent(tag)}`);
    console.log('按发布手册更新 README 下载入口和本版发布记录。');
  } else {
    const pending = [plan.pushSource && '推送源码', plan.pushTag && '推送标签', plan.createDraft && '创建草稿',
      ...plan.uploads.map(asset => `上传 ${asset.name}`), plan.publish && '公开 Beta', '核验匿名下载'];
    console.log(`续跑计划 · ${pending.filter(Boolean).join(' → ')}`);
  }
}

async function macHttpsProxy() {
  if (process.env.https_proxy || process.env.HTTPS_PROXY || process.env.all_proxy || process.env.ALL_PROXY) return null;
  const settings = await command('/usr/sbin/scutil', ['--proxy']).catch(() => '');
  if (!/^\s*HTTPSEnable\s*:\s*1\s*$/m.test(settings)) return null;
  const host = /^\s*HTTPSProxy\s*:\s*([\w.-]+)\s*$/m.exec(settings)?.[1];
  const port = /^\s*HTTPSPort\s*:\s*(\d{1,5})\s*$/m.exec(settings)?.[1];
  return host && Number(port) > 0 && Number(port) <= 65535 ? `http://${host}:${port}` : null;
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const { values } = parseArgs({ args, options: {
    version: { type: 'string' }, commit: { type: 'string' }, 'required-gib': { type: 'string' },
    evidence: { type: 'string' }, notes: { type: 'string' }, title: { type: 'string' }, publish: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('npm run release:preflight -- --version <版本> [--commit <提交>] [--required-gib <GiB>]');
    console.log('npm run release:resume -- --version <版本> --commit <提交> --notes <说明.md> --evidence <验收.json> [--title <中文标题>] [--publish]');
    return;
  }
  const { version } = values;
  const directory = universalOutputDirectory(repo, version, outputRoot);
  const tag = `v${version}`;
  await git('check-ref-format', `refs/tags/${tag}`);
  const commit = values.commit ?? (await git('rev-parse', '--verify', 'HEAD')).trim();
  if (!commitPattern.test(commit)) throw new Error('--commit 必须是完整的 40 位 Git 提交 SHA');
  await git('cat-file', '-e', `${commit}^{commit}`);
  const options = { version, directory, tag, commit };
  if (mode === 'preflight') {
    if (values.publish || values.evidence || values.notes || values.title) throw new Error('预检支持 --version、--commit 和 --required-gib');
    const requiredGiB = values['required-gib'];
    if (requiredGiB !== undefined && (!Number.isFinite(Number(requiredGiB)) || Number(requiredGiB) <= 0)) {
      throw new Error('--required-gib 必须是大于零的数字');
    }
    await preflight({ ...options, requiredGiB });
  } else if (mode === 'resume' && values.commit && values.notes && values.evidence && values['required-gib'] === undefined) {
    await resume({ ...options, notesPath: values.notes, evidencePath: values.evidence, title: values.title, publish: values.publish });
  } else {
    throw new Error('请使用 --help 查看发布预检与续跑命令');
  }
}

main().catch(error => {
  console.error(`发布检查停止 · ${error.message}`);
  process.exitCode = 1;
});
