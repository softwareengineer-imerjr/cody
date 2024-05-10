import { fetchLocalOllamaModels } from '../llm-providers/ollama/utils'
import { CHAT_INPUT_TOKEN_BUDGET, CHAT_OUTPUT_TOKEN_BUDGET } from '../token/constants'
import type { ModelContextWindow, ModelUsage } from './types'
import { getModelInfo } from './utils'

/**
 * ModelProvider manages available chat and edit models.
 * It stores a set of available providers and methods to add,
 * retrieve and select between them.
 */
export class ModelProvider {
    /**
     * Whether the model is the default model for new chats and edits. The user can change their
     * default model.
     */
    public default = false

    /**
     * Whether the model is the server-set initial default for new users.
     */
    public initialDefault? = false

    // Whether the model is only available to Pro users
    public codyProOnly = false
    // The name of the provider of the model, e.g. "Anthropic"
    public provider: string
    // The title of the model, e.g. "Claude 3 Sonnet"
    public readonly title: string
    // A deprecated model can be used (to not break agent) but won't be rendered
    // in the UI
    public deprecated = false

    constructor(
        /**
         * The model id that includes the provider name & the model name,
         * e.g. "anthropic/claude-3-sonnet-20240229"
         */
        public readonly model: string,
        /**
         * The usage of the model, e.g. chat or edit.
         */
        public readonly usage: ModelUsage[],
        /**
         * The default context window of the model reserved for Chat and Context.
         * {@see TokenCounter on how the token usage is calculated.}
         */
        public readonly contextWindow: ModelContextWindow = {
            input: CHAT_INPUT_TOKEN_BUDGET,
            output: CHAT_OUTPUT_TOKEN_BUDGET,
        },
        /**
         * The configuration for the model.
         */
        public readonly config?: {
            /**
             * The API key for the model
             */
            apiKey?: string
            /**
             * The API endpoint for the model
             */
            apiEndpoint?: string
        },
        public readonly uiGroup?: string
    ) {
        const { provider, title } = getModelInfo(model)
        this.provider = provider
        this.title = title
    }

    /**
     * Get all the providers currently available to the user
     */
    private static get providers(): ModelProvider[] {
        return ModelProvider.primaryProviders.concat(ModelProvider.localProviders)
    }
    /**
     * Providers available on the user's Sourcegraph instance
     */
    private static primaryProviders: ModelProvider[] = []
    /**
     * Providers available from user's local instances, e.g. Ollama
     */
    private static localProviders: ModelProvider[] = []

    public static async onConfigChange(enableOllamaModels: boolean): Promise<void> {
        // Only fetch local models if user has enabled the config
        ModelProvider.localProviders = enableOllamaModels ? await fetchLocalOllamaModels() : []
    }

    /**
     * Sets the primary model providers.
     * NOTE: private instances can only support 1 provider atm
     */
    public static setProviders(providers: ModelProvider[]): void {
        ModelProvider.primaryProviders = providers
    }

    /**
     * Add new providers as primary model providers.
     */
    public static addProviders(providers: ModelProvider[]): void {
        const set = new Set(ModelProvider.primaryProviders)
        for (const provider of providers) {
            set.add(provider)
        }
        ModelProvider.primaryProviders = Array.from(set)
    }

    /**
     * Get the list of the primary models providers with local models.
     * If currentModel is provided, sets it as the default model.
     */
    public static getProviders(
        type: ModelUsage,
        isCodyProUser: boolean,
        currentModel?: string
    ): ModelProvider[] {
        const availableModels = ModelProvider.providers.filter(m => m.usage.includes(type))

        const currentDefault = currentModel
            ? availableModels.find(m => m.model === currentModel)
            : undefined
        const canUseCurrentDefault = currentDefault?.codyProOnly ? isCodyProUser : !!currentDefault

        return ModelProvider.providers
            .filter(m => m.usage.includes(type))
            ?.map(model => ({
                ...model,
                // Set the current model as default
                default: canUseCurrentDefault ? model.model === currentModel : model.default,
            }))
    }

    /**
     * Finds the model provider with the given model ID and returns its Context Window.
     */
    public static getContextWindowByID(modelID: string): ModelContextWindow {
        const model = ModelProvider.providers.find(m => m.model === modelID)
        return model
            ? model.contextWindow
            : { input: CHAT_INPUT_TOKEN_BUDGET, output: CHAT_OUTPUT_TOKEN_BUDGET }
    }

    public static getProviderByModel(modelID: string): ModelProvider | undefined {
        return ModelProvider.providers.find(m => m.model === modelID)
    }

    public static getProviderByModelSubstringOrError(modelSubstring: string): ModelProvider {
        const models = ModelProvider.providers.filter(m => m.model.includes(modelSubstring))
        if (models.length === 1) {
            return models[0]
        }
        if (models.length === 0) {
            throw new Error(`No model found for substring ${modelSubstring}`)
        }
        throw new Error(
            `Multiple models found for substring ${modelSubstring}: ${models
                .map(m => m.model)
                .join(', ')}`
        )
    }
}
