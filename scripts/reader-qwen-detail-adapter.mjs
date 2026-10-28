// Only Vantilo's isolated Qwen Reader preview consumes this adapter.
// Original Magazine Reader sources and all user storage remain untouched.
export function adaptQwenWordDetail(source) {
  function exact(text,from,to) {
    if(text.split(from).length !== 2) throw new Error('Reader Qwen detail seam changed: '+from.slice(0,85));
    return text.replace(from,to);
  }
  // Prevent an old Agent request from overwriting the per-occurrence Qwen
  // meaning as soon as the user clicks "More".
  source = exact(source,
    '    if (!lookup.contextMeaning || !hasEnglishWordContext(lookup.contextMeaning)) {',
    '    if (false && (!lookup.contextMeaning || !hasEnglishWordContext(lookup.contextMeaning))) {');

  const head='function WordDetailContent({';
  const tail='\nfunction vocabularyTextKey(';
  if(source.split(head).length!==2 || source.split(tail).length!==2)throw new Error('WordDetailContent boundaries changed');
  const start=source.indexOf(head), end=source.indexOf(tail,start);
  if(end<start)throw new Error('Word detail boundaries reversed');
  let detail=source.slice(start,end);

  detail=exact(detail,
    '  vocabularyMeaning,\n  familiarity,',
    '  vocabularyMeaning,\n  vocabularyMeaningSource,\n  onQwenMeaningResolved,\n  familiarity,');
  detail=exact(detail,
    '  vocabularyMeaning?: string;\n  familiarity: FamiliarityLevel | null;',
    '  vocabularyMeaning?: string;\n  vocabularyMeaningSource?: SavedSelection["translationSource"];\n  onQwenMeaningResolved?: (lookup: ActiveWordLookup, meaningZh: string, provider?: string, model?: string) => void;\n  familiarity: FamiliarityLevel | null;');

  // A dictionary-derived auto-translation is NOT the user's edited meaning.
  detail=exact(detail,
    '  const dictionary = lookup.dictionary;\n  const context = lookup.contextMeaning;',
    '  const dictionary = lookup.dictionary;\n  const context = lookup.contextMeaning;\n  const personalMeaning = vocabularyMeaningSource === "user" && Boolean(vocabularyMeaning?.trim());');

  const userSection='      <section className="word-detail-section word-detail-user-section">';
  detail=exact(detail,userSection,`      <section className="word-detail-section vantilo-detail-context">
        <div className="word-detail-section-title">
          <span>当前语境释义</span>
          {familiarity !== null && !editingVocabulary && !personalMeaning &&
            <button type="button" onClick={() => setEditingVocabulary(true)}>添加个人释义</button>}
          {context && !editingContext && <button type="button" onClick={() => setEditingContext(true)}>修改语境释义</button>}
        </div>
        <VantiloLocalGloss key={lookup.key} word={lookup.text}
          sentence={sentenceForOccurrence(lookup.paragraph,lookup.startOffset,lookup.text.length)}
          cachedMeaning={context?.meaningSource === "user" ? context.meaningZh : undefined}
          preserveCached={context?.meaningSource === "user"}
          cachedProvider={context?.provider} cachedModel={context?.model}
          onResolved={(meaningZh,provider,model) => onQwenMeaningResolved?.(lookup,meaningZh,provider,model)} />
        {editingContext && context && <div className="word-detail-edit-row">
          <input aria-label={'编辑“' + lookup.text + '”详情当前语境释义'} value={contextDraft} autoFocus
            onChange={event => setContextDraft(event.target.value)}
            onKeyDown={event => {
              if(event.key === "Enter")saveContextMeaning();
              if(event.key === "Escape")setEditingContext(false);
            }} />
          <div><button disabled={!contextDraft.trim()} onClick={saveContextMeaning}>保存</button>
            <button onClick={()=>setEditingContext(false)}>取消</button></div>
        </div>}
      </section>

      {(personalMeaning || editingVocabulary) && <section className="word-detail-section word-detail-user-section">`);
  const userEnd='      </section>\n\n      <section className="word-detail-section">\n        <div className="word-detail-section-title"><span>中文词典释义</span>';
  detail=exact(detail,userEnd,
    '      </section>}\n\n      {Boolean(dictionary?.definitionsZh.length) && <section className="word-detail-section vantilo-detail-dictionary">\n        <div className="word-detail-section-title"><span>中文词典释义</span>');

  const dictionaryEnd='      </section>\n\n      <section className="word-detail-section word-detail-english-section">';
  detail=exact(detail,dictionaryEnd,
    '      </section>}\n\n      {(englishDefinitions.length > 0 || Boolean(aiEnglishDefinition)) && <section className="word-detail-section word-detail-english-section">');

  // Flatten both dictionary disclosures only in Qwen detail. A native full
  // entry supersedes the short line, so it is read once and in one flow.
  detail=exact(detail,
    '{dictionary.definitionsZh.filter((item) => (item.source as string) !== "macos-dictionary-full").map((item, index) =>',
    '{!dictionary.definitionsZh.some((item) => (item.source as string) === "macos-dictionary-full") && dictionary.definitionsZh.filter((item) => (item.source as string) !== "macos-dictionary-full").map((item, index) =>');
  detail=exact(detail,
    '<VantiloDictionaryDisclosure dictionary={dictionary} language="zh" />',
    '{dictionary.definitionsZh.find(item => (item.source as string) === "macos-dictionary-full") && <div className="vantilo-dictionary-full-body">\n' +
    '  <VantiloDictionaryExpanded definition={dictionary.definitionsZh.find(item => (item.source as string) === "macos-dictionary-full")!.definition} phonetic={dictionary.phonetic} word={dictionary.word} />\n' +
    '</div>}');

  const englishEnd='      </section>\n\n      <section className="word-detail-section word-detail-context-section">';
  detail=exact(detail,englishEnd,
    '      </section>}\n\n      {false && <section className="word-detail-section word-detail-context-section">');
  const oldContextEnd='      </section>\n\n      <section className="word-detail-section">\n        <div className="word-detail-section-title"><span>Examples</span>';
  detail=exact(detail,oldContextEnd,
    '      </section>}\n\n      {examples.length > 0 && <section className="word-detail-section">\n        <div className="word-detail-section-title"><span>Examples</span>');
  const examplesEnd='      </section>\n\n      <section className="word-detail-section word-detail-familiarity">';
  detail=exact(detail,examplesEnd,'      </section>}\n\n      <section className="word-detail-section word-detail-familiarity">');

  // Keep actual provenance honest; don't call a Swift MLX gloss an Agent result.
  detail=detail.replaceAll('释义与语境：统一 Agent · AI 生成，请结合原文核对',
    '当前语境：本地 Qwen · 词典为补充，请结合原文核对');
  source=source.slice(0,start)+detail+source.slice(end);

  // Reader-only: detail callback must write the same occurrence record as popup.
  source=exact(source,
    '              vocabularyMeaning={wordDetailVocabularyMeaning}\n              familiarity={wordDetailFamiliarity}',
    '              vocabularyMeaning={wordDetailVocabularyMeaning}\n              vocabularyMeaningSource={wordDetailVocabularyMeaningSource}\n              onQwenMeaningResolved={onWordDetailQwenMeaningResolved}\n              familiarity={wordDetailFamiliarity}');
  source=exact(source,
    '  wordDetailVocabularyMeaning,\n  wordDetailFamiliarity,',
    '  wordDetailVocabularyMeaning,\n  wordDetailVocabularyMeaningSource,\n  onWordDetailQwenMeaningResolved,\n  wordDetailFamiliarity,');
  source=exact(source,
    '  wordDetailVocabularyMeaning?: string;\n  wordDetailFamiliarity: FamiliarityLevel | null;',
    '  wordDetailVocabularyMeaning?: string;\n  wordDetailVocabularyMeaningSource?: SavedSelection["translationSource"];\n  onWordDetailQwenMeaningResolved?: (lookup: ActiveWordLookup, meaningZh: string) => void;\n  wordDetailFamiliarity: FamiliarityLevel | null;');
  source=exact(source,
    '            wordDetailVocabularyMeaning={wordDetailVocabulary?.translationZh}\n            wordDetailFamiliarity={wordDetailFamiliarity}',
    '            wordDetailVocabularyMeaning={wordDetailVocabulary?.translationZh}\n            wordDetailVocabularyMeaningSource={wordDetailVocabulary?.translationSource}\n            onWordDetailQwenMeaningResolved={saveVantiloQwenWordContext}\n            wordDetailFamiliarity={wordDetailFamiliarity}');

  // VocabularyPanel (article right sidebar) also hosts WordDetailContent.
  source=exact(source,
    '            vocabularyMeaning={detailVocabularyMeaning}\n            familiarity={detailFamiliarity}',
    '            vocabularyMeaning={detailVocabularyMeaning}\n            vocabularyMeaningSource={detailVocabularyMeaningSource}\n            onQwenMeaningResolved={onDetailQwenMeaningResolved}\n            familiarity={detailFamiliarity}');
  source=exact(source,
    '  detailVocabularyMeaning,\n  detailFamiliarity,',
    '  detailVocabularyMeaning,\n  detailVocabularyMeaningSource,\n  onDetailQwenMeaningResolved,\n  detailFamiliarity,');
  source=exact(source,
    '  detailVocabularyMeaning?: string;\n  detailFamiliarity: FamiliarityLevel | null;',
    '  detailVocabularyMeaning?: string;\n  detailVocabularyMeaningSource?: SavedSelection["translationSource"];\n  onDetailQwenMeaningResolved?: (lookup: ActiveWordLookup, meaningZh: string) => void;\n  detailFamiliarity: FamiliarityLevel | null;');
  source=exact(source,
    '          detailVocabularyMeaning={wordDetailVocabulary?.translationZh}\n          detailFamiliarity={wordDetailFamiliarity}',
    '          detailVocabularyMeaning={wordDetailVocabulary?.translationZh}\n          detailVocabularyMeaningSource={wordDetailVocabulary?.translationSource}\n          onDetailQwenMeaningResolved={saveVantiloQwenWordContext}\n          detailFamiliarity={wordDetailFamiliarity}');

  // The separate global vocabulary view has its own persistence and receives
  // only the local context record. It can display but never claims an edit.
  source=exact(source,
    '            vocabularyMeaning={detailItem.translationZh}\n            familiarity={detailItem.familiarity}',
    '            vocabularyMeaning={detailItem.translationZh}\n            vocabularyMeaningSource={detailItem.translationSource}\n            familiarity={detailItem.familiarity}');
  return source;
}
