import { expect, it } from "vitest";
import { chineseSpeechText } from "./chinese-speech-text.js";

it.each([
  ["38%", "百分之三十八"],
  ["0% 10% 11% 20% 100%", "百分之零 百分之十 百分之十一 百分之二十 百分之一百"],
  ["研究结果为38%，随后升至65%。", "研究结果为百分之三十八，随后升至百分之六十五。"],
  ["依次为38%，65%、77%,95%。", "依次为百分之三十八，百分之六十五、百分之七十七,百分之九十五。"],
  ["38.5% 0.05% 100.00%", "百分之三十八点五 百分之零点零五 百分之一百点零零"],
  ["３８．５％ 38 %", "百分之三十八点五 百分之三十八"],
  ["-3.8% +5% －２％", "百分之负三点八 百分之正五 百分之负二"],
  ["1,001% １０，０１０％", "百分之一千零一 百分之一万零一十"],
  ["110% 101% 10001% 100000001%", "百分之一百一十 百分之一百零一 百分之一万零一 百分之一亿零一"],
  ["00038% 0.0038%", "百分之三十八 百分之零点零零三八"],
  ["普通文字、数字38、已有百分之三十八。", "普通文字、数字38、已有百分之三十八。"],
  ["https://example.com/a38%20b 38%20 %38 rate38%", "https://example.com/a38%20b 38%20 %38 rate38%"],
])("normalizes Chinese speech percentages: %s", (text, expected) => {
  expect(chineseSpeechText(text)).toBe(expected);
});

it("bounds numeric conversion work for long input", () => {
  expect(chineseSpeechText("3".repeat(1200) + "%")).toBe("百分之" + "三".repeat(1200));
});

it.each([
  ["1919—1922年提出假设。1924—1925年发表一文。", "一九一九年至一九二二年提出假设。一九二四年至一九二五年发表一文。"],
  ["从２０１６ 年 – ２０１８ 年增长38%。", "从二零一六年至二零一八年增长百分之三十八。"],
  ["2000～2004年，2010年至2015年。", "二零零零年至二零零四年，二零一零年至二零一五年。"],
  ["50～60年，2026-11-16，编号X1919-1922，1919年。", "50～60年，2026-11-16，编号X1919-1922，1919年。"],
])("normalizes explicit four-digit Chinese year ranges: %s", (text, expected) => {
  expect(chineseSpeechText(text)).toBe(expected);
});
