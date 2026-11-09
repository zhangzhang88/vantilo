import { generateOrderedPracticeWithTitle, workshopDefaultPrompt } from "./services/ordered-practice.js";
import { generateWorkshopVocabularyWithTitle, workshopVocabularyDefaultPrompt } from "./services/workshop-vocabulary.js";
import { requestWorkshopExercises } from "./services/practice-workshop-provider.js";
import { chineseSpeechText } from "./services/chinese-speech-text.js";
import { SpeechCppTts, type ChineseSpeechSource } from "./services/speech-cpp-tts.js";
import { HttpSpeechTts } from "./services/http-speech-tts.js";
import { TtsApiSettingsService, type TtsApiSettingsDraft } from "./services/tts-api-settings-service.js";
import { DEFAULT_QWEN_TTS_VOICE, isQwenTtsVoice, MY_VOICE_TTS_ID } from "../shared/qwen-tts-voices.js";
import { isTranslatableText } from "../shared/translation-text.js";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { MockAnalyzer } from "../analysis/mock-analyzer.js";
import { createPublicDictionaryProvider, type DictionaryProvider } from "./services/dictionary-service.js";
import { WordAudioCache, WordAudioError } from "./services/word-audio-cache.js";
import type {
  AiProviderProfileDraft,
  AiProviderSaveRequest,
  ArticleStatus,
  StatusUpdateBody,
  ReadingAssistantRequest,
  ReadingAssistantTurn,
  WordContextRequest,
} from "../shared/types.js";
import { JsonStorage } from "../storage/json-storage.js";
import { IssueService, defaultProjectPaths } from "./services/issue-service.js";
import { EpubImportService } from "./services/epub-import-service.js";
import { BookImportService } from "./services/book-import-service.js";
import { BookCategoryService } from "./services/book-category-service.js";
import { isBookCategoryId } from "../shared/book-category.js";
import { ORIGINAL_CONTENT_CSP } from "./services/book-original-content.js";
import { BookTocChineseService, EasyCLIProxyBookTocChineseProvider, type BookTocChineseProvider } from "./services/book-toc-chinese-service.js";
import { GuidePreparationService } from "./services/guide-preparation-service.js";
import type { ReaderGuideProvider } from "./services/reader-guide-service.js";
import type { SectionTranslationProvider } from "./services/section-translation-service.js";
import type { SelectionAssistProvider } from "./services/selection-assist-service.js";
import type { ReadingAssistantProvider } from "./services/reading-assistant-service.js";
import type { TranslationProvider } from "./services/translation-service.js";
import type { WordContextProvider } from "./services/word-context-service.js";
import { AiProviderSettingsService } from "./services/ai-provider-settings-service.js";
import { createActiveAiProviders } from "./services/active-ai-providers.js";
import { GitHubMagazineSyncService, type MagazineSyncSource } from "./services/github-magazine-sync-service.js";
import { ContentDiscoveryService } from "./services/content-discovery-service.js";
import { createCodexAuthTransport } from "./services/codex-auth-transport.js";
import { ScienceArticleService } from "./services/science-article-service.js";
import { ScienceArticleAutoCollector } from "./services/science-article-auto-collector.js";
import type { ContentDiscoverySnapshot } from "../shared/content-discovery.js";
import { readingDocumentIdentityFromLegacyFields } from "../shared/reading-document-identity.js";
import { lessonParagraphs } from "../shared/book-lesson.js";
import { CodexAuthService } from "./services/codex-auth-service.js";
import { CodexPrepService } from "./services/codex-prep-service.js";
import { parseAssistantScope } from "../shared/assistant-scope.js";
import { buildAssistantContext } from "./services/assistant-context.js";
import type { CodexPrepModelPreferences } from "../shared/codex-prep-models.js";

const allowedStatuses = new Set<ArticleStatus>(["save", "process", "skip", null]);

