import { OLLAMA_DEFAULT_URL, type OllamaChatParams, type OllamaGenerateResponse } from '.'
import { contextFiltersProvider } from '../../cody-ignore/context-filters-provider'
import { onAbort } from '../../common/abortController'
import { CompletionStopReason } from '../../inferenceClient/misc'
import type { CompletionLogger } from '../../sourcegraph-api/completions/client'
import type { CompletionCallbacks, CompletionParameters } from '../../sourcegraph-api/completions/types'
import { getCompletionsModelConfig } from '../utils'

/**
 * Calls the Ollama API for chat completions with history.
 *
 * Doc: https://github.com/ollama/ollama/blob/main/docs/api.md#chat-request-with-history
 */
export async function ollamaChatClient(
    params: CompletionParameters,
    cb: CompletionCallbacks,
    // This is used for logging as the completions request is sent to the provider's API
    completionsEndpoint: string,
    logger?: CompletionLogger,
    signal?: AbortSignal
): Promise<void> {
    const log = logger?.startCompletion(params, completionsEndpoint)
    if (!params.model || !params.messages) {
        log?.onError('No model or messages')
        throw new Error('No model or messages')
    }

    // Checks if the model is a custom model and gets the configuration (if any)
    const config = getCompletionsModelConfig(params.model)
    // Construct the Ollama chat parameters from the default completion parameters.
    const ollamaChatParams = {
        model: config?.model || params.model.replace('ollama/', ''),
        messages: await Promise.all(
            params.messages.map(async msg => {
                return {
                    role: msg.speaker === 'human' ? 'user' : 'assistant',
                    content: (await msg.text?.toFilteredString(contextFiltersProvider)) ?? '',
                }
            })
        ),
        options: {
            temperature: params.temperature,
            top_k: params.topK,
            top_p: params.topP,
            tfs_z: params.maxTokensToSample,
        },
    } satisfies OllamaChatParams

    // Sends the completion parameters and callbacks to the Ollama API.
    fetch(config?.endpoint ?? new URL('/api/chat', OLLAMA_DEFAULT_URL).href, {
        method: 'POST',
        body: JSON.stringify(ollamaChatParams),
        headers: {
            'Content-Type': 'application/json',
        },
        signal,
    })
        .then(res => res.body?.getReader())
        .then(async reader => {
            if (!reader) {
                log?.onError('No response body')
                throw new Error('No response body')
            }
            onAbort(signal, () => reader.cancel())
            let responseText = ''
            // Handles the response stream to accumulate the full completion text.
            while (true) {
                const { done, value } = await reader.read()
                try {
                    if (done) {
                        cb.onChange(responseText)
                        cb.onComplete()
                        break
                    }
                    const textDecoder = new TextDecoder()
                    const data = textDecoder.decode(value, { stream: true })
                    const parsedData = JSON.parse(data) as OllamaGenerateResponse
                    if (parsedData?.message) {
                        responseText += parsedData.message.content
                        cb.onChange(responseText)
                    }
                    // Log the completion response details on done.
                    if (parsedData.done) {
                        console.info('Ollama stream completed:', parsedData)
                    }
                } catch (error) {
                    throw new Error(`Error parsing response: ${error}`)
                }
            }
            log?.onComplete({
                completion: responseText,
                stopReason: CompletionStopReason.RequestFinished,
            })
        })
        .catch(error => {
            log?.onError(error)
            cb.onError(error)
        })
}
