import type { TranslationProvider } from "./translation-service.js";
import { EasyCLIProxyTranslationProvider } from "./translation-service.js";
import type { ReaderGuideProvider } from "./reader-guide-service.js";
import { EasyCLIProxyReaderGuideProvider } from "./reader-guide-service.js";
import type { SectionTranslationProvider } from "./section-translation-service.js";
import { EasyCLIProxySectionTranslationProvider } from "./section-translation-service.js";
import type { SelectionAssistProvider } from "./selection-assist-service.js";
import { EasyCLIProxySelectionAssistProvider } from "./selection-assist-service.js";
import type { ReadingAssistantProvider } from "./reading-assistant-service.js";
import { EasyCLIProxyReadingAssistantProvider } from "./reading-assistant-service.js";
import type { WordContextProvider } from "./word-context-service.js";
import { EasyCLIProxyWordContextProvider } from "./word-context-service.js";
import type { AiProviderSettingsService, ActiveAiProviderProfile } from "./ai-provider-settings-service.js";

function requireActiveProfile(settings: AiProviderSettingsService): ActiveAiProviderProfile {
  const profile = settings.getActiveProfile();
  if (!profile) throw new Error("AI 服务尚未配置");
  return profile;
}

export function createActiveAiProviders(
  settings: AiProviderSettingsService,
  fetchImpl: typeof fetch = fetch,
): {
  translation: TranslationProvider;
  readerGuide: ReaderGuideProvider;
  sectionTranslation: SectionTranslationProvider;
  selectionAssist: SelectionAssistProvider;
  readingAssistant: ReadingAssistantProvider;
  wordContext: WordContextProvider;
} {
  return {
    translation: {
      async translate(request) {
        const profile = requireActiveProfile(settings);
        const result = await new EasyCLIProxyTranslationProvider({
          endpoint: profile.responsesUrl,
          model: profile.model,
          apiKey: profile.apiKey,
          fetchImpl,
        }).translate(request);
        return { ...result, profileId: profile.id };
      },
    },
    readerGuide: {
      async generate(articles) {
        const profile = requireActiveProfile(settings);
        return new EasyCLIProxyReaderGuideProvider({
          endpoint: profile.responsesUrl,
          model: profile.model,
          apiKey: profile.apiKey,
          fetchImpl,
        }).generate(articles);
      },
    },
    sectionTranslation: {
      async translate(publicationId, sections) {
        const profile = requireActiveProfile(settings);
        return new EasyCLIProxySectionTranslationProvider({
          endpoint: profile.responsesUrl,
          model: profile.model,
          apiKey: profile.apiKey,
          fetchImpl,
        }).translate(publicationId, sections);
      },
    },
    selectionAssist: {
      async assist(request) {
        const profile = requireActiveProfile(settings);
        return new EasyCLIProxySelectionAssistProvider({
          endpoint: profile.responsesUrl,
          model: profile.model,
          apiKey: profile.apiKey,
          fetchImpl,
        }).assist(request);
      },
    },
    readingAssistant: {
      async assist(request) {
        const profile = requireActiveProfile(settings);
        return new EasyCLIProxyReadingAssistantProvider({
          endpoint: profile.responsesUrl,
          apiKey: profile.apiKey,
          fetchImpl,
        }).assist(request);
      },
    },
    wordContext: {
      async explain(request) {
        const profile = requireActiveProfile(settings);
        return new EasyCLIProxyWordContextProvider({
          endpoint: profile.responsesUrl,
          model: profile.model,
          apiKey: profile.apiKey,
          fetchImpl,
        }).explain(request);
      },
    },
  };
}
