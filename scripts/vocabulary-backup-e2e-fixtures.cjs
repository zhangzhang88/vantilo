'use strict';

const selection = (id, text, startOffset, overrides = {}) => ({
  id,
  document: { kind: 'book-chapter', bookId: 'synthetic-book', chapterId: 'chapter-1', documentId: 'reading:book:synthetic-book:chapter-1' },
  articleTitle: '合成测试章节',
  text,
  context: `A synthetic sentence containing ${text}.`,
  paragraphIndex: 3,
  startOffset,
  createdAt: '2026-10-30T00:00:00.000Z',
  translationZh: text === 'bank' ? '河岸' : text === 'look after' ? '照料' : '清晰的',
  translationSource: 'user',
  meaningVersion: 2,
  usageExplanationZh: `来自 ${id} 的合成笔记。`,
  familiarity: 2,
  ...overrides,
});

const selectionWithoutOffset = (id, text, overrides = {}) => {
  const item = selection(id, text, undefined, overrides);
  delete item.startOffset;
  return item;
};

const context = (text, startOffset, partOfSpeech, meaningZh, overrides = {}) => {
  const document = { kind: 'book-chapter', bookId: 'synthetic-book', chapterId: 'chapter-1', documentId: 'reading:book:synthetic-book:chapter-1' };
  const key = `${document.documentId}:3:${startOffset}:${encodeURIComponent(text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'))}`;
  return {
    key, document, paragraphIndex: 3, startOffset, text,
    paragraph: `This synthetic context uses ${text} in a sentence.`,
    sentence: `This synthetic context uses ${text} in a sentence.`,
    generatedAt: '2026-10-30T00:01:00.000Z', meaningSource: 'user', editedAt: '2026-10-30T00:02:00.000Z', meaningVersion: 2,
    sentenceTranslationZh: '这是一条合成句子译文。', meaningZh, explanationZh: `关于 ${text} 的合成中文解释。`,
    meaningEn: `Synthetic ${partOfSpeech} meaning for ${text}.`, explanationEn: `Synthetic English explanation for ${text}.`,
    examplesEn: [`A synthetic example sentence with ${text}.`], partOfSpeech, model: 'synthetic-model', provider: 'easycliproxy', ...overrides,
  };
};

const schedule = (text, reviewCount, familiarity, lastReviewedAt) => ({
  key: text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'), text, familiarity, intervalDays: 3,
  reviewCount, lastReviewedAt, dueAt: '2026-11-03T00:00:00.000Z',
});

function sourceData() {
  return {
    savedSelections: [
      selection('source-bank-noun', 'bank', 10, { translationZh: '河岸', usageExplanationZh: '源设备的河岸笔记。', familiarity: 3 }),
      selection('source-bank-verb', 'bank', 50, { translationZh: '使倾斜', usageExplanationZh: '动词用法：倾斜。', familiarity: 1 }),
      selection('source-look-after', 'look after', 90, { usageExplanationZh: '短语：照料。', familiarity: 4 }),
      selection('source-lucid', 'lucid', 140, { translationZh: '清晰的', familiarity: 2 }),
      selectionWithoutOffset('source-legacy-no-position', 'legacy'),
    ],
    contextualMeanings: [
      context('bank', 10, 'noun', '河岸', { examplesEn: ['We sat on the river bank.'] }),
      context('bank', 50, 'verb', '使倾斜', { examplesEn: ['The plane banked left.'] }),
      context('look after', 90, 'phrasal verb', '照料', { examplesEn: ['She looks after the garden.'] }),
    ],
    reviewSchedules: [
      schedule('bank', 9, 3, '2026-10-29T00:00:00.000Z'),
      schedule('look after', 2, 4, '2026-10-28T00:00:00.000Z'),
    ],
  };
}

function targetData() {
  return {
    savedSelections: [
      selection('target-bank-duplicate', 'bank', 10, { usageExplanationZh: '本机笔记必须保留。', familiarity: 5, translationZh: '本机释义' }),
      selection('target-bank-other-sense', 'bank', 70, { usageExplanationZh: '另一个来源出现位置。', familiarity: 2 }),
      selection('target-local-word', 'harbor', 200, { usageExplanationZh: '本机保留的词。', familiarity: 2 }),
      selection('target-lucid-other-source', 'lucid', 140, { document: { kind: 'book-chapter', bookId: 'target-book', chapterId: 'other-chapter', documentId: 'reading:book:target-book:other-chapter' }, articleTitle: '另一合成章节' }),
      selectionWithoutOffset('target-legacy-no-position', 'legacy'),
    ],
    contextualMeanings: [
      context('bank', 10, 'noun', '本机语境释义', { meaningSource: 'user', examplesEn: ['Local example stays.'] }),
      context('bank', 70, 'adjective', '安全的', { meaningSource: 'user', examplesEn: ['A banked curve.'] }),
    ],
    reviewSchedules: [schedule('bank', 6, 2, '2026-10-30T00:00:00.000Z')],
  };
}

module.exports = { sourceData, targetData };
