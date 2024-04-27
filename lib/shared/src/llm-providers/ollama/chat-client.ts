import { OLLAMA_DEFAULT_URL, type OllamaChatParams, type OllamaGenerateResponse } from '.'
import { CompletionStopReason, logDebug } from '../..'
import { contextFiltersProvider } from '../../cody-ignore/context-filters-provider'
import { onAbort } from '../../common/abortController'
import type { CompletionLogger } from '../../sourcegraph-api/completions/client'
import type { CompletionCallbacks, CompletionParameters } from '../../sourcegraph-api/completions/types'
import { getCompletionsModelConfig } from '../utils'

const RESPONSE_SEPARATOR = /\r?\n/

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
                const { speaker, text } = msg
                return {
                    role: speaker === 'human' ? 'user' : speaker === 'system' ? 'system' : 'assistant',
                    content: (await text?.toFilteredString(contextFiltersProvider)) ?? '',
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
        .then(async response => {
            if (!response.ok || !response?.body) {
                log?.onError(`HTTP error ${response.status}`)
                throw new Error(`HTTP error ${response.status}`)
            }

            onAbort(signal, () => reader.cancel())

            // Used to decode the incoming data stream from the response body.
            const decoder = new TextDecoderStream()
            // Pipes the response body through the decoder to get a reader for the decoded stream.
            const reader = response.body.pipeThrough(decoder).getReader()

            let stopReason = ''
            let completion = ''

            while (!stopReason) {
                // Reads a chunk of the decoded stream.
                const { done, value } = await reader.read()

                if (value) {
                    // Splits the decoded chunk by the new lines and filters out empty strings.
                    for (const chunk of value.split(RESPONSE_SEPARATOR).filter(Boolean)) {
                        const line = JSON.parse(chunk) as OllamaGenerateResponse

                        if (line.message) {
                            completion += line.message.content
                            cb.onChange(completion)
                        }

                        if (line.done && line.total_duration) {
                            logDebug?.('Ollama', 'done streaming', line)
                        }
                    }
                }

                if (signal?.aborted) {
                    stopReason = CompletionStopReason.RequestAborted
                    break
                }

                if (done) {
                    stopReason = CompletionStopReason.RequestFinished
                    break
                }
            }

            cb.onComplete()

            log?.onComplete({
                completion,
                stopReason,
            })
        })
        .catch(error => {
            log?.onError(error)
            cb.onError(error)
        })
}
