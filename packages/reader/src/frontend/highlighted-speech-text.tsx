import type { AudiobookSmartSkip } from "../shared/audiobook-bridge";
import { loadAudiobookSmartSkip } from "./audiobook-smart-skip";
import { splitLiveSpeechHighlight, splitParagraphSentences } from "./audiobook-sync-highlight";
import { getReaderStorage } from "./reader-storage";

export interface LiveSpeechCursor {
  chunkIndex?: number;
  chunkText?: string;
  chunkSeconds?: number;
  chunkDuration?: number;
  smartSkip?: AudiobookSmartSkip;
}

function renderInteractiveSlice(
  slice: string,
  baseOffset: number,
  onSelectSentence?: (startOffset: number, sentenceText: string) => void,
) {
  if (!slice) return null;
  const sentences = splitParagraphSentences(slice, baseOffset);
  return sentences.map((sentence) => (
    <span
      key={sentence.start}
      className="audiobook-hoverable-sentence"
      data-sentence-start={sentence.start}
      onClick={() => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.toString().trim()) return;
        onSelectSentence?.(sentence.start, sentence.text);
      }}
    >
      {sentence.text}
    </span>
  ));
}

export function HighlightedSpeechText({
  text,
  active,
  cursor,
  interactiveSentences = false,
  onSelectSentence,
}: {
  text: string;
  active: boolean;
  cursor?: LiveSpeechCursor;
  interactiveSentences?: boolean;
  onSelectSentence?: (startOffset: number, sentenceText: string) => void;
}) {
  if (!text) return null;
  if (!active) {
    if (!interactiveSentences) return <>{text}</>;
    return <>{renderInteractiveSlice(text, 0, onSelectSentence)}</>;
  }
  const span = splitLiveSpeechHighlight(
    text,
    cursor?.chunkIndex,
    cursor?.chunkText,
    cursor?.chunkSeconds,
    cursor?.chunkDuration,
    cursor?.smartSkip ?? loadAudiobookSmartSkip(getReaderStorage()),
  );
  if (!span) {
    if (!interactiveSentences) return <>{text}</>;
    return <>{renderInteractiveSlice(text, 0, onSelectSentence)}</>;
  }
  const activeStart = span.beforeSentence.length;
  const activeLength =
    span.sentenceBeforeChar.length + span.activeChar.length + span.sentenceAfterChar.length;
  const afterStart = activeStart + activeLength;
  return (
    <>
      {interactiveSentences
        ? renderInteractiveSlice(span.beforeSentence, 0, onSelectSentence)
        : span.beforeSentence}
      <mark className="audiobook-active-sentence">
        {span.sentenceBeforeChar}
        <span className="audiobook-active-char">{span.activeChar}</span>
        {span.sentenceAfterChar}
      </mark>
      {interactiveSentences
        ? renderInteractiveSlice(span.afterSentence, afterStart, onSelectSentence)
        : span.afterSentence}
    </>
  );
}