export interface BuildServerOptions {
  projectRoot: string;
  /** Parent-owned OS shared lock descriptor; inherited by Reader data-writing helpers. */
  vantiloReaderDataLockFd?: number;
  /** Vantilo userData root used only for lock identity and child process scope. */
  vantiloReaderUserDataRoot?: string;
  serveFrontend?: boolean;
  readerGuideProvider?: ReaderGuideProvider | null;
  bookTocChineseProvider?: BookTocChineseProvider | null;
  sectionTranslationProvider?: SectionTranslationProvider | null;
  selectionAssistProvider?: SelectionAssistProvider | null;
  readingAssistantProvider?: ReadingAssistantProvider | null;
  translationProvider?: TranslationProvider | null;
  getTranslationCacheIdentity?: () => { profileId: string | null; model: string | null };
  wordContextProvider?: WordContextProvider | null;
  dictionaryProvider?: DictionaryProvider | null;
  /** Isolated test transport for Youdao word audio. Never runs provider traffic in offline tests. */
  wordAudioFetchImpl?: typeof fetch;
  aiProviderEnv?: NodeJS.ProcessEnv;
  aiFetchImpl?: typeof fetch;
  /** Direct HTTP transport for user-selected workshop APIs; never use the Codex Reader AI proxy. */
  workshopFetchImpl?: typeof fetch;
  speechTtsSource?: ChineseSpeechSource;
  /** Isolated test-only settings root. Production derives this from Electron userData. */
  ttsApiSettingsRoot?: string;
  guidePreparationRetryDelaysMs?: number[];
  githubMagazineSync?: {
    fetchImpl?: typeof fetch;
    token?: string;
    sources?: MagazineSyncSource[];
  };
  contentDiscoveryFetchImpl?: typeof fetch;
  scienceArticleFetchImpl?: typeof fetch;
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  let readerBackupFrozen = false;
  let drainReaderBackground: () => Promise<void> = async () => {};
  let createReaderLibraryIndex: () => Promise<{ version: 1; books: unknown[]; issues: unknown[] }> = async () => ({ version: 1, books: [], issues: [] });
  const activeReaderRequests = new Set<object>();
  const requestLeases = new WeakMap<object, object>();
  let resolveReaderRequestsDrained: (() => void) | null = null;
  const releaseReaderRequest = (request: object) => {
    const lease = requestLeases.get(request);
    if (!lease) return;
    requestLeases.delete(request); activeReaderRequests.delete(lease);
    if (!activeReaderRequests.size) { resolveReaderRequestsDrained?.(); resolveReaderRequestsDrained = null; }
  };
  app.addHook("onRequest", async (request, reply) => {
    const isHealth = request.method === "GET" && request.url.split("?")[0] === "/api/health";
    if (readerBackupFrozen && !isHealth) return reply.code(423).send({ error: "Reader 正在备份，暂时不接受新的读写请求" });
    if (isHealth) return;
    const lease = {}; activeReaderRequests.add(lease); requestLeases.set(request, lease);
  });
  app.addHook("onResponse", async request => { releaseReaderRequest(request); });
  app.addHook("onError", async (request, _reply, _error) => { releaseReaderRequest(request); });
  const readerBackupControl = {
    async freeze(timeoutMs = 30000) {
      if (readerBackupFrozen) throw new Error("Reader 备份维护状态已启用");
      readerBackupFrozen = true;
      try {
        if (activeReaderRequests.size) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { resolveReaderRequestsDrained = null; reject(new Error("Reader 服务仍有未完成请求；已安全取消备份")); }, timeoutMs);
            resolveReaderRequestsDrained = () => { clearTimeout(timer); resolve(); };
            if (!activeReaderRequests.size) resolveReaderRequestsDrained();
          });
        }
        let drainTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            drainReaderBackground(),
            new Promise<never>((_resolve, reject) => { drainTimer = setTimeout(() => reject(new Error("Reader 后台写入未能在时限内排空；已安全取消备份")), 120000); }),
          ]);
        } finally { if (drainTimer) clearTimeout(drainTimer); }
        return { frozen: true, activeRequests: 0 };
      } catch (error) {
        readerBackupFrozen = false;
        resolveReaderRequestsDrained?.(); resolveReaderRequestsDrained = null;
        throw error;
      }
    },
    resume() { readerBackupFrozen = false; return { frozen: false }; },
    async snapshotIndex() {
      if (!readerBackupFrozen) throw new Error("Reader 书库索引只能在写入冻结后读取");
      return createReaderLibraryIndex();
    },
    getState() { return { frozen: readerBackupFrozen, activeRequests: activeReaderRequests.size }; },
  };
  app.decorate("vantiloReaderBackupControl", readerBackupControl);
  app.addContentTypeParser(["application/epub+zip", "application/octet-stream"], { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  const paths = defaultProjectPaths(options.projectRoot);
  const wordAudio = new WordAudioCache(path.join(options.projectRoot, "cache", "word-audio-v1"), options.wordAudioFetchImpl ?? fetch);
  app.addHook("onClose", async () => { await wordAudio.waitForIdle(); });
  const ttsSettingsRoot = options.vantiloReaderUserDataRoot ?? options.ttsApiSettingsRoot
    ?? path.join(os.homedir(), "Library", "Application Support", "Vantilo", "Reader");
  const ttsApiSettings = await TtsApiSettingsService.create(ttsSettingsRoot);
  const myVoiceSettings = await TtsApiSettingsService.create(ttsSettingsRoot, "my_voice");
  const speechWorker = options.speechTtsSource ?? new SpeechCppTts();
  const httpSpeech = new HttpSpeechTts(() => ttsApiSettings.activeProfile());
  const myVoiceSpeech = new HttpSpeechTts(() => myVoiceSettings.activeProfile());
  const activeSpeech = (): ChineseSpeechSource => options.speechTtsSource ?? (ttsApiSettings.activeProfile() ? httpSpeech : speechWorker);
  if (options.vantiloReaderUserDataRoot && !options.speechTtsSource && !ttsApiSettings.activeProfile()) {
    // The old embedded worker stays available until a TTS API is explicitly configured.
    void speechWorker.warm().catch(() => {});
  }
  app.addHook("onClose", async () => { speechWorker.close(); httpSpeech.close(); myVoiceSpeech.close(); });
  const codexAuth = new CodexAuthService(paths.dataDir, options.aiFetchImpl);
  await codexAuth.load();
  const codexPrep = new CodexPrepService(options.projectRoot, codexAuth);
  await codexPrep.load();
  app.addHook("onClose", async () => { codexPrep.close(); await codexAuth.close(); });
  // OAuth and local-file preparation are NEVER exposed on a remote server.
  app.addHook("onRequest", async (request, reply) => {
    const protectedRoute = request.url.startsWith("/api/prep/") || request.url.startsWith("/api/practice-workshop/") || request.url.startsWith("/api/tts-settings") || request.url.startsWith("/api/learning-audio/") || /^\/api\/(content-discovery|science-articles|source-sync)(?:\/|\?|$)/.test(request.url) || /^\/api\/books\/[^/]+\/(prep|lessons)(?:\/|\?|$)/.test(request.url);
    if (!protectedRoute) return;
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip)) {
      return reply.code(403).send({ error: "此接口只能在本机使用" });
    }
    const origin = request.headers.origin;
    if (origin) {
      try {
        const url = new URL(origin);
        if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return reply.code(403).send({ error: "Invalid local origin" });
      } catch { return reply.code(403).send({ error: "Invalid local origin" }); }
    }
  });
  const aiSettingsService = await AiProviderSettingsService.create(options.projectRoot, {
    env: options.aiProviderEnv,
    fetchImpl: options.aiFetchImpl,
  });
  const activeAiProviders = createActiveAiProviders(aiSettingsService, options.aiFetchImpl);
  const translationManaged = options.translationProvider === undefined;
  const readerGuideManaged = options.readerGuideProvider === undefined;
  const sectionTranslationManaged = options.sectionTranslationProvider === undefined;
  const selectionAssistManaged = options.selectionAssistProvider === undefined;
  const readingAssistantManaged = options.readingAssistantProvider === undefined;
  const wordContextManaged = options.wordContextProvider === undefined;
  const translationProvider: TranslationProvider | null = translationManaged ? activeAiProviders.translation : options.translationProvider ?? null;
  const readerGuideProvider: ReaderGuideProvider | null = readerGuideManaged ? activeAiProviders.readerGuide : options.readerGuideProvider ?? null;
  const sectionTranslationProvider: SectionTranslationProvider | null = sectionTranslationManaged ? activeAiProviders.sectionTranslation : options.sectionTranslationProvider ?? null;
  const selectionAssistProvider: SelectionAssistProvider | null = selectionAssistManaged ? activeAiProviders.selectionAssist : options.selectionAssistProvider ?? null;
  const readingAssistantProvider: ReadingAssistantProvider | null = readingAssistantManaged ? activeAiProviders.readingAssistant : options.readingAssistantProvider ?? null;
  const wordContextProvider: WordContextProvider | null = wordContextManaged ? activeAiProviders.wordContext : options.wordContextProvider ?? null;
  const dictionaryProvider = options.dictionaryProvider === undefined
    ? createPublicDictionaryProvider()
    : options.dictionaryProvider;
  const translationAvailable = () => translationManaged ? aiSettingsService.hasConfiguredActiveProfile() : Boolean(translationProvider);
  const readerGuideAvailable = () => readerGuideManaged ? aiSettingsService.hasConfiguredActiveProfile() : Boolean(readerGuideProvider);
  const sectionTranslationAvailable = () => sectionTranslationManaged ? aiSettingsService.hasConfiguredActiveProfile() : Boolean(sectionTranslationProvider);
  const selectionAssistAvailable = () => selectionAssistManaged ? aiSettingsService.hasConfiguredActiveProfile() : Boolean(selectionAssistProvider);
  const readingAssistantAvailable = () => readingAssistantManaged ? aiSettingsService.hasConfiguredActiveProfile() : Boolean(readingAssistantProvider);
  const wordContextAvailable = () => wordContextManaged ? aiSettingsService.hasConfiguredActiveProfile() : Boolean(wordContextProvider);
  const storage = new JsonStorage(paths.dataDir);
  const service = new IssueService(paths.issuesDir, storage, new MockAnalyzer(), sectionTranslationProvider);
  const epubImportService = new EpubImportService(paths.issuesDir);
  const bookImportService = new BookImportService(paths.booksDir);
  const bookCategories = new BookCategoryService(path.join(paths.dataDir, "book-categories.json"));
  const bookTocChineseService = new BookTocChineseService(
    paths.dataDir,
    () => aiSettingsService.getActiveProfile(),
    options.bookTocChineseProvider === undefined
      ? new EasyCLIProxyBookTocChineseProvider(options.aiFetchImpl)
      : options.bookTocChineseProvider,
    (bookId) => bookImportService.canPrepare(bookId),
  );
  const githubMagazineSyncService = new GitHubMagazineSyncService({
    issuesDir: paths.issuesDir,
    incomingDir: path.join(paths.dataDir, "source-sync", "incoming"),
    fetchImpl: options.githubMagazineSync?.fetchImpl,
    token: options.githubMagazineSync?.token ?? process.env.MAGAZINE_SYNC_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN,
    sources: options.githubMagazineSync?.sources,
    log: (message) => console.log(`[magazine-sync] ${message}`),
  });
  // The dev/start scripts load this optional value from the ignored local runtime config.
  const sourceProxyUrl = process.env.MAGAZINE_READER_SOURCE_PROXY?.trim();
  const sourceProxyEnv = sourceProxyUrl
    ? { ...process.env, HTTP_PROXY: sourceProxyUrl, HTTPS_PROXY: sourceProxyUrl }
    : process.env;
  const sourceHttpTransport = !options.contentDiscoveryFetchImpl || !options.scienceArticleFetchImpl
    ? createCodexAuthTransport({ env: sourceProxyEnv })
    : null;
  const contentDiscoveryService = new ContentDiscoveryService(
    path.join(paths.dataDir, "content-discovery.json"),
    options.contentDiscoveryFetchImpl ?? sourceHttpTransport!.fetch,
  );
  const scienceArticleService = new ScienceArticleService(
    path.join(paths.dataDir, "science-articles.json"),
    options.scienceArticleFetchImpl ?? sourceHttpTransport!.fetch,
  );
  if (sourceHttpTransport) app.addHook("onClose", async () => { await sourceHttpTransport.close(); });
  const scienceArticleAutoCollector = new ScienceArticleAutoCollector(
    path.join(paths.dataDir, "science-article-auto-import.json"), scienceArticleService,
    (sourceUrl, error) => app.log.warn({ sourceUrl, error }, "Science article auto-collection failed"),
  );
  let scienceContentRefreshInFlight: Promise<ContentDiscoverySnapshot> | null = null;
  const refreshScienceContent = (force = false) => {
    if (scienceContentRefreshInFlight) return scienceContentRefreshInFlight;
    const promise = contentDiscoveryService.refresh({ force }).then(async (snapshot) => {
      const result = await scienceArticleAutoCollector.collect(snapshot);
      if (result.importedCount || result.rejectedCount || result.failedCount) {
        app.log.info(result, "Science article auto-collection finished");
      }
      return snapshot;
    }).finally(() => { scienceContentRefreshInFlight = null; });
    scienceContentRefreshInFlight = promise;
    return promise;
  };
  let githubMagazineSyncInFlight: ReturnType<GitHubMagazineSyncService["sync"]> | null = null;
  const runGithubMagazineSync = () => {
    if (githubMagazineSyncInFlight) return githubMagazineSyncInFlight;
    githubMagazineSyncInFlight = githubMagazineSyncService.sync()
      .finally(() => { githubMagazineSyncInFlight = null; });
    return githubMagazineSyncInFlight;
  };
  const guidePreparationService = new GuidePreparationService(
    service,
    storage,
    readerGuideProvider,
    sectionTranslationProvider,
    { retryDelaysMs: options.guidePreparationRetryDelaysMs },
  );
  const backgroundReaderTasks = new Set<Promise<unknown>>();
  const trackReaderBackground = (task: () => Promise<unknown>) => {
    const running = Promise.resolve().then(task);
    backgroundReaderTasks.add(running);
    void running.catch(() => undefined).finally(() => backgroundReaderTasks.delete(running));
    return running;
  };

  app.get("/api/health", async () => ({
    ok: true,
    reader: "epub",
    translation: translationAvailable(),
    readerGuides: readerGuideAvailable(),
    sectionTranslations: sectionTranslationAvailable(),
    selectionAssist: selectionAssistAvailable(),
    readingAssistant: readingAssistantAvailable(),
    wordContext: wordContextAvailable(),
    dictionary: Boolean(dictionaryProvider),
  }));

  app.get("/api/ai-settings", async () => aiSettingsService.getPublicSettings());
  app.get("/api/tts-settings", async () => ttsApiSettings.publicSettings());
  app.get("/api/tts-settings/my-voice", async () => myVoiceSettings.publicSettings());
  app.post<{ Body: TtsApiSettingsDraft }>("/api/tts-settings/my-voice/test", async (request, reply) => {
    try {
      const profile = myVoiceSettings.resolveDraft(request.body);
      const tester = new HttpSpeechTts(() => profile);
      try { await tester.warm(); } finally { tester.close(); }
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "我的声音 API 连接失败" });
    }
  });
  app.put<{ Body: TtsApiSettingsDraft }>("/api/tts-settings/my-voice", async (request, reply) => {
    try { return await myVoiceSettings.save(request.body); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "我的声音 API 配置保存失败" }); }
  });
  app.post<{ Body: TtsApiSettingsDraft }>("/api/tts-settings/test", async (request, reply) => {
    try {
      const profile = ttsApiSettings.resolveDraft(request.body);
      const tester = new HttpSpeechTts(() => profile);
      try { await tester.warm(); } finally { tester.close(); }
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "TTS API 连接失败" });
    }
  });
  app.put<{ Body: TtsApiSettingsDraft }>("/api/tts-settings", async (request, reply) => {
    try {
      const response = await ttsApiSettings.save(request.body);
      if (!options.speechTtsSource) speechWorker.close();
      return response;
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "保存 TTS API 配置失败" });
    }
  });
  app.get("/api/translation-cache-identity", async () => {
    const active = options.getTranslationCacheIdentity?.() ?? (() => { const profile = aiSettingsService.getActiveProfile(); return { profileId: profile?.id ?? null, model: profile?.model ?? null }; })();
    return active;
  });

  app.get("/api/practice-workshop/prompt", async () => ({ prompt: workshopDefaultPrompt() }));
  app.get("/api/practice-workshop/vocabulary-prompt", async () => ({ prompt: workshopVocabularyDefaultPrompt() }));
  app.post<{ Body: { stage?: unknown; article?: unknown; prompt?: unknown; provider?: unknown; profileId?: unknown; apiKey?: unknown; deepseekModel?: unknown } }>("/api/practice-workshop/generate", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body.article !== "string" || typeof body.prompt !== "string" || !["codex","profile","deepseek"].includes(String(body.provider))) return reply.code(400).send({ error: "请填写文章、提示词并选择 AI 服务" });
    if (body.stage !== undefined && body.stage !== "vocabulary" && body.stage !== "assembly") return reply.code(400).send({error:"练习阶段无效"});
    try {
      let generate: (prompt: string) => Promise<{ text: string }>;
      if (body.provider === "codex") generate = input => codexPrep.generateLearningMaterial(input);
      else if (body.provider === "profile") {
        const profile = aiSettingsService.getConfiguredProfile(typeof body.profileId === "string" ? body.profileId : "");
        if (!profile) return reply.code(400).send({ error: "所选自定义 API 未配置或不可用" });
        generate = input => requestWorkshopExercises({ provider: "profile", prompt: input, profile }, options.workshopFetchImpl ?? fetch);
      } else generate = input => requestWorkshopExercises({ provider: "deepseek", prompt: input, apiKey: typeof body.apiKey === "string" ? body.apiKey : "", deepseekModel: typeof body.deepseekModel === "string" ? body.deepseekModel : "deepseek-chat" }, options.workshopFetchImpl ?? fetch);
      if (body.stage === "vocabulary") {
        return generateWorkshopVocabularyWithTitle(body.article,generate,body.prompt);
      }
      return generateOrderedPracticeWithTitle(body.article, generate, { promptTemplate: body.prompt, requirePronunciation: true });
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : "练习生成失败" });
    }
  });

  app.get("/api/prep/auth", async () => codexAuth.status());
  app.post<{ Body: { text?: unknown; language?: unknown; voice?: unknown; seed?: unknown } }>("/api/prep/tts", async (request, reply) => {
    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    if (!text || text.length > 500) return reply.code(400).send({ error: "朗读内容不能为空，且每个音频片段不能超过 500 个字符。" });
    const language = request.body?.language;
    if (language !== undefined && language !== "zh-CN" && language !== "en-US") return reply.code(400).send({ error: "朗读语言无效。" });
    const requestedVoice = request.body?.voice;
    if (requestedVoice !== undefined && !isQwenTtsVoice(requestedVoice) && requestedVoice !== MY_VOICE_TTS_ID) return reply.code(400).send({ error: "朗读音色无效。" });
    const voice = requestedVoice === MY_VOICE_TTS_ID ? MY_VOICE_TTS_ID : isQwenTtsVoice(requestedVoice) ? requestedVoice : DEFAULT_QWEN_TTS_VOICE;
    const seed = request.body?.seed;
    if (seed !== undefined && (!Number.isSafeInteger(seed) || typeof seed !== "number" || seed < 0 || seed > 2_147_483_647)) {
      return reply.code(400).send({ error: "TTS 随机种子无效。" });
    }
    const chinese = language === "zh-CN" || (language === undefined && /[\u3400-\u9fff]/.test(text));
    if (voice === MY_VOICE_TTS_ID && !chinese) return reply.code(400).send({ error: "我的声音仅用于中文听书。" });
    if (voice === MY_VOICE_TTS_ID && text.length > 140) return reply.code(400).send({ error: "我的声音每个音频片段不能超过 140 个字符。" });
    if (voice === MY_VOICE_TTS_ID && !myVoiceSettings.activeProfile()) return reply.code(409).send({ error: "请先在本地 TTS 设置中配置并测试「我的声音」服务。" });
    const controller = new AbortController();
    reply.raw.once("close", () => controller.abort());
    const normalizedText = chinese ? chineseSpeechText(text) : text;
    if (voice === MY_VOICE_TTS_ID && normalizedText.length > 140) return reply.code(400).send({ error: "我的声音预处理后的片段不能超过 140 个字符。" });
    const stream = voice === MY_VOICE_TTS_ID
      ? myVoiceSpeech.synthesize(normalizedText, controller.signal, "zh", MY_VOICE_TTS_ID, seed as number | undefined)
      : activeSpeech().synthesize(normalizedText, controller.signal, chinese ? "zh" : "en", voice, seed as number | undefined);
    return reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .type("application/x-ndjson; charset=utf-8").send(stream);
  });
  app.get("/api/prep/model-preferences", async () => codexPrep.getModelPreferences());
  app.put<{ Body: CodexPrepModelPreferences }>("/api/prep/model-preferences", async (request, reply) => {
    try { return await codexPrep.saveModelPreferences(request.body); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Codex 模型设置无效" }); }
  });
  app.get("/api/prep/models", async (_request, reply) => {
    try {
      const models = await codexPrep.listModels();
      return { models, defaultModelId: models.find((model) => model.isDefault)?.model ?? null, catalogSource: "app-server", entitlementVerified: false };
    } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "无法获取 Codex 模型列表" }); }
  });
  app.post("/api/prep/auth/start", async (_request, reply) => {
    try { return { url: await codexAuth.start() }; }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "授权失败" }); }
  });
  app.post("/api/prep/auth/disconnect", async () => { codexPrep.close(); await codexAuth.disconnect(); return codexAuth.status(); });

  // Cache writes are optional, but Reader backup must not snapshot them mid-rename.
  drainReaderBackground = async () => {
    // These services own background writes whose HTTP request may already have
    // returned. Freeze only completes after each writer's actual task/write queue drains.
    do {
      if (backgroundReaderTasks.size) await Promise.allSettled([...backgroundReaderTasks]);
      await Promise.all([
        guidePreparationService.waitForIdle(), bookTocChineseService.waitForIdle(),
        wordAudio.waitForIdle(),
      ]);
    } while (backgroundReaderTasks.size);
    while (scienceContentRefreshInFlight || githubMagazineSyncInFlight) {
      await Promise.allSettled([scienceContentRefreshInFlight, githubMagazineSyncInFlight].filter(Boolean) as Promise<unknown>[]);
    }
  };
  createReaderLibraryIndex = async () => ({
    version: 1,
    books: await bookImportService.snapshotBackupIndex(),
    issues: await service.snapshotBackupIndex(),
  });
  app.get<{ Params: { bookId: string } }>("/api/books/:bookId/lessons", async (request, reply) => {
    const book = await bookImportService.getBook(request.params.bookId);
    if (!book) return reply.code(404).send({ error: "Book not found" });
    return codexPrep.list(book.id).filter((lesson) => lesson.sourceFingerprint === book.sourceFingerprint);
  });
  app.delete<{ Params: { bookId: string; lessonId: string } }>("/api/books/:bookId/lessons/:lessonId", async (request, reply) => {
    const book = await bookImportService.getBook(request.params.bookId);
    if (!book) return reply.code(404).send({ error: "Book not found" });
    try { await codexPrep.deleteLesson(book, request.params.lessonId); return { status: "deleted", lessonId: request.params.lessonId }; }
    catch (error) { return reply.code(404).send({ error: error instanceof Error ? error.message : "删除精选阅读失败" }); }
  });
  const assistantContext = (scope: unknown) => buildAssistantContext(parseAssistantScope(scope), bookImportService, service, codexPrep, bookCategories);
  app.get<{ Querystring: { scope?: string } }>("/api/prep/assistant/history", async (request, reply) => {
    try { const context = await assistantContext(request.query.scope); reply.header("X-Assistant-Source", context.fingerprint); return codexPrep.history(context.key, context.fingerprint); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "无法读取讨论范围" }); }
  });
  app.delete<{ Querystring: { scope?: string } }>("/api/prep/assistant/history", async (request, reply) => {
    try { const context = await assistantContext(request.query.scope); await codexPrep.clearHistory(context.key, context.fingerprint); return { cleared: true }; }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "未能清空讨论记录" }); }
  });
  app.post<{ Querystring: { scope?: string }; Body: { message?: string; currentParagraphIndex?: number } }>("/api/prep/assistant/chat", async (request, reply) => {
    if (typeof request.body?.message !== "string" || !request.body.message.trim() || request.body.message.length > 2000) return reply.code(400).send({ error: "请输入 1～2000 字的问题" });
    if (request.body.currentParagraphIndex !== undefined && (!Number.isInteger(request.body.currentParagraphIndex) || request.body.currentParagraphIndex < 0)) return reply.code(400).send({ error: "当前段落位置无效" });
    const controller = new AbortController();
    const closed = () => controller.abort();
    reply.raw.on("close", closed);
    request.raw.on("aborted", closed);
    const cleanup = () => { reply.raw.off("close", closed); request.raw.off("aborted", closed); };
    let context;
    try { context = await assistantContext(request.query.scope); }
    catch (error) { cleanup(); return reply.code(400).send({ error: error instanceof Error ? error.message : "讨论范围不可用" }); }
    if (controller.signal.aborted) { cleanup(); return; }
    reply.header("X-Assistant-Source", context.fingerprint);
    if (request.headers.accept?.includes("application/x-ndjson")) {
      reply.hijack();
      reply.raw.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "X-Assistant-Source": context.fingerprint });
      const send = (event: object) => { if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`${JSON.stringify(event)}\n`); };
      send({ type: "status", text: context.mode === "practice-writing" ? "正在准备英文文章创作…" : "正在准备当前页面的书刊内容…" });
      const heartbeat = setInterval(() => send({ type: "ping" }), 10000);
      try {
        const result = await codexPrep.discussContext(context, request.body.message, { currentParagraphIndex: request.body.currentParagraphIndex, signal: controller.signal, onDelta: text => send({ type: "delta", text }), onStatus: text => send({ type: "status", text }) });
        send({ type: "done", ...result });
      } catch (error) { send({ type: "error", error: error instanceof Error ? error.message : "本轮未完成，请重试；片段尚未保存。" }); }
      finally { clearInterval(heartbeat); cleanup(); reply.raw.end(); }
      return;
    }
    try { return await codexPrep.discussContext(context, request.body.message, { signal: controller.signal, currentParagraphIndex: request.body.currentParagraphIndex }); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : "讨论失败" }); }
    finally { cleanup(); }
  });

  app.get<{ Params: { bookId: string } }>("/api/books/:bookId/prep/history", async (request, reply) => {
    const book = await bookImportService.getBook(request.params.bookId);
    if (!book) return reply.code(404).send({ error: "Book not found" });
    return codexPrep.history(book.id, book.sourceFingerprint);
  });
  app.delete<{ Params: { bookId: string } }>("/api/books/:bookId/prep/history", async (request, reply) => {
    const book = await bookImportService.getBook(request.params.bookId);
    if (!book) return reply.code(404).send({ error: "Book not found" });
    try { await codexPrep.clearHistory(book.id, book.sourceFingerprint); return { cleared: true }; }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "未能清空讨论记录" }); }
  });
  app.post<{ Params: { bookId: string }; Body: { message?: string; chapterId?: string; draft?: boolean } }>("/api/books/:bookId/prep/chat", async (request, reply) => {
    const book = await bookImportService.getBook(request.params.bookId);
    if (!book) return reply.code(404).send({ error: "Book not found" });
    if (typeof request.body?.message !== "string" || (request.body.chapterId !== undefined && typeof request.body.chapterId !== "string") || (request.body.draft !== undefined && typeof request.body.draft !== "boolean")) {
      return reply.code(400).send({ error: "Invalid preparation request" });
    }
    if (request.headers.accept?.includes("application/x-ndjson") && request.body.draft !== true) {
      reply.hijack();
      reply.raw.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
      const controller = new AbortController();
      const send = (event: object) => { if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`${JSON.stringify(event)}\n`); };
      const closed = () => controller.abort();
      reply.raw.on("close", closed);
      send({ type: "status", text: "正在连接 Codex、准备书籍上下文…" });
      const heartbeat = setInterval(() => send({ type: "ping" }), 10_000);
      try {
        const result = await codexPrep.converse(book, request.body.message, request.body.chapterId, false, {
          signal: controller.signal, onDelta: (text) => send({ type: "delta", text }),
          onStatus: (text) => send({ type: "status", text }), onResearch: (research) => send({ type: "research", research }),
        });
        send({ type: "done", answer: result.answer, research: result.research });
      } catch { send({ type: "error", error: "本轮讨论未完成，请重试。已显示的片段尚未保存为回复。" }); }
      finally { clearInterval(heartbeat); reply.raw.off("close", closed); reply.raw.end(); }
      return;
    }
    const controller = new AbortController();
    const closed = () => controller.abort();
    reply.raw.on("close", closed);
    try { return await codexPrep.converse(book, request.body.message, request.body.chapterId, request.body.draft === true, { signal: controller.signal }); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : "备课失败" }); }
    finally { reply.raw.off("close", closed); }
  });
  app.post<{ Params: { bookId: string }; Body: { draftId?: string } }>("/api/books/:bookId/prep/discard", async (request, reply) => {
    const book = await bookImportService.getBook(request.params.bookId);
    if (!book) return reply.code(404).send({ error: "Book not found" });
    if (typeof request.body?.draftId !== "string") return reply.code(400).send({ error: "Invalid draft ID" });
    try { await codexPrep.discard(book, request.body.draftId); return { discarded: true }; }
    catch { return reply.code(409).send({ error: "候选已失效，请刷新备课状态。" }); }
  });
  app.post<{ Params: { bookId: string }; Body: { draftId?: string } }>("/api/books/:bookId/prep/approve", async (request, reply) => {
    const book = await bookImportService.getBook(request.params.bookId);
    if (!book) return reply.code(404).send({ error: "Book not found" });
    if (typeof request.body?.draftId !== "string") return reply.code(400).send({ error: "Invalid draft ID" });
    try { return reply.code(201).send(await codexPrep.approve(book, request.body.draftId)); }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "候选保存失败" }); }
  });

  app.put<{ Body: AiProviderSaveRequest }>("/api/ai-settings/profile", async (request, reply) => {
    try {
      const profile = request.body?.profile;
      if (!profile) return reply.code(400).send({ error: "AI 配置内容不能为空" });
      const result = await aiSettingsService.saveProfile(profile, Boolean(request.body?.activate));
      if (request.body?.activate) queueMicrotask(() => { void trackReaderBackground(() => guidePreparationService.resumeAllIncomplete()); });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 配置保存失败";
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Params: { profileId: string } }>("/api/ai-settings/profiles/:profileId/activate", async (request, reply) => {
    try {
      const result = await aiSettingsService.activateProfile(request.params.profileId);
      queueMicrotask(() => { void trackReaderBackground(() => guidePreparationService.resumeAllIncomplete()); });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 配置切换失败";
      return reply.code(400).send({ error: message });
    }
  });

  app.delete<{ Params: { profileId: string } }>("/api/ai-settings/profiles/:profileId", async (request, reply) => {
    try {
      return await aiSettingsService.deleteProfile(request.params.profileId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 配置删除失败";
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Body: AiProviderProfileDraft }>("/api/ai-settings/test", async (request) => (
    aiSettingsService.testConnection(request.body)
  ));

  app.post<{ Body: AiProviderProfileDraft }>("/api/ai-settings/models", async (request, reply) => {
    try {
      return await aiSettingsService.discoverModels(request.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法获取模型列表";
      return reply.code(502).send({ error: message });
    }
  });

  app.post<{
    Body: { text?: string; contextBefore?: string; contextAfter?: string; mode?: "paragraph" | "sentence"; paragraphContext?: string; paragraphTranslationReference?: string; expectedProfileId?: string; expectedModel?: string };
  }>("/api/translate", async (request, reply) => {
    if (typeof request.body?.text !== "string") return reply.code(400).send({ error: "Translation text is required" });
    if (request.body.mode !== undefined && request.body.mode !== "paragraph" && request.body.mode !== "sentence") return reply.code(400).send({ error: "Invalid translation mode" });
    if ((request.body.expectedProfileId !== undefined && (typeof request.body.expectedProfileId !== "string" || request.body.expectedProfileId.length > 200)) || (request.body.expectedModel !== undefined && (typeof request.body.expectedModel !== "string" || request.body.expectedModel.length > 200))) return reply.code(400).send({ error: "Invalid expected translation profile" });
    const activeTranslationIdentity = options.getTranslationCacheIdentity?.() ?? (() => { const profile = aiSettingsService.getActiveProfile(); return { profileId: profile?.id ?? null, model: profile?.model ?? null }; })();
    if (request.body.expectedProfileId && request.body.expectedProfileId !== activeTranslationIdentity.profileId) return reply.code(409).send({ error: "Translation profile changed; retry with the active profile" });
    if (request.body.expectedModel && request.body.expectedModel !== activeTranslationIdentity.model) return reply.code(409).send({ error: "Translation model changed; retry with the active model" });
    for (const value of [request.body.contextBefore, request.body.contextAfter, request.body.paragraphContext, request.body.paragraphTranslationReference]) {
      if (value !== undefined && (typeof value !== "string" || value.length > 12000)) return reply.code(400).send({ error: "Invalid translation context" });
    }
    if (request.body.mode === "sentence" && (!request.body.paragraphContext?.trim() || !request.body.paragraphContext.includes(request.body.text.trim()))) return reply.code(400).send({ error: "Sentence must be present in its containing paragraph" });
    const text = request.body.text.trim();
    if (!text) return reply.code(400).send({ error: "Translation text is required" });
    if (!isTranslatableText(text)) return reply.code(400).send({ error: "Translation text must contain letters or numbers" });
    if (text.length > 12_000) return reply.code(400).send({ error: "Translation text is too long" });
    if (!translationAvailable() || !translationProvider) {
      return reply.code(503).send({ error: "Local translation provider is not configured" });
    }

    try {
      const translated = await translationProvider.translate({
        text,
        contextBefore: request.body.contextBefore,
        contextAfter: request.body.contextAfter,
        ...(request.body.mode ? { mode: request.body.mode } : {}),
        ...(request.body.paragraphContext ? { paragraphContext: request.body.paragraphContext } : {}),
        ...(request.body.paragraphTranslationReference ? { paragraphTranslationReference: request.body.paragraphTranslationReference } : {}),
      });
      if (request.body.expectedProfileId && translated.profileId !== request.body.expectedProfileId) return reply.code(409).send({ error: "Translation provider profile did not match the requested profile" });
      if (request.body.expectedModel && translated.model !== request.body.expectedModel) return reply.code(409).send({ error: "Translation provider model did not match the requested model" });
      return translated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Translation request failed";
      return reply.code(502).send({ error: message });
    }
  });

  app.post<{
    Body: { action?: "translate" | "explain"; text?: string; context?: string; articleTitle?: string };
  }>("/api/selection-assist", async (request, reply) => {
    const action = request.body?.action;
    const text = request.body?.text?.trim() ?? "";
    if (action !== "translate" && action !== "explain") {
      return reply.code(400).send({ error: "Selection assist action must be translate or explain" });
    }
    if (!text) return reply.code(400).send({ error: "Selected text is required" });
    if (text.length > 2_000) return reply.code(400).send({ error: "Selected text is too long" });
    if ((request.body.context?.length ?? 0) > 12_000) {
      return reply.code(400).send({ error: "Selection context is too long" });
    }
    if (!selectionAssistAvailable() || !selectionAssistProvider) {
      return reply.code(503).send({ error: "Local selection-assist provider is not configured" });
    }

    try {
      return await selectionAssistProvider.assist({
        action,
        text,
        context: request.body.context,
        articleTitle: request.body.articleTitle,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Selection assist request failed";
      return reply.code(502).send({ error: message });
    }
  });
  app.post<{
    Body: Partial<ReadingAssistantRequest>;
  }>("/api/reading-assistant", async (request, reply) => {
    const identity = readingDocumentIdentityFromLegacyFields(request.body);
    const question = request.body?.question?.trim() ?? "";
    const mode = request.body?.mode;
    if (!identity) return reply.code(400).send({ error: "Reading assistant document identity is required" });
    if (!question) return reply.code(400).send({ error: "Reading assistant question is required" });
    if (question.length > 4_000) return reply.code(400).send({ error: "Reading assistant question is too long" });
    if (mode !== "quick" && mode !== "deep") return reply.code(400).send({ error: "Reading assistant mode must be quick or deep" });
    if (!readingAssistantAvailable() || !readingAssistantProvider) {
      return reply.code(503).send({ error: "Local reading-assistant provider is not configured" });
    }

    let publicationName: string;
    let articleTitle: string;
    let articleSubtitle: string | null | undefined;
    let paragraphs: string[];
    if (identity.kind === "article") {
      const issue = await service.getIssue(identity.issueId);
      if (!issue) return reply.code(404).send({ error: "Issue not found" });
      const article = issue.articles.find((candidate) => candidate.id === identity.articleId);
      if (!article) return reply.code(404).send({ error: "Article not found" });
      publicationName = issue.publicationName;
      articleTitle = article.title;
      articleSubtitle = article.subtitle;
      paragraphs = article.bodyText.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
    } else {
      const book = await bookImportService.getBook(identity.bookId);
      if (!book) return reply.code(404).send({ error: "Book not found" });
      publicationName = book.title;
      if (identity.kind === "book-lesson") {
        const lesson = codexPrep.list(book.id).find((candidate) => candidate.id === identity.lessonId && candidate.sourceFingerprint === book.sourceFingerprint);
        if (!lesson) return reply.code(404).send({ error: "Saved lesson not found for this book version" });
        articleTitle = lesson.titleZh;
        articleSubtitle = lesson.adaptation;
        paragraphs = lessonParagraphs(lesson);
      } else {
        const chapter = book.chapters.find((candidate) => candidate.id === identity.chapterId);
        if (!chapter) return reply.code(404).send({ error: "Chapter not found" });
        articleTitle = chapter.title;
        articleSubtitle = undefined;
        paragraphs = chapter.paragraphs;
      }
    }
    const currentParagraphIndex = request.body.currentParagraphIndex;
    if (currentParagraphIndex !== undefined
      && (!Number.isInteger(currentParagraphIndex) || currentParagraphIndex < 0 || currentParagraphIndex >= paragraphs.length)) {
      return reply.code(400).send({ error: "Reading assistant current paragraph is invalid" });
    }
    const rawHistory = Array.isArray(request.body.history) ? request.body.history : [];
    if (rawHistory.length > 8) return reply.code(400).send({ error: "Reading assistant history is too long" });
    const history: ReadingAssistantTurn[] = [];
    for (const turn of rawHistory) {
      if (!turn || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.text !== "string") {
        return reply.code(400).send({ error: "Reading assistant history is invalid" });
      }
      const text = turn.text.trim();
      if (!text || text.length > 4_000) return reply.code(400).send({ error: "Reading assistant history turn is invalid" });
      history.push({ role: turn.role, text });
    }

    try {
      return await readingAssistantProvider.assist({
        sourceKind: identity.kind,
        question,
        mode,
        publicationName,
        articleTitle,
        articleSubtitle,
        paragraphs,
        currentParagraphIndex,
        history,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reading assistant request failed";
      return reply.code(502).send({ error: message });
    }
  });

  app.post<{
    Body: Partial<WordContextRequest>;
  }>("/api/word-context", async (request, reply) => {
    const text = request.body?.text?.trim() ?? "";
    const sentence = request.body?.sentence?.trim() ?? "";
    if (!text) return reply.code(400).send({ error: "Word-context target is required" });
    if (!sentence) return reply.code(400).send({ error: "Word-context sentence is required" });
    if (text.length > 500) return reply.code(400).send({ error: "Word-context target is too long" });
    if (sentence.length > 4_000) return reply.code(400).send({ error: "Word-context sentence is too long" });
    if ((request.body.paragraph?.length ?? 0) > 12_000
      || (request.body.contextBefore?.length ?? 0) > 12_000
      || (request.body.contextAfter?.length ?? 0) > 12_000) {
      return reply.code(400).send({ error: "Word-context nearby text is too long" });
    }
    if (request.body.verifyConsistency !== undefined && typeof request.body.verifyConsistency !== "boolean") return reply.code(400).send({ error: "Invalid consistency request" });
    for (const value of [request.body.sentenceTranslationZh, request.body.expressionExplanationZh, request.body.suggestedMeaningZh]) {
      if (value !== undefined && (typeof value !== "string" || value.length > 12000)) return reply.code(400).send({ error: "Invalid consistency context" });
    }
    if (!wordContextAvailable() || !wordContextProvider) {
      return reply.code(503).send({ error: "Local word-context provider is not configured" });
    }

    try {
      return await wordContextProvider.explain({
        text,
        sentence,
        paragraph: request.body.paragraph,
        contextBefore: request.body.contextBefore,
        contextAfter: request.body.contextAfter,
        articleTitle: request.body.articleTitle,
        ...(request.body.verifyConsistency ? { verifyConsistency: true, sentenceTranslationZh: request.body.sentenceTranslationZh, expressionExplanationZh: request.body.expressionExplanationZh, suggestedMeaningZh: request.body.suggestedMeaningZh } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Word-context request failed";
      return reply.code(502).send({ error: message });
    }
  });

  app.get<{ Querystring: { word?: string; accent?: string } }>("/api/word-audio", async (request, reply) => {
    const word = request.query?.word ?? "";
    const accent = request.query?.accent;
    if (!word.trim() || word.length > 80 || !/^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/.test(word.trim())
      || (accent !== "us" && accent !== "uk")) {
      return reply.code(400).send({ error: "单词或美英发音口音无效" });
    }
    try {
      const result = await wordAudio.get(word, accent);
      return reply.header("Cache-Control", "private, max-age=86400")
        .header("X-Content-Type-Options", "nosniff")
        .header("X-Word-Audio-Cache", result.cached ? "hit" : "miss")
        .type("audio/mpeg").send(result.audio);
    } catch (error) {
      return reply.code(error instanceof WordAudioError ? 502 : 500)
        .header("Cache-Control", "no-store")
        .send({ error: error instanceof Error ? error.message : "英文发音暂不可用" });
    }
  });

  app.get<{
    Querystring: { word?: string };
  }>("/api/dictionary", async (request, reply) => {
    const word = request.query?.word?.trim() ?? "";
    if (!word) return reply.code(400).send({ error: "Dictionary word is required" });
    if (word.length > 120 || !/^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/.test(word)) {
      return reply.code(400).send({ error: "Dictionary lookup requires one English word" });
    }
    if (!dictionaryProvider) {
      return reply.code(503).send({ error: "Dictionary provider is not configured" });
    }
    try {
      return await dictionaryProvider.lookup(word);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dictionary lookup failed";
      return reply.code(502).send({ error: message });
    }
  });

  app.post("/api/source-sync/github", async (_request, reply) => {
    try {
      const report = await runGithubMagazineSync();
      void refreshScienceContent().then((snapshot) => {
        const errors = snapshot.sources.filter((source) => source.status === "error");
        if (errors.length) app.log.warn({ sources: errors.map((source) => source.sourceId) }, "Content discovery had source errors");
      }).catch((error: unknown) => app.log.warn({ error }, "Content discovery refresh failed"));
      return reply.code(report.failedCount > 0 ? 502 : 200).send(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub magazine sync failed";
      return reply.code(502).send({ error: message });
    }
  });

  app.get("/api/content-discovery", async () => contentDiscoveryService.snapshot());
  app.post("/api/content-discovery/refresh", async (_request, reply) => {
    try {
      return await refreshScienceContent(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "内容发现暂时不可用";
      return reply.code(500).send({ error: message });
    }
  });

  app.get("/api/science-articles", async () => scienceArticleService.list());
  app.get<{ Params: { id: string; mediaId: string } }>("/api/science-articles/:id/media/:mediaId", async (request, reply) => {
    const media = await scienceArticleService.getMedia(request.params.id, request.params.mediaId);
    if (!media) return reply.code(404).send({ error: "本机图片不存在" });
    return reply.header("Content-Type", media.mimeType)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .header("Cache-Control", "private, max-age=86400, immutable").send(media.data);
  });
  app.post<{ Params: { id: string } }>("/api/science-articles/:id/refresh", async (request, reply) => {
    try { return await scienceArticleService.refresh(request.params.id); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "补全原文图文失败" }); }
  });
  app.post<{ Body: { sourceUrl?: string } }>("/api/science-articles/import", async (request, reply) => {
    if (typeof request.body?.sourceUrl !== "string") return reply.code(400).send({ error: "sourceUrl is required" });
    try { return await scienceArticleService.importFromSource(request.body.sourceUrl); }
    catch (error) {
      const message = error instanceof Error ? error.message : "科普文章收录失败";
      return reply.code(400).send({ error: message });
    }
  });
  app.delete<{ Params: { id: string } }>("/api/science-articles/:id", async (request, reply) => {
    const deleted = await scienceArticleService.delete(request.params.id);
    return deleted ? { status: "deleted" } : reply.code(404).send({ error: "科普文章不存在" });
  });

  app.post<{ Querystring: { filename?: string }; Body: Buffer }>(
    "/api/import/epub/preview",
    { bodyLimit: 150 * 1024 * 1024 },
    async (request, reply) => {
      const filename = request.query?.filename?.trim() ?? "";
      if (!filename) return reply.code(400).send({ error: "EPUB filename is required" });
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "EPUB binary body is required" });
      return epubImportService.preview(filename, request.body);
    },
  );

  app.post<{ Querystring: { filename?: string }; Body: Buffer }>(
    "/api/import/epub",
    { bodyLimit: 150 * 1024 * 1024 },
    async (request, reply) => {
      const filename = request.query?.filename?.trim() ?? "";
      if (!filename) return reply.code(400).send({ error: "EPUB filename is required" });
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "EPUB binary body is required" });
      const result = await epubImportService.import(filename, request.body);
      const importedIssueId = result.issueId;
      if (result.status === "imported" && importedIssueId && (readerGuideAvailable() || sectionTranslationAvailable())) {
        void trackReaderBackground(() => guidePreparationService.start(importedIssueId));
      }
      return reply.code(result.status === "imported" ? 201 : 200).send(result);
    },
  );

  app.post<{ Querystring: { filename?: string }; Body: Buffer }>(
    "/api/books/import/preview",
    { bodyLimit: 150 * 1024 * 1024 },
    async (request, reply) => {
      const filename = request.query?.filename?.trim() ?? "";
      if (!filename) return reply.code(400).send({ error: "Book EPUB filename is required" });
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "Book EPUB binary body is required" });
      return bookImportService.preview(filename, request.body);
    },
  );

  app.post<{ Querystring: { filename?: string; categoryId?: string }; Body: Buffer }>(
    "/api/books/import",
    { bodyLimit: 150 * 1024 * 1024 },
    async (request, reply) => {
      const filename = request.query?.filename?.trim() ?? "";
      if (!filename) return reply.code(400).send({ error: "Book EPUB filename is required" });
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "Book EPUB binary body is required" });
      const categoryId = request.query.categoryId ?? "uncategorized";
      if (!isBookCategoryId(categoryId)) return reply.code(400).send({ error: "请选择有效的书籍分类。" });
      const result = await bookImportService.import(filename, request.body, bookId => bookCategories.set(bookId, categoryId));
      const importedBookId = result.bookId;
      if (result.status === "imported" && importedBookId && aiSettingsService.hasConfiguredActiveProfile()) {
        void trackReaderBackground(async () => {
          const book = await bookImportService.getBook(importedBookId);
          return book ? bookTocChineseService.start(book) : undefined;
        }).catch((error: unknown) => app.log.error({ error }, "Book TOC Chinese preparation failed to start"));
      }
      return reply.code(result.status === "imported" ? 201 : 200).send({ ...result, ...(result.status === "imported" ? { categoryId } : {}) });
    },
  );

  app.get("/api/books", async () => {
    const [books, categories] = await Promise.all([bookImportService.listBooks(), bookCategories.assignments()]);
    return books.map(book => ({ ...book, categoryId: categories[book.id] ?? "uncategorized" }));
  });

  app.patch<{ Params: { bookId: string }; Body: { categoryId?: unknown } }>("/api/books/:bookId/category", async (request, reply) => {
    const { bookId } = request.params;
    const categoryId = request.body?.categoryId;
    if (!isBookCategoryId(categoryId)) return reply.code(400).send({ error: "请选择有效的书籍分类。" });
    if (!(await bookImportService.listBooks()).some(book => book.id === bookId)) return reply.code(404).send({ error: "Book not found" });
    if (bookImportService.isDeleting(bookId) || bookImportService.isImporting(bookId)) return reply.code(409).send({ error: "该书正在导入或删除，请稍后重试。" });
    await bookCategories.set(bookId, categoryId);
    return { bookId, categoryId };
  });

  app.delete<{ Params: { bookId: string } }>("/api/books/:bookId", async (request, reply) => {
    const { bookId } = request.params;
    if (bookTocChineseService.isRunning(bookId)) {
      return reply.code(409).send({ error: "该书正在生成中文目录，请稍后再删除。" });
    }
    try {
      const result = await bookImportService.deleteBook(bookId, () => bookTocChineseService.remove(bookId));
      if (result === "missing") return reply.code(404).send({ error: "Book not found" });
      if (result === "busy") return reply.code(409).send({ error: "该书正在导入或删除，请稍后重试。" });
      return { status: "deleted", bookId };
    } catch (error) {
      return reply.code(bookTocChineseService.isRunning(bookId) ? 409 : 500).send({ error: error instanceof Error ? error.message : "删除电子书失败" });
    }
  });

  app.get<{ Params: { bookId: string } }>("/api/books/:bookId", async (request, reply) => {
    const book = await bookImportService.getBook(request.params.bookId);
    if (!book) return reply.code(404).send({ error: "Book not found" });
    return book;
  });

  app.get<{ Params: { bookId: string }; Querystring: { chapterId?: string } }>("/api/books/:bookId/original-content", async (request, reply) => {
    const html = await bookImportService.getOriginalChapter(request.params.bookId, request.query.chapterId ?? "");
    if (!html) return reply.code(404).send({ error: "Original chapter not found" });
    return reply.type("text/html; charset=utf-8").header("Content-Security-Policy", ORIGINAL_CONTENT_CSP)
      .header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").send(html);
  });

  app.get<{ Params: { bookId: string }; Querystring: { path?: string } }>("/api/books/:bookId/original-resource", async (request, reply) => {
    const resource = await bookImportService.getOriginalResource(request.params.bookId, request.query.path ?? "");
    if (!resource) return reply.code(404).send({ error: "Original resource not found" });
    return reply.type(resource.mediaType).header("Content-Security-Policy", ORIGINAL_CONTENT_CSP)
      .header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").send(resource.data);
  });

  app.get<{ Params: { bookId: string } }>("/api/books/:bookId/original-file", async (request, reply) => {
    const file = await bookImportService.getOriginalFile(request.params.bookId);
    if (!file) return reply.code(404).send({ error: "Original book not found" });
    return reply.type("application/epub+zip").header("Cache-Control", "no-store")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`).send(file.data);
  });

  app.get<{ Params: { bookId: string } }>("/api/books/:bookId/toc-chinese", async (request, reply) => {
    const book = await bookImportService.getBook(request.params.bookId);
    if (!book) return reply.code(404).send({ error: "Book not found" });
    return bookTocChineseService.status(book);
  });

  app.post<{ Params: { bookId: string }; Body: { regenerate?: boolean } }>("/api/books/:bookId/toc-chinese", async (request, reply) => {
    const book = await bookImportService.getBook(request.params.bookId);
    if (!book) return reply.code(404).send({ error: "Book not found" });
    if (request.body?.regenerate !== undefined && typeof request.body.regenerate !== "boolean") {
      return reply.code(400).send({ error: "regenerate must be a boolean" });
    }
    try {
      return await bookTocChineseService.start(book, request.body?.regenerate === true);
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : "中文目录生成不可用" });
    }
  });

  app.get<{ Params: { bookId: string } }>("/api/books/:bookId/cover", async (request, reply) => {
    const cover = await bookImportService.getCover(request.params.bookId);
    if (!cover) return reply.code(404).send({ error: "Book cover not found" });
    reply.type(cover.mediaType);
    return reply.send(cover.data);
  });

  app.post<{ Params: { issueId: string }; Querystring: { filename?: string }; Body: Buffer }>(
    "/api/issues/:issueId/replace/preview",
    { bodyLimit: 150 * 1024 * 1024 },
    async (request, reply) => {
      const filename = request.query?.filename?.trim() ?? "";
      if (!filename) return reply.code(400).send({ error: "EPUB filename is required" });
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "EPUB binary body is required" });
      const result = await epubImportService.previewReplacement(request.params.issueId, filename, request.body);
      return reply.code(result.status === "missing" ? 404 : 200).send(result);
    },
  );

  app.post<{ Params: { issueId: string }; Querystring: { filename?: string }; Body: Buffer }>(
    "/api/issues/:issueId/replace",
    { bodyLimit: 150 * 1024 * 1024 },
    async (request, reply) => {
      const issueId = request.params.issueId;
      const filename = request.query?.filename?.trim() ?? "";
      if (!filename) return reply.code(400).send({ error: "EPUB filename is required" });
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "EPUB binary body is required" });
      if (guidePreparationService.isRunning(issueId)) {
        return reply.code(409).send({ error: "该期正在生成中文导读，请稍后再替换。" });
      }

      const preview = await epubImportService.previewReplacement(issueId, filename, request.body, false);
      if (preview.status === "missing") return reply.code(404).send(preview);
      if (preview.status !== "ready") return reply.code(200).send(preview);

      const result = await service.replaceIssueSource(issueId, request.body);
      if (!result) return reply.code(404).send({ error: "Issue not found" });
      if (result.status === "busy") return reply.code(409).send({ error: "该期正在被读取或更新，请稍后再替换。" });

      await guidePreparationService.removeStatus(result.file.id);
      if (readerGuideAvailable() || sectionTranslationAvailable()) void trackReaderBackground(() => guidePreparationService.start(result.file.id));
      return {
        ...preview,
        status: "replaced",
        coverDataUrl: undefined,
        existingFilename: result.file.filename,
        message: "替换完成。issueId 与浏览器阅读数据保持不变。",
      };
    },
  );

  app.get("/api/issues", async () => service.listIssues());

  app.delete<{ Params: { issueId: string } }>("/api/issues/:issueId", async (request, reply) => {
    const issueId = request.params.issueId;
    if (epubImportService.isImporting(issueId) || guidePreparationService.isRunning(issueId)) {
      return reply.code(409).send({ error: "该期正在导入或生成中文导读，请稍后再删除。" });
    }
    try {
      const result = await service.deleteIssue(issueId);
      if (!result) return reply.code(404).send({ error: "Issue not found" });
      if (result.status === "busy") return reply.code(409).send({ error: "该期正在被读取或更新，请稍后再删除。" });
      await guidePreparationService.removeStatus(result.file.id);
      return {
        deleted: true,
        issueId: result.file.id,
        filename: result.file.filename,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除期刊失败";
      return reply.code(500).send({ error: message });
    }
  });

  app.get<{ Params: { issueId: string } }>("/api/issues/:issueId/guide-preparation", async (request, reply) => {
    const status = await guidePreparationService.getStatus(request.params.issueId);
    if (!status) return reply.code(404).send({ error: "Issue not found" });
    return status;
  });

  app.post<{ Params: { issueId: string } }>("/api/issues/:issueId/guide-preparation", async (request, reply) => {
    if (!readerGuideAvailable() && !sectionTranslationAvailable()) {
      return reply.code(503).send({ error: "Local Chinese-guide providers are not configured" });
    }
    const status = await guidePreparationService.start(request.params.issueId);
    if (!status) return reply.code(404).send({ error: "Issue not found" });
    return reply.code(status.state === "complete" ? 200 : 202).send(status);
  });

  app.get<{ Params: { issueId: string } }>("/api/issues/:issueId/cover", async (request, reply) => {
    const cover = await service.getIssueCover(request.params.issueId);
    if (!cover) return reply.code(404).send({ error: "Issue cover not found" });
    return reply
      .type(cover.mediaType)
      .header("Cache-Control", "private, max-age=3600")
      .send(cover.data);
  });

  app.get<{ Params: { issueId: string; articleId: string } }>(
    "/api/issues/:issueId/articles/:articleId/images",
    async (request, reply) => {
      const images = await service.getArticleImages(request.params.issueId, request.params.articleId);
      if (!images) return reply.code(404).send({ error: "Issue or article not found" });
      return images;
    },
  );

  app.get<{ Params: { issueId: string; articleId: string; imageId: string } }>(
    "/api/issues/:issueId/articles/:articleId/images/:imageId",
    async (request, reply) => {
      const image = await service.getArticleImage(request.params.issueId, request.params.articleId, request.params.imageId);
      if (!image) return reply.code(404).send({ error: "Article image not found" });
      return reply
        .type(image.mediaType)
        .header("Cache-Control", "private, max-age=3600")
        .send(image.data);
    },
  );

  app.post<{
    Params: { issueId: string };
    Body: { limit?: number };
  }>("/api/issues/:issueId/guides", async (request, reply) => {
    if (!readerGuideAvailable() || !readerGuideProvider) {
      return reply.code(503).send({ error: "Local reader-guide provider is not configured" });
    }
    const limit = Number.isFinite(request.body?.limit) ? Number(request.body.limit) : 8;
    if (limit < 1 || limit > 12) return reply.code(400).send({ error: "Guide batch limit must be 1..12" });
    try {
      const result = await service.generateReaderGuideBatch(request.params.issueId, readerGuideProvider, limit);
      if (!result) return reply.code(404).send({ error: "Issue not found" });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reader guide generation failed";
      return reply.code(502).send({ error: message });
    }
  });

  app.post<{
    Params: { issueId: string };
  }>("/api/issues/:issueId/section-translations", async (request, reply) => {
    if (!sectionTranslationAvailable() || !sectionTranslationProvider) {
      return reply.code(503).send({ error: "Local section-translation provider is not configured" });
    }
    try {
      const result = await service.generateSectionTranslations(request.params.issueId);
      if (!result) return reply.code(404).send({ error: "Issue not found" });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Section translation generation failed";
      return reply.code(502).send({ error: message });
    }
  });

  app.get<{ Params: { issueId: string } }>("/api/issues/:issueId", async (request, reply) => {
    const issue = await service.getIssue(request.params.issueId);
    if (!issue) return reply.code(404).send({ error: "Issue not found" });
    return issue;
  });

  app.get<{ Params: { issueId: string; articleId: string } }>(
    "/api/issues/:issueId/articles/:articleId",
    async (request, reply) => {
      const article = await service.getArticle(request.params.issueId, request.params.articleId);
      if (!article) return reply.code(404).send({ error: "Article not found" });
      return article;
    },
  );

  app.patch<{ Params: { issueId: string; articleId: string }; Body: StatusUpdateBody }>(
    "/api/issues/:issueId/articles/:articleId/status",
    async (request, reply) => {
      const status = request.body?.status ?? null;
      if (!allowedStatuses.has(status)) return reply.code(400).send({ error: "Invalid status" });
      const article = await service.updateStatus(request.params.issueId, request.params.articleId, status);
      if (!article) return reply.code(404).send({ error: "Article not found" });
      return article;
    },
  );

  if (options.serveFrontend !== false) {
    const distDir = path.join(options.projectRoot, "dist");
    if (existsSync(distDir)) {
      await app.register(fastifyStatic, { root: distDir });
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
        return reply.sendFile("index.html");
      });
    }
  }

  if (readerGuideAvailable() || sectionTranslationAvailable()) {
    queueMicrotask(() => {
      void trackReaderBackground(() => guidePreparationService.resumeAllIncomplete());
    });
  }

  return app;
}
