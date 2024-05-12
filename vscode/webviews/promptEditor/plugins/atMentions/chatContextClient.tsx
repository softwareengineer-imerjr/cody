import {
    type ContextItem,
    type ContextMentionProviderMetadata,
    allMentionProvidersMetadata,
    parseMentionQuery,
} from '@sourcegraph/cody-shared'
import { type FunctionComponent, createContext, useContext, useEffect, useState } from 'react'
import { getVSCodeAPI } from '../../../utils/VSCodeApi'

export interface ChatContextClient {
    getChatContextItems(query: string): Promise<ContextItem[]>
}

const ChatContextClientContext: React.Context<ChatContextClient> = createContext({
    getChatContextItems(query: string): Promise<ContextItem[]> {
        // Adapt the VS Code webview messaging API to be RPC-like for ease of use by our callers.
        return new Promise<ContextItem[]>((resolve, reject) => {
            const vscodeApi = getVSCodeAPI()
            vscodeApi.postMessage({ command: 'getUserContext', query })

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

function useChatContextClient(): ChatContextClient {
    return useContext(ChatContextClientContext)
}

/** Hook to get the chat context items for the given query. */
export function useChatContextItems(query: string | null): ContextItem[] | undefined {
    const chatContextClient = useChatContextClient()
    const [results, setResults] = useState<ContextItem[]>()
    const [lastProvider, setLastProvider] = useState<ContextMentionProviderMetadata['id'] | null>(null)
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
        const { provider, maybeHasRangeSuffix, range } = parseMentionQuery(
            query,
            allMentionProvidersMetadata()
        )
        if (results?.length && maybeHasRangeSuffix && !range) {
            return
        }

        // The results are stale if the provider changed, so clear them.
        if (provider !== lastProvider) {
            setResults(undefined)
        }
        setLastProvider(provider)

        // Track if the query changed since this request was sent (which would make our results
        // no longer valid).
        let invalidated = false

        if (chatContextClient) {
            chatContextClient
                .getChatContextItems(query)
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
    }, [query])
    return results
}
