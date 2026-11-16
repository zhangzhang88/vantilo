const acceptedChecks = ['source', 'development', 'package', 'distribution'];
const normalizedNotes = text => text?.replaceAll('\r\n', '\n').trim();

export function validateAcceptance(evidence, { version, commit, sha256 }) {
  if (evidence?.version !== version || evidence.commit !== commit || evidence.sha256 !== sha256) {
    throw new Error('验收记录的版本、提交或 ZIP SHA-256 与候选不一致');
  }
  for (const key of acceptedChecks) {
    const check = evidence[key];
    const allowed = key === 'distribution' ? ['PASS', 'ACCEPTED_BETA_RISKS'] : ['PASS'];
    if (!allowed.includes(check?.status) || typeof check.reference !== 'string' || !check.reference.trim()) {
      throw new Error(`验收记录缺少有效的 ${key} 状态和证据引用`);
    }
  }
}

export function betaPublicationPlan(target, remote) {
  const { commit, assets, notes, title } = target;
  const { mainState, localTag, remoteTag, release } = remote;
  if ([localTag, remoteTag].some(tag => tag !== null && tag !== commit)) {
    throw new Error('同名版本标签指向其他提交');
  }
  if (mainState !== 'contains' && mainState !== 'fast-forward') {
    throw new Error('origin/main 与候选提交已分叉，或本地缺少远端提交。请获取远端源码并重新核对候选');
  }
  if (remoteTag && mainState !== 'contains') throw new Error('远端已有该标签，但 main 缺少候选提交');

  const pendingAssets = new Map(assets.map(asset => [asset.name, asset]));
  if (release) {
    if (!remoteTag || release.prerelease !== true || release.name !== title || normalizedNotes(release.body) !== normalizedNotes(notes)) {
      throw new Error('同名 GitHub Release 的标签、Beta 状态或发布说明与候选不一致');
    }
    for (const { name, size, digest, state } of release.assets) {
      const expected = pendingAssets.get(name);
      if (!expected || state !== 'uploaded' || size !== expected.size || digest !== `sha256:${expected.sha256}`) {
        throw new Error(`GitHub Release 附件状态、大小或摘要有冲突：${expected?.name ?? '发现额外附件'}`);
      }
      pendingAssets.delete(name);
    }
    if (!release.draft && pendingAssets.size) throw new Error('已公开的 Beta 缺少发行附件');
  }
  return {
    pushSource: mainState === 'fast-forward',
    pushTag: !remoteTag,
    createDraft: !release,
    uploads: [...pendingAssets.values()],
    publish: !release || release.draft,
  };
}

export async function publishBeta(target, io, { publish = false } = {}) {
  let plan = betaPublicationPlan(target, await io.observe());
  if (!publish) return plan;

  async function advance(label, action, complete) {
    let actionError;
    try {
      await action();
    } catch (error) {
      actionError = error;
    }
    // An interrupted request may have reached GitHub. Read back before retrying.
    plan = betaPublicationPlan(target, await io.observe());
    if (!complete(plan)) {
      const detail = actionError?.message ? `。${actionError.message}` : '';
      throw new Error(`${label}未得到远端确认${detail}。处理后可重跑同一命令`);
    }
    io.confirmed?.(label);
  }

  if (plan.pushSource) await advance('推送源码', io.pushSource, next => !next.pushSource);
  if (plan.pushTag) await advance('推送标签', io.pushTag, next => !next.pushTag);
  if (plan.createDraft) await advance('创建草稿', io.createDraft, next => !next.createDraft);
  for (const asset of target.assets) {
    if (plan.uploads.some(pending => pending.name === asset.name)) {
      await advance(`上传 ${asset.name}`, () => io.upload(asset), next => !next.uploads.some(pending => pending.name === asset.name));
    }
  }
  if (plan.uploads.length) throw new Error('仍有附件待上传，请重跑以核对草稿');
  if (plan.publish) await advance('公开 Beta', io.publish, next => !next.publish);
  await io.verifyDownloads();
  return plan;
}
