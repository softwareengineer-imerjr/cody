import { describe, expect, it } from 'vitest'
import { getCompletionsModelConfig } from './utils'
import { ModelProvider, ModelUsage } from '..'

describe('getCompletionsModelConfig', () => {
    it('returns correct config for Google model', () => {
        const modelID = 'google/test-model'

        ModelProvider.setProviders([new ModelProvider(modelID, [ModelUsage.Chat, ModelUsage.Edit], {
            input: 1,
            output: 1,
        }, {
            apiKey: 'test-key',
            apiEndpoint: 'https://test.endpoint.com',
        })])

        expect(getCompletionsModelConfig(modelID)).toEqual({
            model: 'test-model',
            key: 'test-key',
            endpoint: 'https://test.endpoint.com',
        })
    })

    it('returns correct config for Ollama model', () => {
        const modelID = 'ollama/test-model'

        ModelProvider.setProviders([new ModelProvider(modelID, [ModelUsage.Chat, ModelUsage.Edit], {
            input: 1,
            output: 1,
        }, {
            apiKey: 'test-key',
            apiEndpoint: 'https://test.endpoint.com',
        })])

        expect(getCompletionsModelConfig(modelID)).toEqual({
            model: 'test-model',
            key: 'test-key',
            endpoint: 'https://test.endpoint.com',
        })
    })

    it('returns correct config for Groq model', () => {
        const modelID = 'groq/test-model'

        ModelProvider.setProviders([new ModelProvider(modelID, [ModelUsage.Chat, ModelUsage.Edit], undefined, {
            apiKey: 'test-key',
            apiEndpoint: 'https://test.endpoint.com',
        })])

        const result = getCompletionsModelConfig(modelID)
        expect(result).toEqual({
            model: 'test-model',
            key: 'test-key',
            endpoint: 'https://test.endpoint.com',
        })
    })

    it('returns undefined for unsupported model', () => {
        const modelID = 'unsupported/test-model'
        expect(getCompletionsModelConfig(modelID)).toBeUndefined()
    })

    it('returns correct config when apiKey is missing for Ollama model', () => {
        const modelID = 'ollama/test-model'

        ModelProvider.setProviders([new ModelProvider(modelID, [ModelUsage.Chat, ModelUsage.Edit], undefined, {
            apiEndpoint: 'https://test.endpoint.com',
        })])

        const result = getCompletionsModelConfig(modelID)
        expect(result).toEqual({
            model: 'test-model',
            key: '',
            endpoint: 'https://test.endpoint.com',
        })
    })
})
