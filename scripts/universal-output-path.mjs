import path from 'node:path';

const safeVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function universalOutputDirectory(repoRoot, version, outputRoot = path.join(repoRoot, 'out')) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new Error('Universal build repository root must be absolute');
  }
  if (typeof outputRoot !== 'string' || !path.isAbsolute(outputRoot)) {
    throw new Error('Universal build output root must be absolute');
  }
  if (typeof version !== 'string' || !safeVersionPattern.test(version)) {
    throw new Error('Universal build version must be a path-safe semantic version');
  }
  return path.join(outputRoot, version);
}
