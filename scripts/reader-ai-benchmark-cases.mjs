// Original, synthetic English-learning cases; no user's EPUB text or private data.
export const READER_AI_CASES = [
  { word: "imposed", sentence: "The city imposed a curfew after the protests.", expected: "实施" },
  { word: "charge", sentence: "The café did not charge us for water.", expected: "收费" },
  { word: "charge", sentence: "The soldiers began to charge across the field.", expected: "冲锋" },
  { word: "issue", sentence: "The magazine published a special issue about space.", expected: "期" },
  { word: "issue", sentence: "The editor will issue a correction tomorrow.", expected: "发布" },
  { word: "bark", sentence: "The dog began to bark at the stranger.", expected: "叫" },
  { word: "bark", sentence: "The tree's bark protects its trunk.", expected: "树皮" },
  { word: "run", sentence: "The charity runs a free library.", expected: "运营" },
  { word: "run", sentence: "The software can run on an older computer.", expected: "运行" },
  { word: "break", sentence: "The scientist made a breakthrough after a long break.", expected: "休息" },
  { word: "light", sentence: "The bag was surprisingly light.", expected: "轻" },
  { word: "light", sentence: "The room was lit by a small candle.", expected: "照亮" },
  { word: "draft", sentence: "She wrote the first draft of the speech.", expected: "草稿" },
  { word: "draft", sentence: "A cold draft came through the window.", expected: "气流" },
  { word: "bear", sentence: "Few plants can bear the extreme heat.", expected: "承受" },
  { word: "pitch", sentence: "The children played football on a muddy pitch.", expected: "球场" },
  { word: "pitch", sentence: "He gave a brief pitch to investors.", expected: "推介" },
  { word: "fine", sentence: "Drivers who park here may face a fine.", expected: "罚款" },
  { word: "case", sentence: "In this case, the result is different.", expected: "情况" },
  { word: "set", sentence: "The committee set a deadline for submissions.", expected: "设定" },
];
export function readerMeaningPrompt(item) {
  return [
    "任务：解释英语单词在所给句子中的具体中文意思。只解释被问到的单词，不翻译整句。",
    "请用简体中文，只输出一行：释义：<2至8个汉字>；依据：<不超过25个汉字的简要说明>。",
    "不引用外部资料，不需要额外分析过程。",
    "单词：" + item.word,
    "句子：" + item.sentence,
  ].join("\n");
}
