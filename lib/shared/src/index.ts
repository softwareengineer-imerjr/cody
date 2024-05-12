// Add anything else here that needs to be used outside of this library.

export { ModelProvider } from './models'
export {
    type ChatModel,
    type EditModel,
    ModelUsage,
    type ModelContextWindow,
} from './models/types'
export { getDotComDefaultModels } from './models/dotcom'
export {
    getProviderName,
    getModelInfo,
    ModelUIGroup,
} from './models/utils'
export { BotResponseMultiplexer } from './chat/bot-response-multiplexer'
export { ChatClient } from './chat/chat'
export { ignores, isCodyIgnoredFile } from './cody-ignore/context-filter'
export {
    IgnoreHelper,
    CODY_IGNORE_POSIX_GLOB,
    type IgnoreFileContent,
    CODY_IGNORE_URI_PATH,
} from './cody-ignore/ignore-helper'
export { renderCodyMarkdown } from './chat/markdown'
export { getSimplePreamble } from './chat/preamble'
export type {
    SerializedChatInteraction,
    SerializedChatTranscript,
} from './chat/transcript'
export { serializeChatMessage } from './chat/transcript'
export {
    errorToChatError,
    DEFAULT_EVENT_SOURCE,
} from './chat/transcript/messages'
export type {
    ChatError,
    EventSource,
    ChatHistory,
    ChatMessage,
    UserLocalHistory,
    SerializedChatMessage,
} from './chat/transcript/messages'
export {
    CODY_PASSTHROUGH_VSCODE_OPEN_COMMAND_ID,
    webviewOpenURIForContextItem,
} from './chat/transcript/display-text'
export { Typewriter } from './chat/typewriter'
export { reformatBotMessageForChat } from './chat/viewHelpers'
export type {
    ContextGroup,
    ContextProvider,
    ContextStatusProvider,
    Disposable,
    EnhancedContextContextT,
    LocalEmbeddingsProvider,
    LocalSearchProvider,
    RemoteSearchProvider,
    SearchProvider,
} from './codebase-context/context-status'
export {
    type ContextItem,
    type ContextItemFile,
    ContextItemSource,
    type ContextItemWithContent,
    type ContextItemSymbol,
    type ContextFileType,
    type ContextItemPackage,
    type ContextItemGithubIssue,
    type ContextItemGithubPullRequest,
    type ContextMessage,
    type SymbolKind,
} from './codebase-context/messages'
export type {
    CodyCommand,
    CodyCommandContext,
    CodyCommandType,
    CodyCommandMode,
    TerminalOutputArguments,
} from './commands/types'
export { CustomCommandType } from './commands/types'
export {
    type DefaultCodyCommands,
    DefaultChatCommands,
    DefaultEditCommands,
} from './commands/types'
export { dedupeWith, isDefined, isErrorLike, pluralize } from './common'
export {
    type RangeData,
    toRangeData,
    displayLineRange,
    displayRange,
} from './common/range'
export * from './common/abortController'
export {
    ProgrammingLanguage,
    languageFromFilename,
    markdownCodeBlockLanguageIDForFilename,
    extensionForLanguage,
} from './common/languages'
export { renderMarkdown, escapeHTML } from './common/markdown'
export {
    posixFilePaths,
    pathFunctionsForURI,
    defaultPathFunctions,
} from './common/path'
export { parseEvents } from './sourcegraph-api/completions/parse'
export { isWindows, isMacOS } from './common/platform'
export {
    assertFileURI,
    isFileURI,
    uriBasename,
    uriDirname,
    uriExtname,
    uriParseNameAndExtension,
    type FileURI,
} from './common/uri'
export { NoopEditor } from './editor'
export type {
    ActiveTextEditor,
    ActiveTextEditorDiagnostic,
    ActiveTextEditorDiagnosticType,
    ActiveTextEditorSelection,
    ActiveTextEditorVisibleContent,
    Editor,
} from './editor'
export {
    displayPath,
    displayPathBasename,
    displayPathDirname,
    displayPathWithoutWorkspaceFolderPrefix,
    setDisplayPathEnvInfo,
    type DisplayPathEnvInfo,
} from './editor/displayPath'
export { hydrateAfterPostMessage } from './editor/hydrateAfterPostMessage'
export * from './editor/utils'
export {
    FeatureFlag,
    FeatureFlagProvider,
    featureFlagProvider,
} from './experimentation/FeatureFlagProvider'
export { GuardrailsPost, summariseAttribution } from './guardrails'
export type { Attribution, Guardrails } from './guardrails'
export { SourcegraphGuardrailsClient } from './guardrails/client'
export {
    CompletionStopReason,
    type CodeCompletionsClient,
    type CodeCompletionsParams,
    type SerializedCodeCompletionsParams,
    type CompletionResponseGenerator,
} from './inferenceClient/misc'
export type {
    ContextResult,
    FilenameContextFetcher,
    IndexedKeywordContextFetcher,
    LocalEmbeddingsFetcher,
    IRemoteSearch,
    Result,
    SearchPanelFile,
    SearchPanelSnippet,
} from './local-context'
export { logDebug, logError, setLogger } from './logger'
export {
    createOllamaClient,
    ollamaChatClient,
    type OllamaGenerateParams,
    OLLAMA_DEFAULT_URL,
} from './llm-providers/ollama'
export {
    MAX_BYTES_PER_FILE,
    MAX_CURRENT_FILE_TOKENS,
    ANSWER_TOKENS,
    NUM_CODE_RESULTS,
    NUM_TEXT_RESULTS,
    SURROUNDING_LINES,
} from './prompt/constants'
export { PromptMixin, newPromptMixin } from './prompt/prompt-mixin'
export * from './prompt/templates'
export {
    truncateText,
    truncateTextNearestLine,
    truncatePromptStringStart,
    truncatePromptString,
} from './prompt/truncation'
export type { Message } from './sourcegraph-api'
export {
    addClientInfoParams,
    getClientInfoParams,
    setClientNameVersion,
} from './sourcegraph-api/client-name-version'
export { SourcegraphBrowserCompletionsClient } from './sourcegraph-api/completions/browserClient'
export { SourcegraphCompletionsClient } from './sourcegraph-api/completions/client'
export type {
    CompletionLogger,
    CompletionsClientConfig,
} from './sourcegraph-api/completions/client'
export * from './sourcegraph-api/completions/types'
export {
    DOTCOM_URL,
    LOCAL_APP_URL,
    isDotCom,
} from './sourcegraph-api/environments'
export {
    AbortError,
    NetworkError,
    RateLimitError,
    TimeoutError,
    TracedError,
    isAbortError,
    isAuthError,
    isNetworkError,
    isRateLimitError,
} from './sourcegraph-api/errors'
export {
    SourcegraphGraphQLAPIClient,
    graphqlClient,
} from './sourcegraph-api/graphql'
export {
    ConfigFeaturesSingleton,
    addCustomUserAgent,
    customUserAgent,
    isNodeResponse,
    setUserAgent,
    INCLUDE_EVERYTHING_CONTEXT_FILTERS,
    EXCLUDE_EVERYTHING_CONTEXT_FILTERS,
    type BrowserOrNodeResponse,
    type GraphQLAPIClientConfig,
    type LogEventMode,
    type ContextFilters,
    type CodyContextFilterItem,
    type RepoListResponse,
} from './sourcegraph-api/graphql/client'
export type {
    CodyLLMSiteConfiguration,
    ContextSearchResult,
    EmbeddingsSearchResult,
    event,
} from './sourcegraph-api/graphql/client'
export { GraphQLTelemetryExporter } from './sourcegraph-api/telemetry/GraphQLTelemetryExporter'
// biome-ignore lint/nursery/noRestrictedImports: Deprecated v1 telemetry used temporarily to support existing analytics.
export { NOOP_TELEMETRY_SERVICE } from './telemetry'
// biome-ignore lint/nursery/noRestrictedImports: Deprecated v1 telemetry used temporarily to support existing analytics.
export type { TelemetryEventProperties, TelemetryService } from './telemetry'
export { type BillingCategory, type BillingProduct } from './telemetry-v2'
export {
    MockServerTelemetryRecorderProvider,
    NoOpTelemetryRecorderProvider,
    TelemetryRecorderProvider,
    noOpTelemetryRecorder,
} from './telemetry-v2/TelemetryRecorderProvider'
export type { TelemetryRecorder } from './telemetry-v2/TelemetryRecorderProvider'
export * from './telemetry-v2/singleton'
export { EventLogger } from './telemetry/EventLogger'
export type { ExtensionDetails } from './telemetry/EventLogger'
export { testFileUri } from './test/path-helpers'
export * from './tracing'
export {
    convertGitCloneURLToCodebaseName,
    isError,
    createSubscriber,
} from './utils'
export type { CurrentUserCodySubscription } from './sourcegraph-api/graphql/client'
export * from './auth/types'
export * from './auth/tokens'
export * from './chat/sse-iterator'
export {
    parseMentionQuery,
    type MentionQuery,
    scanForMentionTriggerInUserTextInput,
} from './mentions/query'
export {
    CONTEXT_MENTION_PROVIDERS,
    type ContextMentionProvider,
    type ContextItemProps,
    allMentionProvidersMetadata,
    FILE_CONTEXT_MENTION_PROVIDER,
    SYMBOL_CONTEXT_MENTION_PROVIDER,
    type ContextMentionProviderMetadata,
} from './mentions/api'
export { TokenCounter } from './token/counter'
export { ENHANCED_CONTEXT_ALLOCATION } from './token/constants'
export { tokensToChars, charsToTokens } from './token/utils'
export * from './prompt/prompt-string'
export { getCompletionsModelConfig } from './llm-providers/utils'
export * from './llm-providers/google/chat-client'
export * from './llm-providers/groq/chat-client'
export * from './fetch'
export * from './completions/types'
export * from './sourcegraph-api/completions/parse'
export * from './cody-ignore/context-filters-provider'
export * from './sourcegraph-api/utils'
export * from './token'
export * from './token/constants'
export * from './configuration'
export * from './mentions/providers/packageMentions'
export * from './mentions/providers/sourcegraphSearch'
export { GITHUB_CONTEXT_MENTION_PROVIDER } from './mentions/providers/githubMentions'
export { URL_CONTEXT_MENTION_PROVIDER } from './mentions/providers/urlMentions'
export * from './githubClient'
export {
    setOpenCtxExtensionAPI,
    getOpenCtxExtensionAPI,
    type OpenCtxExtensionAPI,
} from './context/openctx/api'
