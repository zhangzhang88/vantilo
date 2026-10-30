// Vantilo-only presentation of plain-text macOS Dictionary Services entries.
// The protected source Reader stays unchanged. Never interpret source text as HTML.
import { dictionaryPreviewMeanings } from '../packages/reader/src/frontend/dictionary-preview';

type NativeDictionaryExample = { english: string; chinese: string };
type NativeDictionarySense = { number: string; description: string; examples: NativeDictionaryExample[] };
type NativeDictionarySection = { letter: string; heading: string; senses: NativeDictionarySense[] };
type NativeDictionaryLayout = { lemma: string; sections: NativeDictionarySection[]; fallback: string };

export function parseVantiloNativeDictionary(fullText: string): NativeDictionaryLayout {
  const input = fullText.trim();
  const lemmaMatch = input.match(/^([A-Za-z][A-Za-z '-]{0,90})（原形）\s*·\s*/u);
  const lemma = lemmaMatch?.[1]?.trim() ?? '';
  const body = lemmaMatch ? input.slice(lemmaMatch[0].length) : input;
  const sections: NativeDictionarySection[] = [];
  let section: NativeDictionarySection | null = null;
  let sense: NativeDictionarySense | null = null;
  let preamble = '';

  const addSense = (number = '') => {
    if (!section) {
      section = { letter: '', heading: '', senses: [] };
      sections.push(section);
    }
    sense = { number, description: '', examples: [] };
    section.senses.push(sense);
  };

  const consume = (kind: 'preamble' | 'group' | 'sense' | 'example', marker: string, value: string) => {
    const text = value.trim();
    if (kind === 'preamble') {
      preamble = text;
      return;
    }
    if (kind === 'group') {
      const header = text.match(/^(.*?(?:transitive verb|intransitive verb|reflexive verb|phrasal verb|auxiliary verb|modal verb|adjective|adverb|noun|verb|pronoun|preposition|interjection|exclamation|conjunction|determiner|article|numeral|number|abbreviation|prefix|suffix))(?:\s+(.+))?$/iu);
      section = { letter: marker, heading: header?.[1]?.trim() || '', senses: [] };
      sections.push(section);
      sense = null;
      const remainder = header?.[2]?.trim() || (header ? '' : text);
      if (remainder) {
        addSense();
        sense!.description = remainder;
      }
      return;
    }
    if (kind === 'sense') {
      addSense(marker);
      sense!.description = text;
      return;
    }
    if (kind === 'example') {
      if (!sense) addSense();
      if (!text) return;
      // Semicolon is sometimes the divider. Otherwise the first Han glyph
      // begins the Chinese translation; preserve any trailing pinyin.
      const explicit = text.match(/^(.+?);\s*(?=[\p{Script=Han}])/u);
      const firstChinese = text.search(/[\p{Script=Han}]/u);
      const split = explicit ? explicit[1].length + 1 : firstChinese;
      sense!.examples.push({
        english: split < 0 ? text : text.slice(0, split).replace(/;\s*$/u, '').trim(),
        chinese: split < 0 ? '' : text.slice(split).replace(/^;\s*/u, '').trim(),
      });
    }
  };

  const marker = /▸|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|(?:^|\s)([A-F])\.\s+(?=(?:to\s+|(?:in)?transitive\b|reflexive\b|noun\b|verb\b|adjective\b|adverb\b|phrasal\b|pronoun\b|preposition\b|interjection\b|exclamation\b|conjunction\b|determiner\b|article\b|auxiliary\b|modal\b|numeral\b|number\b|abbreviation\b|prefix\b|suffix\b))/gu;
  let active: { kind: 'preamble' | 'group' | 'sense' | 'example'; label: string } = { kind: 'preamble', label: '' };
  let offset = 0;
  for (const match of body.matchAll(marker)) {
    const index = match.index ?? 0;
    consume(active.kind, active.label, body.slice(offset, index));
    if (match[0] === '▸') active = { kind: 'example', label: '' };
    else if (match[1]) active = { kind: 'group', label: match[1] + '.' };
    else active = { kind: 'sense', label: match[0] };
    offset = index + match[0].length;
  }
  consume(active.kind, active.label, body.slice(offset));

  if (preamble) {
    // The first dictionary variant may not use A./B. or circled numbering.
    // Do not silently drop that content.
    if (!sections.length) addSense();
    const first = sections[0]!;
    if (!first.senses.length) {
      first.senses.push({ number: '', description: preamble, examples: [] });
    } else {
      first.senses[0]!.description = (preamble + ' ' + first.senses[0]!.description).trim();
    }
  }

  return { lemma, sections, fallback: body };
}

function VantiloDictionaryRichText({ text }: { text: string }) {
  // Plain text only. Chinese translation, grammatical notes, and dictionary
  // usage brackets get their own visual hierarchy.
  const parts = text.split(/(‹[^›]*›|\([^)]*\)|[\p{Script=Han}]+|[\p{Script=Latin}\p{M}]+(?:['’][\p{Script=Latin}\p{M}]+)*)/gu).filter(Boolean);
  const pinyinTone = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňḿ]/iu;
  return <>
    {parts.map((part, i) => {
      const kind = part.startsWith('‹') ? 'usage' : part.startsWith('(') ? 'note' :
        /[\p{Script=Han}]/u.test(part) ? 'han' : pinyinTone.test(part) ? 'phonetic' : 'other';
      return <span className={'vantilo-dict-text-' + kind} lang={kind === 'han' ? 'zh-CN' : undefined} key={i}>{part}</span>;
    })}
  </>;
}

export function VantiloDictionaryExpanded({
  definition, phonetic, word,
}: { definition: string; phonetic: string | null; word: string }) {
  const layout = parseVantiloNativeDictionary(definition);
  return (
    <div className="vantilo-dict-article">
      <div className="vantilo-dict-lemma-line">
        <strong lang="en">{layout.lemma || word}</strong>{layout.lemma && <span>（原形）</span>}
        {phonetic && <span className="vantilo-dict-phonetic" lang="en">{phonetic}</span>}
      </div>
      {layout.sections.length ? layout.sections.map((group, groupIndex) => (
        <section className="vantilo-dict-section" key={groupIndex}>
          {(group.letter || group.heading) && <h4 className="vantilo-dict-section-title">
            {group.letter && <span>{group.letter} </span>}{group.heading}
          </h4>}
          {group.senses.map((item, senseIndex) => (
            <div className="vantilo-dict-sense" key={senseIndex}>
              {(item.number || item.description) && <p className="vantilo-dict-sense-text">
                {item.number && <span className="vantilo-dict-number">{item.number}</span>}
                <VantiloDictionaryRichText text={item.description}/>
              </p>}
              {item.examples.map((example, exampleIndex) => (
                <div className="vantilo-dict-example" key={exampleIndex}>
                  <div className="vantilo-dict-example-en" lang="en">
                    <span aria-hidden="true" className="vantilo-dict-bullet">▸</span>
                    {example.english}
                  </div>
                  {example.chinese && <div className="vantilo-dict-example-zh" lang="zh-CN">
                    <VantiloDictionaryRichText text={example.chinese}/>
                  </div>}
                </div>
              ))}
            </div>
          ))}
        </section>
      )) : <p className="vantilo-dict-fallback">{layout.fallback}</p>}
    </div>
  );
}

// Compact preview for the inline word card. The query text stays in App's
// heading; this renders the system-provided lemma/phonetics/gloss separately.
export function VantiloDictionaryQuickSummary({ dictionary }: { dictionary: VantiloDictionaryRecord }) {
  const hasChinese = dictionary.definitionsZh.length > 0;
  const language = hasChinese ? 'zh' : 'en';
  const meanings = dictionaryPreviewMeanings(dictionary.definitionsZh);
  return <>
    {dictionary.phonetic && <div className="vantilo-dictionary-phonetic" lang="en">{dictionary.phonetic}</div>}
    {meanings.length > 0 && <div className="vantilo-dictionary-quick" lang="zh-CN">{meanings.map((item, index) =>
      <div className="vantilo-dictionary-preview-sense" key={index}>
        {item.partOfSpeech && <span className="vantilo-dictionary-preview-pos">{item.partOfSpeech}</span>}
        <span>{item.meaning}</span>
      </div>,
    )}</div>}
    <VantiloDictionaryDisclosure dictionary={dictionary} language={language} />
  </>;
}

// Reuse the same native entry renderer in the inline word popup and in the
// vocabulary detail pane. Keep full text out of the ordinary meaning list.
type VantiloDictionaryRecord = {
  word: string;
  phonetic?: string | null;
  definitionsZh: Array<{ definition: string; source: string; partOfSpeech?: string | null }>;
  definitionsEn: Array<{ definition: string; source: string; partOfSpeech?: string | null }>;
};

export function VantiloDictionaryDisclosure({
  dictionary, language,
}: {
  dictionary: VantiloDictionaryRecord;
  language: 'zh' | 'en';
}) {
  const definitions = language === 'zh' ? dictionary.definitionsZh : dictionary.definitionsEn;
  const full = definitions.find(item => item.source === 'macos-dictionary-full');
  if (!full) return null;
  return (
    <details className="vantilo-dictionary-full vantilo-detail-dictionary-full">
      <summary><span className="vantilo-dictionary-open-label">查看完整词条与例句</span><span className="vantilo-dictionary-close-label">收起完整词条</span></summary>
      <div className="vantilo-dictionary-full-body">
        <VantiloDictionaryExpanded
          definition={full.definition}
          phonetic={dictionary.phonetic ?? null}
          word={dictionary.word}
        />
      </div>
    </details>
  );
}
