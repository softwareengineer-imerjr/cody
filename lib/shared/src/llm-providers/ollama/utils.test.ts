import { describe, expect, it } from 'vitest'
import { type Message, ps } from '../..'
import { getOllamaChatMessages } from './utils'

describe('getOllamaChatMessages', () => {
    it('should convert messages to Ollama chat messages', () => {
        const messages: Message[] = [
            { speaker: 'human', text: ps`Hello` },
            { speaker: 'assistant', text: ps`Hi there!` },
        ]
        const expected = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
        ]
        expect(getOllamaChatMessages(messages)).toEqual(expected)
    })

    it('should handle system as speaker', () => {
        const messages: Message[] = [
            { speaker: 'system', text: ps`I'm a system prompt` },
            { speaker: 'human', text: ps`Hello` },
            { speaker: 'assistant', text: ps`Hi there!` },
        ]
        const expected = [
            { role: 'system', content: "I'm a system prompt" },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
        ]
        expect(getOllamaChatMessages(messages)).toEqual(expected)
    })

    it('should handle empty text', () => {
        expect(getOllamaChatMessages([{ speaker: 'human', text: ps`` }])).toEqual([
            { role: 'user', content: '' },
        ])
    })

    it('should handle undefined text', () => {
        expect(getOllamaChatMessages([{ speaker: 'human', text: undefined }])).toEqual([
            { role: 'user', content: '' },
        ])
    })

    it('should handle missing text field', () => {
        expect(getOllamaChatMessages([{ speaker: 'human' }])).toEqual([{ role: 'user', content: '' }])
    })
})
