// Vantilo-only, fail-closed adapter for the source Reader's vocabulary detail.
// The original magazine-reader project is read-only. The full macOS entry is
// display-only metadata; it must not be shown as a second Chinese definition.

export function adaptNativeDictionaryWordDetail(source) {
  const replacements = [
    [
      '<div className="word-detail-section-title"><span>中文词典释义</span></div>',
      '<div className="word-detail-section-title"><span>中文词典释义</span>' +
        '{dictionary?.definitionsZh.some((item) => (item.source as string) === "macos-dictionary") && ' +
        '<small className="word-detail-definition-source">macOS 本机词典</small>}</div>',
    ],
    [
      'dictionary.definitionsZh.map((item, index) =>',
      'dictionary.definitionsZh.filter((item) => (item.source as string) !== "macos-dictionary-full").map((item, index) =>',
    ],
    [
      '          </div>\n        ) : <p className="word-detail-empty">中文词典释义暂不可用。</p>}',
      '            <VantiloDictionaryDisclosure dictionary={dictionary} language="zh" />\n' +
        '          </div>\n        ) : <p className="word-detail-empty">中文词典释义暂不可用。</p>}',
    ],
    [
      'const englishDefinitions = dictionary?.definitionsEn ?? [];',
      'const englishDefinitions = (dictionary?.definitionsEn ?? []).filter((item) => (item.source as string) !== "macos-dictionary-full");',
    ],
    [
      '<p className="word-detail-empty">英文释义暂不可用。</p>\n        )}\n      </section>',
      '<p className="word-detail-empty">英文释义暂不可用。</p>\n        )}\n' +
        '        {dictionary && <VantiloDictionaryDisclosure dictionary={dictionary} language="en" />}\n' +
        '      </section>',
    ],
  ];
  for (const [original, replacement] of replacements) {
    if (source.split(original).length !== 2) {
      throw new Error('Reader word-detail dictionary seam changed; review Vantilo adapter');
    }
    source = source.replace(original, replacement);
  }
  return source;
}
