// @vitest-environment jsdom
import {expect,it} from "vitest";
import {createBasicMaterial} from "../shared/basic-learning";
import {learningSourceSentences} from "../shared/learning-material";
import {workshopVocabularyMaterial} from "./workshop-vocabulary-adapter";
import {newLearningProgress,currentLearningItem,recordLearningAction,setVocabularySkipped,startLearning} from "./learning-state";
import {lesson as fixture} from "../../tests/fixtures/learning";
it("starts stage 1 without any stage 2 material, using the original word-answer state machine",()=>{
  const english="The boy noticed the dog.";
  const lesson={...fixture,english};
  const vocabulary=[{sentenceIndex:0,sentence:learningSourceSentences(english)[0].english,word:"noticed",occurrence:0,
    meaningZh:"注意到",sentenceMeaningZh:"男孩注意到了那只狗。",pronunciation:"/ˈnoʊtɪst/"}];
  const game=workshopVocabularyMaterial(lesson,createBasicMaterial(lesson,"workshop-test"),vocabulary);
  expect(game.sentences).toHaveLength(0);
  expect(game.vocabulary[0].answerTokens).toEqual([{text:"noticed",start:0,end:7}]);
  expect(game.vocabulary[0].pronunciation).toBe("/ˈnoʊtɪst/");
  let progress={...newLearningProgress(game,[]),practiceStage:"vocabulary" as const,phase:"vocabulary-selection" as const};
  expect(progress.selectedVocabularyIds).toEqual([game.vocabulary[0].id]);
  progress={...startLearning(progress),practiceStage:"vocabulary" as const};
  expect(currentLearningItem(game,progress)?.id).toBe(game.vocabulary[0].id);
  progress={...recordLearningAction(game,progress,"answer","noticde"),practiceStage:"vocabulary" as const};
  expect(progress.vocabulary[game.vocabulary[0].id].errors).toBe(1);
  progress={...recordLearningAction(game,progress,"answer","noticed"),practiceStage:"vocabulary" as const};
  expect(progress.phase).toBe("vocabulary-complete");
  const skipped=setVocabularySkipped(game,{...newLearningProgress(game,[]),phase:"vocabulary-selection"},game.vocabulary[0].id,true);
  expect(skipped.selectedVocabularyIds).toEqual([]);
});
