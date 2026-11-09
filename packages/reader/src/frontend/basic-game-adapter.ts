import type { BookLesson } from "../shared/book-lesson";
import type { BasicMaterial } from "../shared/basic-learning";
import { learningSourceSentences, learningTokens, wholeWordSpans, type LearningMaterial } from "../shared/learning-material";

/** View-only compatibility with the existing Worm game UI.
 * No Codex output, pretend translations, or authored teaching dependency is
 * manufactured. These exercises retain the independent basic material identity. */
export function basicGameMaterial(lesson: BookLesson, basic: BasicMaterial): LearningMaterial {
  const sources = learningSourceSentences(lesson.english);
  const vocabulary = basic.words.map(word => {
    const source = sources.find(sentence => sentence.id === word.sentenceId);
    if (!source || source.english !== word.context || source.english.slice(word.start, word.end) !== word.answer)
      throw new Error("基础词汇与当前原文不一致，已停止练习");
    const occurrence = wholeWordSpans(source.english, word.answer).indexOf(word.start);
    if (occurrence < 0) throw new Error("基础词汇位置无效，已停止练习");
    return {
      id: word.id, sentenceId: word.sentenceId, text: word.answer,
      sourceText: word.answer, answerText: word.answer,
      answerTokens: learningTokens(word.answer), occurrence,
      meaningZh: "", sentenceMeaningZh: "",
    };
  });
  const sentences = basic.sentences.map(sentence => {
    const source = sources.find(item => sentence.id.startsWith(`${item.id}:basic:`) &&
      item.english.includes(sentence.english));
    if (!source || !sentence.tokens.length || sentence.tokens.some((token, i) =>
      token.text !== learningTokens(sentence.english)[i]?.text))
      throw new Error("基础句子与当前原文不一致，已停止练习");
    return {
      ...source, id: sentence.id, english: sentence.english, translationZh: "",
      steps: [{
        id: sentence.id, kind: "target" as const, english: sentence.english,
        dependsOn: [], meaningZh: "", explanationZh: "",
        typingTokens: sentence.tokens,
        assembly: { analysisZh: "", tiles: [], correctOrder: [], bankOrder: [] },
      }],
    };
  });
  return {
    schemaVersion: 3, id: basic.id, materialVersion: basic.materialVersion,
    sourceVersion: basic.sourceVersion,
    source: { lessonId: lesson.id, bookId: lesson.bookId, bookFingerprint: lesson.sourceFingerprint, evidence: lesson.evidence },
    titleZh: lesson.titleZh, teaserZh: lesson.teaserZh, english: lesson.english,
    explanationZh: lesson.explanationZh, adaptation: lesson.adaptation, createdAt: lesson.createdAt,
    vocabulary, sentences, generator: {
      engine: "basic-source", policy: "source-v1", model: null,
      review: { approved: false, summaryZh: "基础原文练习没有经过人工或模型教学审核" },
    },
  };
}
