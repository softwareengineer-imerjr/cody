import { OLLAMA_DEFAULT_CONTEXT_WINDOW, type OllamaChatMessage } from '.'
import { type Message, ModelProvider, ModelUsage, OLLAMA_DEFAULT_URL, logError } from '../..'
import { CHAT_OUTPUT_TOKEN_BUDGET } from '../../token/constants'

/**
 * Fetches available Ollama models from the Ollama server.
 */
export async function fetchLocalOllamaModels(): Promise<ModelProvider[]> {
    // TODO (bee) watch file change to determine if a new model is added
    // to eliminate the needs of restarting the extension to get the new models
    return await fetch(new URL('/api/tags', OLLAMA_DEFAULT_URL).href)
        .then(response => response.json())
        .then(
            data =>
                data?.models?.map(
                    (m: { model: string }) =>
                        new ModelProvider(`ollama/${m.model}`, [ModelUsage.Chat, ModelUsage.Edit], {
                            input: OLLAMA_DEFAULT_CONTEXT_WINDOW,
                            output: CHAT_OUTPUT_TOKEN_BUDGET,
                        })
                ),
            error => {
                const fetchFailedErrors = ['Failed to fetch', 'fetch failed']
                const isFetchFailed = fetchFailedErrors.some(err => error.toString().includes(err))
                const serverErrorMsg = 'Please make sure the Ollama server is up & running.'
                logError('getLocalOllamaModels: failed ', isFetchFailed ? serverErrorMsg : error)
                return []
            }
        )
}

/**
 * Converts an array of `Message` objects to an array of `OllamaChatMessage` objects,
 * which are suitable for sending to the Ollama API.
 *
 * @param messages - An array of `Message` objects to be converted.
 * @returns An array of `OllamaChatMessage` objects.
 */
export function getOllamaChatMessages(messages: Message[]): OllamaChatMessage[] {
    return messages.map(msg => ({
        role: msg.speaker === 'human' ? 'user' : msg.speaker,
        content: msg.text?.toString() ?? '',
    }))
}
