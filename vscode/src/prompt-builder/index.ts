import {
    type ChatMessage,
    type ContextItem,
    type ContextMessage,
    type Message,
    type ModelContextWindow,
    TokenCounter,
    contextFiltersProvider,
    isCodyIgnoredFile,
    ps,
} from '@sourcegraph/cody-shared'
import type { ContextTokenUsageType } from '@sourcegraph/cody-shared/src/token'
import { sortContextItems } from '../chat/chat-view/agentContextSorting'
import { getUniqueContextItems, isUniqueContextItem } from './unique-context'
import { getContextItemTokenUsageType, renderContextItem } from './utils'

interface PromptBuilderContextResult {
    limitReached: boolean
    ignored: ContextItem[]
    added: ContextItem[]
}

/**
 * PromptBuilder constructs a full prompt given a charLimit constraint.
 * The final prompt is constructed by concatenating the following fields:
 * - prefixMessages
 * - the reverse of reverseMessages
 */
export class PromptBuilder {
    private prefixMessages: Message[] = []
    private reverseMessages: Message[] = []

    /**
     * A list of context items that are used to build context messages.
     */
    public contextItems: ContextItem[] = []

    private tokenCounter: TokenCounter

    constructor(contextWindow: ModelContextWindow) {
        this.tokenCounter = new TokenCounter(contextWindow)
    }

    public build(): Message[] {
        // Create context messages for each context item, where
        // assistant messages come first because the transcript is in reversed order.
        const assistantMessage = { speaker: 'assistant', text: ps`Ok.` } as Message
        for (const item of this.contextItems) {
            const contextMessage = renderContextItem(item)
            const messagePair = contextMessage && [assistantMessage, contextMessage]
            messagePair && this.reverseMessages.push(...messagePair)
        }

        return this.prefixMessages.concat([...this.reverseMessages].reverse())
    }

    public tryAddToPrefix(messages: Message[]): boolean {
        const withinLimit = this.tokenCounter.updateUsage('preamble', messages)
        if (withinLimit) {
            this.prefixMessages.push(...messages)
        }
        return withinLimit
    }

    /**
     * Tries to add messages in pairs from reversed transcript to the prompt builder.
     * Returns the index of the last message that was successfully added.
     *
     * Validates that the transcript alternates between human and assistant speakers.
     * Stops adding when the character limit would be exceeded.
     */
    public tryAddMessages(reverseTranscript: ChatMessage[]): number {
        // All Human message is expected to be followed by response from Assistant,
        // except for the Human message at the last index that Assistant hasn't responded yet.
        const lastHumanMsgIndex = reverseTranscript.findIndex(msg => msg.speaker === 'human')
        for (let i = lastHumanMsgIndex; i < reverseTranscript.length; i += 2) {
            const humanMsg = reverseTranscript[i]
            const assistantMsg = reverseTranscript[i - 1]
            if (humanMsg?.speaker !== 'human' || humanMsg?.speaker === assistantMsg?.speaker) {
                throw new Error(`Invalid transcript order: expected human message at index ${i}`)
            }
            const withinLimit = this.tokenCounter.updateUsage('input', [humanMsg, assistantMsg])
            if (!withinLimit) {
                return reverseTranscript.length - i + (assistantMsg ? 1 : 0)
            }
            if (assistantMsg) {
                this.reverseMessages.push(assistantMsg)
            }
            this.reverseMessages.push(humanMsg)
        }
        return 0
    }

    public async tryAddContext(
        type: ContextTokenUsageType | 'history',
        contextMessages: (ContextItem | ContextMessage)[]
    ): Promise<PromptBuilderContextResult> {
        // Turn-based context items that are used for UI display only.
        const result = {
            limitReached: false, // Indicates if the token budget was exceeded
            ignored: [] as ContextItem[], // The items that were ignored
            added: [] as ContextItem[], // The items that were added as context
        }

        // Create a new array to avoid modifying the original array,
        // then reverse it to process the newest context items first.
        const reversedContextItems = contextMessages.slice().reverse()

        // Required by agent tests to ensure the context items are sorted correctly.
        sortContextItems(reversedContextItems as ContextItem[])

        for (const item of reversedContextItems) {
            const newContextItem = contextItem(item)
            // Skip context items that are in the Cody ignore list
            if (isCodyIgnoredFile(newContextItem.uri)) {
                result.ignored.push(newContextItem)
                continue
            }
            if (await contextFiltersProvider.isUriIgnored(newContextItem.uri)) {
                result.ignored.push(newContextItem)
                continue
            }
            // Special-case remote context here. We can usually rely on the remote context to honor
            // any context filters but in case of client side overwrites, we want a file that is
            // ignored on a client to always be treated as ignored.
            if (
                newContextItem.type === 'file' &&
                (newContextItem.uri.scheme === 'https' || newContextItem.uri.scheme === 'http') &&
                newContextItem.repoName &&
                contextFiltersProvider.isRepoNameIgnored(newContextItem.repoName)
            ) {
                result.ignored.push(newContextItem)
                continue
            }

            const contextMessage = isContextItem(item) ? renderContextItem(item) : item
            if (!contextMessage) {
                continue
            }

            // Skip duplicated or invalid items before updating the token usage.
            if (!isUniqueContextItem(newContextItem, this.contextItems)) {
                continue
            }

            const messagePair = [{ speaker: 'assistant', text: ps`Ok.` } as Message, contextMessage]
            const tokenType = getContextItemTokenUsageType(newContextItem)
            const isWithinLimit = this.tokenCounter.updateUsage(tokenType, messagePair)

            // Don't update context items from the past (history items) unless undefined.
            if (type !== 'history' || newContextItem.isTooLarge === undefined) {
                newContextItem.isTooLarge = !isWithinLimit
            }

            // Skip item that would exceed token limit & add it to the ignored list.
            if (!isWithinLimit) {
                newContextItem.content = undefined
                result.ignored.push(newContextItem)
                result.limitReached = true
                continue
            }

            // Add the new valid context item to the context list.
            result.added.push(newContextItem) // for UI display.
            this.contextItems.push(newContextItem) // for building context messages.
            // Update context items for the next iteration, removes items that are no longer unique.
            // TODO (bee) update token usage to reflect the removed context items.
            this.contextItems = getUniqueContextItems(this.contextItems)
        }

        result.added = this.contextItems.filter(c => result.added.includes(c))
        return result
    }
}

function isContextItem(value: ContextItem | ContextMessage): value is ContextItem {
    return 'uri' in value && 'type' in value && !('speaker' in value)
}

function contextItem(value: ContextItem | ContextMessage): ContextItem {
    return isContextItem(value) ? value : value.file
}
