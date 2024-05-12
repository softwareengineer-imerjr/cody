import type { ContextItem, ContextMentionProviderMetadata } from '@sourcegraph/cody-shared'
import { useMemo, useState } from 'react'
import { useChatContextItems } from '../../promptEditor/plugins/atMentions/chatContextClient'
import { prepareContextItemForMentionMenu } from '../../promptEditor/plugins/atMentions/util'
import { useContextProviders } from '../providers'

export interface MentionMenuParams {
    query: string
    parentItem: ContextMentionProviderMetadata | null
}

export function useMentionMenuParams(): {
    params: MentionMenuParams
    updateQuery: (query: string) => void
    updateMentionMenuParams: MentionMenuContextValue['updateMentionMenuParams']
} {
    const [params, setParams] = useState<MentionMenuParams>({ query: '', parentItem: null })

    const providers = useContextProviders()

    // Try to infer from query and trigger characters.
    const parentItem =
        params.parentItem ??
        providers.find(p => p.triggerPrefixes.some(prefix => params.query.startsWith(prefix))) ??
        null

    return useMemo(
        () => ({
            params: {
                query: params.query,
                parentItem,
            },
            updateQuery: query => setParams(prev => ({ ...prev, query: query ?? '' })),
            updateMentionMenuParams: update => setParams(prev => ({ ...prev, ...update })),
        }),
        [params.query, parentItem]
    )
}

export interface MentionMenuData {
    providers: ContextMentionProviderMetadata[]
    items: ContextItem[] | undefined
}

export interface MentionMenuContextValue {
    updateMentionMenuParams: (update: Partial<Pick<MentionMenuParams, 'parentItem'>>) => void
    setEditorQuery: (query: string) => void
}

export function useMentionMenuData(
    params: MentionMenuParams,
    { remainingTokenBudget, limit }: { remainingTokenBudget: number; limit: number }
): MentionMenuData {
    const results = useChatContextItems(params.query, params.parentItem)
    const queryLower = params.query.toLowerCase()

    const providers = useContextProviders()

    return useMemo(
        () => ({
            providers: params.parentItem
                ? []
                : providers.filter(
                      provider =>
                          provider.id.toLowerCase().includes(queryLower) ||
                          provider.title?.toLowerCase().includes(queryLower)
                  ),
            items: results
                ?.slice(0, limit)
                .map(item => prepareContextItemForMentionMenu(item, remainingTokenBudget)),
        }),
        [params.parentItem, providers, queryLower, results, limit, remainingTokenBudget]
    )
}
