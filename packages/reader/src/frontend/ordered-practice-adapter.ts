import type { BasicMaterial } from "../shared/basic-learning";
import type { BookLesson } from "../shared/book-lesson";
import { learningTokens, type LearningMaterial } from "../shared/learning-material";
import { basicGameMaterial } from "./basic-game-adapter";
import { parseOrderedExercises, type OrderedExercise } from "../shared/ordered-practice";

/** Temporary view adapter: the ordered list, including repeated items, remains authoritative. */
export function orderedPracticeMaterial(lesson: BookLesson, basic: BasicMaterial, exercises: OrderedExercise[]): LearningMaterial {
  const sentences = parseOrderedExercises(exercises).map((item, index) => {
    const english = item.sentence, tokens = learningTokens(english);
    const id = `ordered:${index}`;
    return { id, english, paragraphIndex: 0, startOffset: 0, translationZh: item.chinese.trim(), steps: [{
      id, english, meaningZh: item.chinese.trim(), explanationZh: "", typingTokens: tokens,
      ...(item.pronunciation ? { pronunciation: item.pronunciation } : {}),
      // The existing game queue needs a non-skippable item; this is not AI-authored teaching metadata.
      kind: "target" as const, dependsOn: [], assembly: { analysisZh: "", tiles: [], correctOrder: [], bankOrder: [] },
    }] };
  });
  const base = basicGameMaterial(lesson, basic);
  return { ...base, id: `learning:ordered-preview:${crypto.randomUUID()}`, materialVersion: crypto.randomUUID(), vocabulary: [], sentences,
    generator: { engine: "ordered-preview", policy: "ordered-preview-v1", model: null, review: { approved: false, summaryZh: "临时练习未经教学审核" } } };
}
