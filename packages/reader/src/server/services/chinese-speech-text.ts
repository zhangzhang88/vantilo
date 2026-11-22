const digits = "零一二三四五六七八九";

function digitText(value: string): string {
  return [...value].map(digit => digits[Number(digit)]).join("");
}

function integerText(value: bigint): string {
  if (value < 10n) return digits[Number(value)];
  for (const [unit, label] of [[100_000_000n, "亿"], [10_000n, "万"], [1000n, "千"], [100n, "百"], [10n, "十"]] as const) {
    if (value < unit) continue;
    const rest = value % unit;
    return integerText(value / unit) + label + (rest ? (rest < unit / 10n ? "零" : "") + integerText(rest) : "");
  }
  return "";
}

/** Normalize synthesis input only; displayed text and playback cursors retain the original text. */
export function chineseSpeechText(text: string): string {
  // Year ranges can derail synthesis when a segment starts with Arabic digits and a dash.
  const withSpokenYears = text.replace(
    /(?<![A-Za-z0-9０-９_./．+＋\-－])([0-9０-９]{4})(?:[ \t　]*年)?[ \t　]*(?:—{1,2}|[-－–―~～〜至到])[ \t　]*([0-9０-９]{4})[ \t　]*年/g,
    (_match, first: string, last: string) => `${digitText(first.normalize("NFKC"))}年至${digitText(last.normalize("NFKC"))}年`,
  );
  return withSpokenYears.replace(/(?<![A-Za-z0-9０-９_./%％+\-])([+\-＋－]?(?:[0-9０-９]{1,3}(?:[,，][0-9０-９]{3})+|[0-9０-９]+)(?:[.．][0-9０-９]+)?)[ \t]*[%％](?![A-Za-z0-9０-９])/g, (_match, raw: string) => {
    const normalized = raw.normalize("NFKC").replaceAll(",", "");
    const sign = normalized.startsWith("-") ? "负" : normalized.startsWith("+") ? "正" : "";
    const [integer, fraction] = normalized.replace(/^[+-]/, "").split(".");
    const significant = integer.replace(/^0+(?=\d)/, "");
    const spoken = significant.length <= 16 ? integerText(BigInt(significant)).replace(/^一十/, "十") : digitText(significant);
    return "百分之" + sign + spoken + (fraction === undefined ? "" : "点" + digitText(fraction));
  });
}
