import type { ContextItem, ContextItemWithContent } from '../codebase-context/messages'
import type { PromptString } from '../prompt/prompt-string'
import { GITHUB_CONTEXT_MENTION_PROVIDER } from './providers/githubMentions'
import { OPENCTX_CONTEXT_MENTION_PROVIDER } from './providers/openctxMentions'
import { PACKAGE_CONTEXT_MENTION_PROVIDER } from './providers/packageMentions'
import { SOURCEGRAPH_SEARCH_CONTEXT_MENTION_PROVIDER } from './providers/sourcegraphSearch'
import { URL_CONTEXT_MENTION_PROVIDER } from './providers/urlMentions'

/**
 * A unique identifier for a {@link ContextMentionProvider}.
 */
export type ContextMentionProviderID = string

/**
 * Providers that supply context that the user can @-mention in chat.
 *
 * This API is *experimental* and subject to rapid, unannounced change.
 *
 * In VS Code, use {@link getEnabledContextMentionProviders} instead of this.
 */
export const CONTEXT_MENTION_PROVIDERS: ContextMentionProvider[] = [
    URL_CONTEXT_MENTION_PROVIDER,
    PACKAGE_CONTEXT_MENTION_PROVIDER,
    SOURCEGRAPH_SEARCH_CONTEXT_MENTION_PROVIDER,
    OPENCTX_CONTEXT_MENTION_PROVIDER,
    GITHUB_CONTEXT_MENTION_PROVIDER,
]

/**
 * A provider that can supply context for users to @-mention in chat.
 *
 * This API is *experimental* and subject to rapid, unannounced change.
 */
export interface ContextMentionProvider<ID extends ContextMentionProviderID = ContextMentionProviderID> {
    id: ID

    /**
     * A short, human-readable display title for the provider, such as "Google Docs". If not given,
     * `id` is used instead.
     */
    title?: string

    /**
     * Prefix strings for the user input after the `@` that trigger this provider. For example, a
     * context mention provider with prefix `npm:` would be triggered when the user types `@npm:`.
     */
    triggerPrefixes: string[]

    /**
     * Human-readable display string for when the user is querying items from this provider.
     */
    queryLabel?: string

    /**
     * Get a list of possible context items to show (in a completion menu) when the user triggers
     * this provider while typing `@` in a chat message.
     *
     * {@link query} omits the `@` but includes the trigger prefix from {@link triggerPrefixes}.
     */
    queryContextItems(
        query: string,
        props: ContextItemProps,
        signal?: AbortSignal
    ): Promise<ContextItemFromProvider<ID>[]>

    /**
     * Resolve a context item to one or more items that have the {@link ContextItem.content} field
     * filled in. A provider is called to resolve only the context items that it returned in
     * {@link queryContextItems} and that the user explicitly added.
     */
    resolveContextItem?(
        item: ContextItemFromProvider<ID>,
        input: PromptString,
        signal?: AbortSignal
    ): Promise<ContextItemWithContent[]>
}

/**
 * Props required by context item providers to return possible context items.
 */
export interface ContextItemProps {
    gitRemotes: { hostname: string; owner: string; repoName: string; url: string }[]
}

export type ContextItemFromProvider<ID extends ContextMentionProviderID> = ContextItem & {
    /**
     * The ID of the {@link ContextMentionProvider} that supplied this context item.
     */
    provider: ID
}

/**
 * Metadata about a {@link ContextMentionProvider}.
 */
export interface ContextMentionProviderMetadata
    extends Pick<ContextMentionProvider, 'id' | 'title' | 'queryLabel' | 'triggerPrefixes'> {}

export const FILE_CONTEXT_MENTION_PROVIDER: ContextMentionProviderMetadata = {
    id: 'files',
    title: 'Files',
    triggerPrefixes: [],
}

export const SYMBOL_CONTEXT_MENTION_PROVIDER: ContextMentionProviderMetadata = {
    id: 'symbols',
    title: 'Symbols',
    triggerPrefixes: ['#'],
}

/** Metadata for all registered {@link ContextMentionProvider}s. */
export function allMentionProvidersMetadata(experimental = false): ContextMentionProviderMetadata[] {
    return [
        FILE_CONTEXT_MENTION_PROVIDER,
        SYMBOL_CONTEXT_MENTION_PROVIDER,
        // TODO!(sqs): exclude openctx because it is a meta-provider
        ...(experimental ? CONTEXT_MENTION_PROVIDERS.filter(({ id }) => id !== 'openctx') : []),
    ]
}
