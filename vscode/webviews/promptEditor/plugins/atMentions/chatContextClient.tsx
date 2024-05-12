import {
    type ContextItem,
    type ContextMentionProviderMetadata,
    type MentionQuery,
    parseMentionQuery,
} from '@sourcegraph/cody-shared'
import { LRUCache } from 'lru-cache'
import { type FunctionComponent, createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useContextProviders } from '../../../mentions/providers'
import { getVSCodeAPI } from '../../../utils/VSCodeApi'

export interface ChatContextClient {
    getChatContextItems(query: MentionQuery): Promise<ContextItem[]>
}

const ChatContextClientContext: React.Context<ChatContextClient> = createContext({
    getChatContextItems(query: MentionQuery): Promise<ContextItem[]> {
        // Adapt the VS Code webview messaging API to be RPC-like for ease of use by our callers.
        return new Promise<ContextItem[]>((resolve, reject) => {
            const vscodeApi = getVSCodeAPI()
            vscodeApi.postMessage({ command: 'queryContextItems', query })

            const RESPONSE_MESSAGE_TYPE = 'userContextFiles' as const

            // Clean up after a while to avoid resource exhaustion in case there is a bug
            // somewhere.
            const MAX_WAIT_SECONDS = 15
            const rejectTimeout = setTimeout(() => {
                reject(new Error(`no ${RESPONSE_MESSAGE_TYPE} response after ${MAX_WAIT_SECONDS}s`))
                dispose()
            }, MAX_WAIT_SECONDS * 1000)

            // Wait for the response. We assume the first message of the right type is the response to
            // our call.
            const dispose = vscodeApi.onMessage(message => {
                if (message.type === RESPONSE_MESSAGE_TYPE) {
                    resolve(message.userContextFiles ?? [])
                    dispose()
                    clearTimeout(rejectTimeout)
                }
            })
        })
    },
})

export const WithChatContextClient: FunctionComponent<
    React.PropsWithChildren<{ value: ChatContextClient }>
> = ({ value, children }) => (
    <ChatContextClientContext.Provider value={value}>{children}</ChatContextClientContext.Provider>
)

/** Hook to get the chat context items for the given query. */
export function useChatContextItems(
    query: string | null,
    provider: ContextMentionProviderMetadata | null
): ContextItem[] | undefined {
    const unmemoizedClient = useContext(ChatContextClientContext)
    const chatContextClient = useMemo(
        () => memoizeChatContextClient(unmemoizedClient),
        [unmemoizedClient]
    )
    const [results, setResults] = useState<ContextItem[]>()
    const allProviders = useContextProviders()

    // biome-ignore lint/correctness/useExhaustiveDependencies: we only want to run this when query changes.
    useEffect(() => {
        // An empty query is a valid query that we use to get open tabs context,
        // while a null query means this is not an at-mention query.
        if (query === null) {
            setResults(undefined)
            return
        }

        // If user has typed an incomplete range, fetch new chat context items only if there are no
        // results.
        const mentionQuery = parseMentionQuery(query, provider, allProviders)
        if (results?.length && mentionQuery.maybeHasRangeSuffix && !mentionQuery.range) {
            return
        }

        // Invalidate results.
        setResults(undefined)

        // Track if the query changed since this request was sent (which would make our results
        // no longer valid).
        let invalidated = false

        if (chatContextClient) {
            chatContextClient
                .getChatContextItems(mentionQuery)
                .then(mentions => {
                    if (invalidated) {
                        return
                    }
                    setResults(mentions)
                })
                .catch(error => {
                    setResults(undefined)
                    console.error(error)
                })
        }

        return () => {
            invalidated = true
        }
    }, [query, allProviders])
    return results
}

function memoizeChatContextClient(client: ChatContextClient): ChatContextClient {
    const cache = new LRUCache<string, ContextItem[]>({ max: 10 })
    return {
        async getChatContextItems(query: MentionQuery): Promise<ContextItem[]> {
            const key = JSON.stringify(query)
            const cached = cache.get(key)
            if (cached !== undefined) {
                return cached
            }

            const result = await client.getChatContextItems(query)
            cache.set(key, result)
            return result
        },
    }
}
