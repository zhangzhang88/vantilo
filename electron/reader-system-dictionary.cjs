const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const NATIVE_HELPER = 'vantilo-dictionary';
const MAX_DICTIONARY_DEFINITION_BYTES = 1024 * 1024;
const MAX_HELPER_OUTPUT_BYTES = 2 * 1024 * 1024;
const SECTION_MARKER = /(?:^|\s)([A-F])\.\s+(?=(?:to\s+|(?:in)?transitive\b|reflexive\b|noun\b|verb\b|adjective\b|adverb\b|phrasal\b|pronoun\b|preposition\b|interjection\b|exclamation\b|conjunction\b|determiner\b|article\b|auxiliary\b|modal\b|numeral\b|number\b|abbreviation\b|prefix\b|suffix\b))/giu;
const STRUCTURAL_MARKER = /▸|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/gu;
const PART_OF_SPEECH = /^(?:(?:to\s+.+?\s+)?(?:(?:in)?transitive|reflexive|phrasal|auxiliary|modal)\s+verb|(?:(?:countable|uncountable|plural|mass)\s+)?(?:noun|verb|adjective|adverb|pronoun|preposition|interjection|exclamation|conjunction|determiner|article|numeral|number|abbreviation|prefix|suffix))\b/iu;

function chineseGlosses(text) {
  return (text.replace(/‹[^›]*›/gu, ' ').match(/[\p{Script=Han}][\p{Script=Han}…，、·；：？！。！]*/gu) ?? [])
    .map(gloss => gloss.trim())
    .filter(Boolean);
}

function definitionsWithoutExamples(text) {
  const definitions = [];
  let mode = 'definition';
  let senseNumber = '';
  let offset = 0;
  for (const match of text.matchAll(STRUCTURAL_MARKER)) {
    if (mode === 'definition') {
      const glosses = chineseGlosses(text.slice(offset, match.index ?? 0));
      if (glosses.length) definitions.push((senseNumber ? senseNumber + ' ' : '') + glosses.join('；'));
    }
    if (match[0] === '▸') {
      mode = 'example';
      senseNumber = '';
    } else {
      mode = 'definition';
      senseNumber = match[0];
    }
    offset = (match.index ?? 0) + match[0].length;
  }
  if (mode === 'definition') {
    const glosses = chineseGlosses(text.slice(offset));
    if (glosses.length) definitions.push((senseNumber ? senseNumber + ' ' : '') + glosses.join('；'));
  }
  return definitions;
}

// Keep every source-provided Chinese gloss, grouped by the dictionary's own
// A/B/C part-of-speech markers. Example text is omitted only from this preview;
// the unmodified full definition remains available in the expandable entry.
function quickChineseGloss(body) {
  const markers = [...body.matchAll(SECTION_MARKER)];
  if (!markers.length) return definitionsWithoutExamples(body).join('\n');
  const groups = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const start = (marker.index ?? 0) + marker[0].length;
    const end = index + 1 < markers.length ? markers[index + 1].index : body.length;
    const groupText = body.slice(start, end ?? body.length).trim();
    const heading = groupText.match(PART_OF_SPEECH)?.[0] ?? '';
    const definitionText = heading ? groupText.slice(heading.length).trim() : groupText;
    const definitions = definitionsWithoutExamples(definitionText);
    if (definitions.length) groups.push(`${marker[1]}. ${heading}`.trim() + '\n' + definitions.join('\n'));
  }
  return groups.join('\n');
}

function quickEnglishSummary(body, head) {
  const match = body.match(/(?:^|\s)([A-F])\.\s+([^①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳▸]+?)(?=\s*[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳▸]|$)/u);
  if (match) {
    const heading = match[2].trim();
    const afterHeading = body.slice((match.index ?? 0) + match[0].length);
    const firstSense = afterHeading.split(/[②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳▸]/u)[0].replace(/^①\s*/u, '').trim();
    if (/[\p{Script=Latin}]/u.test(firstSense)) return `${match[1]}. ${heading}\n${firstSense}`;
  }
  const plain = body.split(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳▸]/u)[0].trim();
  if (!/(?:^|\s)[A-F]\.\s+(?=(?:to\s+|(?:in)?transitive\b|reflexive\b|noun\b|verb\b|adjective\b|adverb\b|phrasal\b|pronoun\b|preposition\b|interjection\b|exclamation\b|conjunction\b|determiner\b|article\b|auxiliary\b|modal\b|numeral\b|number\b|abbreviation\b|prefix\b|suffix\b))/iu.test(body) && plain && /[\p{Script=Latin}]/u.test(plain)) {
    return [head, plain].filter(Boolean).join('\n');
  }
  return '';
}

function formatMacDictionaryReply(word, payload) {
  if (!payload || payload.word !== word || typeof payload.definition !== 'string' || !payload.definition.trim()) {
    throw new Error('系统词典未收录该词');
  }
  if (Buffer.byteLength(payload.definition, 'utf8') > MAX_DICTIONARY_DEFINITION_BYTES) {
    throw new Error('系统词典条目超过安全显示上限；已拒绝不完整结果');
  }
  const raw = payload.definition.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
  // Dictionary Services returns plain text in the user's active dictionary's
  // own presentation language. Preserve its wording; never AI-translate it or
  // present English-only content as a Chinese definition.
  const chunks = raw.split(/\s+\|\s+/);
  const lemma = chunks.length >= 2 ? chunks[0] : word;
  const head = chunks.length >= 3 ? chunks[1] : '';
  const body = chunks.length >= 3 ? chunks.slice(2).join(' | ') : chunks.length >= 2 ? chunks.slice(1).join(' | ') : raw;
  const containsChinese = /[\u3400-\u9fff]/u.test(body);
  const quickGloss = containsChinese ? quickChineseGloss(body) : '';
  const lemmaPrefix = lemma.toLocaleLowerCase('en-US') !== word ? lemma + '（原形） ·' : '';
  const summary = containsChinese ? quickGloss : quickEnglishSummary(body, head);
  const definition = [lemmaPrefix, summary || '展开查看完整词条'].filter(Boolean).join('\n');
  const fullDefinition = [lemmaPrefix, body].filter(Boolean).join('\n');
  const phonetic = head.startsWith('BrE ') || head.startsWith('AmE ') ? head : null;
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
        timeout: 3500, maxBuffer: MAX_HELPER_OUTPUT_BYTES, encoding: 'utf8',
        // Never inherit development API keys or other sensitive configuration.
        env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', HOME: process.env.HOME || '' },
      }));
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('系统词典辅助程序尚未构建，请先运行 npm run build:reader');
      if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('系统词典条目超过安全显示上限；已拒绝不完整结果');
      throw new Error('macOS 本机词典暂不可用');
    }
    let payload;
    try { payload = JSON.parse(stdout); } catch { throw new Error('系统词典返回无效数据'); }
    return formatMacDictionaryReply(word, payload);
  };
}

module.exports = { createMacDictionaryLookup, formatMacDictionaryReply, NATIVE_HELPER };
