const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const NATIVE_HELPER = 'vantilo-dictionary';
const MAX_ENTRY_CHARS = 3000;

// Extract only literal primary Chinese glosses from Dictionary Services' compact
// bilingual text. The complete entry remains available behind an expander.
function quickChineseGloss(body) {
  const firstSense = body.split(/▸|[②③④⑤⑥⑦⑧⑨]|\bB\.\s+(?:intransitive|transitive|noun|verb)/u)[0];
  const glossText = firstSense.replace(/‹[^›]*›/gu, ' ');
  const glosses = [...glossText.matchAll(/[\p{Script=Han}][\p{Script=Han}…，、·]{0,21}/gu)]
    .map(match => match[0].replace(/[，、·]+$/u, '').trim())
    .filter(gloss => gloss.length >= 2);
  return [...new Set(glosses)].slice(0, 2).join('；');
}

function formatMacDictionaryReply(word, payload) {
  if (!payload || payload.word !== word || typeof payload.definition !== 'string' ||
      !payload.definition.trim() || payload.definition.length > 8000) {
    throw new Error('系统词典未收录该词');
  }
  const raw = payload.definition.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Dictionary Services returns plain text in the user's active dictionary's
  // own presentation language. Preserve its wording; never AI-translate it or
  // present English-only content as a Chinese definition.
  const chunks = raw.split(/\s+\|\s+/);
  const lemma = (chunks.length >= 2 ? chunks[0] : word).slice(0, 100);
  const head = chunks.length >= 3 ? chunks[1] : '';
  const body = (chunks.length >= 3 ? chunks.slice(2).join(' | ') : chunks.length >= 2 ? chunks.slice(1).join(' | ') : raw)
    .slice(0, MAX_ENTRY_CHARS);
  const containsChinese = /[\u3400-\u9fff]/u.test(body);
  const quickGloss = containsChinese ? quickChineseGloss(body) : '';
  const lemmaPrefix = lemma.toLocaleLowerCase('en-US') !== word ? lemma + '（原形） · ' : '';
  const definition = lemmaPrefix + (quickGloss || body.slice(0, 170).trim());
  const fullDefinition = lemmaPrefix + body;
  const phonetic = head.startsWith('BrE ') || head.startsWith('AmE ') ? head.slice(0, 160) : null;
  return {
    word,
    phonetic,
    usPhonetic: null,
    ukPhonetic: null,
    usAudioUrl: '',
    ukAudioUrl: '',
    // Compact gloss first; a separate full entry remains available on demand.
    definitionsZh: containsChinese ? [
      { definition, partOfSpeech: null, example: null, source: 'macos-dictionary' },
      { definition: fullDefinition, partOfSpeech: null, example: null, source: 'macos-dictionary-full' },
    ] : [],
    definitionsEn: containsChinese ? [] : [
      { definition, partOfSpeech: null, example: null, source: 'macos-dictionary' },
      { definition: fullDefinition, partOfSpeech: null, example: null, source: 'macos-dictionary-full' },
    ],
    englishDefinitionSource: containsChinese ? 'unavailable' : 'exact',
    englishLookupWord: word,
    youdaoAvailable: false,
    dictionaryApiAvailable: false,
  };
}

function createMacDictionaryLookup({ assetsDir, execImpl = run, platform = process.platform }) {
  const helper = path.join(assetsDir, 'native', NATIVE_HELPER);
  return async function lookup(word) {
    if (platform !== 'darwin') throw new Error('本机词典仅支持 macOS');
    if (typeof word !== 'string' || !/^[a-z]+(?:[-'][a-z]+)*$/.test(word) || word.length > 120) {
      throw new Error('无效的词典查询');
    }
    let stdout;
    try {
      ({ stdout } = await execImpl(helper, [word], {
        timeout: 3500, maxBuffer: 64 * 1024, encoding: 'utf8',
        // Never inherit development API keys or other sensitive configuration.
        env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', HOME: process.env.HOME || '' },
      }));
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('系统词典辅助程序尚未构建，请先运行 npm run build:reader');
      throw new Error('macOS 本机词典暂不可用');
    }
    let payload;
    try { payload = JSON.parse(stdout); } catch { throw new Error('系统词典返回无效数据'); }
    return formatMacDictionaryReply(word, payload);
  };
}

module.exports = { createMacDictionaryLookup, formatMacDictionaryReply, NATIVE_HELPER };