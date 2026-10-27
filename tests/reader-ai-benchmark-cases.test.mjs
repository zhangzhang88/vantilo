import { describe, expect, it } from 'vitest';
import { READER_AI_CASES, readerMeaningPrompt } from '../scripts/reader-ai-benchmark-cases.mjs';

describe('Reader AI benchmark fixtures', () => {
  it('contains exactly 20 unique synthetic single-word-in-context examples', () => {
    expect(READER_AI_CASES).toHaveLength(20);
    const pairKeys = READER_AI_CASES.map(x => x.word.toLowerCase() + ':' + x.sentence.toLowerCase());
    expect(new Set(pairKeys).size).toBe(20);
    for (const example of READER_AI_CASES) {
      expect(example).toEqual({
        word: expect.any(String),
        sentence: expect.any(String),
        expected: expect.any(String),
      });
      expect(example.word).toMatch(/^[a-z]+$/i);
      expect(example.sentence.length).toBeLessThanOrEqual(140);
      expect(example.expected.length).toBeLessThanOrEqual(8);
    }
  });

  it('contains polysemous comparisons and asks for bounded Chinese context only', () => {
    for (const word of ['charge', 'issue', 'bark', 'run', 'light', 'draft', 'pitch']) {
      expect(READER_AI_CASES.filter(item => item.word === word)).toHaveLength(2);
    }
    const prompt = readerMeaningPrompt(READER_AI_CASES[0]);
    expect(prompt).toContain('单词：imposed');
    expect(prompt).toContain('句子：The city imposed a curfew');
    expect(prompt).toContain('不翻译整句');
    expect(prompt).toContain('2至8个汉字');
  });
});
