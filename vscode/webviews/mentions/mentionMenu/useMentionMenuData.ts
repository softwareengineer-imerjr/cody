import {
    type ContextItem,
    type ContextMentionProviderMetadata,
    allMentionProvidersMetadata,
} from '@sourcegraph/cody-shared'
import { useMemo, useState } from 'react'
import { useChatContextItems } from '../../promptEditor/plugins/atMentions/chatContextClient'
import { prepareContextItemForMentionMenu } from '../../promptEditor/plugins/atMentions/util'

export interface MentionMenuParams {
    query: string // TODO!(sqs): is this needed?
    parentItem: ContextMentionProviderMetadata | null
}

export function useMentionMenuParams(): {
    params: MentionMenuParams
    updateQuery: (query: string) => void
    updateMentionMenuParams: MentionMenuContextValue['updateMentionMenuParams']
} {
    const [params, setParams] = useState<MentionMenuParams>({ query: '', parentItem: null })

    // Try to infer from query and trigger characters.
    const parentItem =
        params.parentItem ??
        allMentionProvidersMetadata().find(p =>
            p.triggerPrefixes.some(prefix => params.query.startsWith(prefix))
        ) ??
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
    appendToEditorQuery: (suffix: string) => void
}

export function useMentionMenuData(
    params: MentionMenuParams,
    { remainingTokenBudget, limit }: { remainingTokenBudget: number; limit: number }
): MentionMenuData {
    const results = useChatContextItems(params.query)
    const queryLower = params.query.toLowerCase()
    return useMemo(
        () => ({
            providers: params.parentItem
                ? []
                : allMentionProvidersMetadata().filter(
                      provider =>
                          provider.id.toLowerCase().includes(queryLower) ||
                          provider.title?.toLowerCase().includes(queryLower)
                  ),
            items:
                results
                    ?.slice(0, limit)
                    .map(item => prepareContextItemForMentionMenu(item, remainingTokenBudget)) ?? [],
        }),
        [params.parentItem, queryLower, results, limit, remainingTokenBudget]
    )
}
