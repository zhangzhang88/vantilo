import { describe, expect, it, vi } from 'vitest';
import { betaPublicationPlan, publishBeta, validateAcceptance } from '../scripts/release-beta-state.mjs';

const target = {
  commit: 'a'.repeat(40), version: '0.1.17', sha256: 'f'.repeat(64),
  title: 'Vantilo 0.1.17 测试版', notes: '## 一、本次更新\n\n- 阅读体验更新。',
  assets: [
    { name: 'Vantilo-Beta-0.1.17-universal.zip', size: 1234, sha256: 'f'.repeat(64) },
    { name: 'Vantilo-Beta-0.1.17-universal.zip.sha256', size: 101, sha256: 'b'.repeat(64) },
  ],
};

function harness() {
  const remote = { mainState: 'fast-forward', localTag: null, remoteTag: null, release: null };
  const io = {
    observe: async () => structuredClone(remote),
    pushSource: vi.fn(async () => { remote.mainState = 'contains'; }),
    pushTag: vi.fn(async () => { remote.localTag = remote.remoteTag = target.commit; }),
    createDraft: vi.fn(async () => {
      remote.release = { name: target.title, body: target.notes.replaceAll('\n', '\r\n'), draft: true, prerelease: true, assets: [] };
    }),
    upload: vi.fn(async asset => {
      remote.release.assets.push({ ...asset, state: 'uploaded', digest: `sha256:${asset.sha256}` });
    }),
    publish: vi.fn(async () => { remote.release.draft = false; }),
    verifyDownloads: vi.fn(async () => {}),
  };
  return { remote, io };
}

describe('Beta 发布续跑', () => {
  it('预览只检查状态', async () => {
    const { io } = harness();
    await expect(publishBeta(target, io)).resolves.toEqual({
      pushSource: true, pushTag: true, createDraft: true, uploads: target.assets, publish: true,
    });
    for (const step of Object.values(io).filter(vi.isMockFunction)) expect(step).not.toHaveBeenCalled();
  });

  it('上传返回超时但远端已有正确文件时继续，下一次只核验下载', async () => {
    const { remote, io } = harness();
    const upload = io.upload.getMockImplementation();
    io.upload.mockImplementationOnce(async asset => {
      await upload(asset);
      throw new Error('超时');
    });
    await publishBeta(target, io, { publish: true });
    await publishBeta(target, io, { publish: true });
    expect(remote.release.draft).toBe(false);
    expect(io.pushSource).toHaveBeenCalledTimes(1);
    expect(io.pushTag).toHaveBeenCalledTimes(1);
    expect(io.createDraft).toHaveBeenCalledTimes(1);
    expect(io.upload.mock.calls).toEqual(target.assets.map(asset => [asset]));
    expect(io.publish).toHaveBeenCalledTimes(1);
    expect(io.verifyDownloads).toHaveBeenCalledTimes(2);
  });

  it('第二个附件未上传时保留草稿，续跑只补传缺失附件', async () => {
    const { remote, io } = harness();
    const upload = io.upload.getMockImplementation();
    io.upload.mockImplementationOnce(upload).mockRejectedValueOnce(new Error('连接中断'));
    await expect(publishBeta(target, io, { publish: true })).rejects.toThrow('未得到远端确认');
    expect(remote.release.draft).toBe(true);
    expect(io.publish).not.toHaveBeenCalled();
    await publishBeta(target, io, { publish: true });
    expect(io.upload.mock.calls).toEqual([[target.assets[0]], [target.assets[1]], [target.assets[1]]]);
    expect(io.createDraft).toHaveBeenCalledTimes(1);
  });

  it('公开后匿名下载超时时，续跑只重试下载核验', async () => {
    const { remote, io } = harness();
    io.verifyDownloads.mockRejectedValueOnce(new Error('匿名下载超时'));
    await expect(publishBeta(target, io, { publish: true })).rejects.toThrow('匿名下载超时');
    expect(remote.release.draft).toBe(false);
    await publishBeta(target, io, { publish: true });
    expect(io.publish).toHaveBeenCalledTimes(1);
    expect(io.upload).toHaveBeenCalledTimes(2);
    expect(io.verifyDownloads).toHaveBeenCalledTimes(2);
  });

  it.each(['localTag', 'remoteTag'])('同名标签 %s 指向其他提交时停止在推送前', async field => {
    const { remote, io } = harness();
    remote[field] = 'c'.repeat(40);
    await expect(publishBeta(target, io, { publish: true })).rejects.toThrow('同名版本标签');
    expect(io.pushSource).not.toHaveBeenCalled();
  });

  it('main 分叉时停止在推送前', async () => {
    const { remote, io } = harness();
    remote.mainState = 'diverged';
    await expect(publishBeta(target, io, { publish: true })).rejects.toThrow('已分叉');
    expect(io.pushSource).not.toHaveBeenCalled();
  });

  it.each([{ state: 'starter' }, { digest: undefined }, { digest: 'sha256:other' }, { size: 1 }])(
    '已有附件身份不一致时保护草稿和现有文件 %j', async changes => {
      const { remote, io } = harness();
      await io.pushSource();
      await io.pushTag();
      await io.createDraft();
      await io.upload(target.assets[0]);
      Object.assign(remote.release.assets[0], changes);
      expect(() => betaPublicationPlan(target, remote)).toThrow('附件状态、大小或摘要有冲突');
      expect(io.publish).not.toHaveBeenCalled();
    },
  );

  it('同名稳定版、说明变化和公开版缺件均停止', async () => {
    const { remote, io } = harness();
    await io.pushSource();
    await io.pushTag();
    await io.createDraft();
    expect(() => betaPublicationPlan(target, { ...remote, release: { ...remote.release, prerelease: false } })).toThrow('Beta 状态');
    expect(() => betaPublicationPlan(target, { ...remote, release: { ...remote.release, body: '不同正文' } })).toThrow('发布说明');
    expect(() => betaPublicationPlan(target, { ...remote, release: { ...remote.release, draft: false } })).toThrow('已公开的 Beta 缺少');
  });

  it('验收状态必须与版本、提交和 ZIP 一致，明确接受的分发风险单独记录', () => {
    const { version, commit, sha256 } = target;
    const pass = { status: 'PASS', reference: '本次候选测试报告' };
    const record = {
      version, commit, sha256, source: pass, development: pass, package: pass,
      distribution: { status: 'ACCEPTED_BETA_RISKS', reference: '本版四项分发风险实测及接受记录' },
    };
    expect(() => validateAcceptance(record, target)).not.toThrow();
    expect(() => validateAcceptance({ ...record, sha256: target.assets[1].sha256 }, target)).toThrow('ZIP SHA-256');
    expect(() => validateAcceptance({ ...record, package: record.distribution }, target)).toThrow('package');
    expect(() => validateAcceptance({ ...record, distribution: { status: 'ACCEPTED_BETA_RISKS' } }, target)).toThrow('distribution');
  });
});
