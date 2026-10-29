const digits = "零一二三四五六七八九";

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
  return text.replace(/(?<![A-Za-z0-9０-９_./%％+\-])([+\-＋－]?(?:[0-9０-９]{1,3}(?:[,，][0-9０-９]{3})+|[0-9０-９]+)(?:[.．][0-9０-９]+)?)[ \t]*[%％](?![A-Za-z0-9０-９])/g, (_match, raw: string) => {
    const normalized = raw.normalize("NFKC").replaceAll(",", "");
    const sign = normalized.startsWith("-") ? "负" : normalized.startsWith("+") ? "正" : "";
    const [integer, fraction] = normalized.replace(/^[+-]/, "").split(".");
    const significant = integer.replace(/^0+(?=\d)/, "");
    const spoken = significant.length <= 16 ? integerText(BigInt(significant)).replace(/^一十/, "十") : [...significant].map(digit => digits[Number(digit)]).join("");
    return "百分之" + sign + spoken + (fraction === undefined ? "" : "点" + [...fraction].map(digit => digits[Number(digit)]).join(""));
  });
}
