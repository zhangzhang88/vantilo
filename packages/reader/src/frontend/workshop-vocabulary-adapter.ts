import type { BookLesson } from "../shared/book-lesson";
import type { BasicMaterial } from "../shared/basic-learning";
import { learningTokens, type LearningMaterial } from "../shared/learning-material";
import { parseWorkshopVocabulary, type WorkshopVocabulary } from "../shared/workshop-vocabulary";
import { basicGameMaterial } from "./basic-game-adapter";

/** Stage 1 owns its exact source tokens, game queue and run. No assembly preparation is required. */
export function workshopVocabularyMaterial(lesson:BookLesson,basic:BasicMaterial,items:WorkshopVocabulary[]):LearningMaterial {
  const base=basicGameMaterial(lesson,basic);
  const words=parseWorkshopVocabulary(items,lesson.english);
  const vocabulary=words.map(word=>({
    id:`v:${word.sentenceId}:${word.start}`,sentenceId:word.sentenceId,text:word.word,
    sourceText:word.answer,answerText:word.answer,answerTokens:learningTokens(word.answer),
    occurrence:word.occurrence,meaningZh:word.meaningZh,sentenceMeaningZh:word.sentenceMeaningZh,
    pronunciation:word.pronunciation,
  }));
  return {...base,id:`learning:workshop-vocabulary:${crypto.randomUUID()}`,materialVersion:crypto.randomUUID(),
    vocabulary,sentences:[],generator:{engine:"ordered-preview",policy:"ordered-preview-v1",model:null,review:{approved:false,scope:"vocabulary",summaryZh:"AI 词义及音标待学习者核实，原文词位已程序校验"}}};
}
