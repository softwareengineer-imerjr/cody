import {
    ArchiveBoxIcon,
    ArrowRightIcon,
    CircleStackIcon,
    CodeBracketSquareIcon,
    DocumentIcon,
    LinkIcon,
} from '@heroicons/react/16/solid'
import {
    type ContextItem,
    type ContextMentionProviderMetadata,
    type MentionQuery,
    displayLineRange,
    displayPath,
    displayPathBasename,
    displayPathDirname,
} from '@sourcegraph/cody-shared'
import { clsx } from 'clsx'
import type { FunctionComponent } from 'react'
import {
    IGNORED_FILE_WARNING_LABEL,
    LARGE_FILE_WARNING_LABEL,
} from '../../../src/chat/context/constants'
import { SourcegraphLogo } from '../../icons/SourcegraphLogo'
import type { MentionTypeaheadOption } from '../../promptEditor/plugins/atMentions/atMentions'
import styles from './MentionMenuItem.module.css'

function getDescription(item: MentionTypeaheadOption['item'], query: MentionQuery): string {
    const range = query.range ?? item.range
    switch (item.type) {
        case 'github_issue':
        case 'github_pull_request':
            return `${item.owner}/${item.repoName}`
        case 'file': {
            const dir = decodeURIComponent(displayPathDirname(item.uri))
            return `${range ? `Lines ${displayLineRange(range)} · ` : ''}${dir === '.' ? '' : dir}`
        }
        default:
            return `${displayPath(item.uri)}:${range ? displayLineRange(range) : ''}`
    }
}

export const MentionMenuContextItemContent: FunctionComponent<{
    query: MentionQuery
    item: ContextItem
}> = ({ query, item }) => {
    const isFileType = item.type === 'file'
    const isSymbol = item.type === 'symbol'
    const icon = isSymbol ? (item.kind === 'class' ? 'symbol-structure' : 'symbol-method') : null
    const title = item.title ?? (isSymbol ? item.symbolName : displayPathBasename(item.uri))
    const description = getDescription(item, query)

    const isIgnored = isFileType && item.isIgnored
    const isLargeFile = isFileType && item.isTooLarge
    let warning: string
    if (isIgnored) {
        warning = IGNORED_FILE_WARNING_LABEL
    } else if (isLargeFile && !item.range && query.maybeHasRangeSuffix) {
        warning = LARGE_FILE_WARNING_LABEL
    } else {
        warning = ''
    }

    return (
        <>
            <div className={styles.row}>
                {item.type === 'symbol' && icon && (
                    <i className={`codicon codicon-${icon}`} title={item.kind} />
                )}
                <span className={clsx(styles.title, warning && styles.titleWithWarning)}>{title}</span>
                {description && <span className={styles.description}>{description}</span>}
            </div>
            {warning && <span className={styles.warning}>{warning}</span>}
        </>
    )
}

export const MentionMenuProviderItemContent: FunctionComponent<{
    provider: ContextMentionProviderMetadata
}> = ({ provider }) => {
    const Icon = iconForProvider[provider.id] ?? CircleStackIcon
    return (
        <>
            <Icon width={16} height={16} />
            &nbsp;&nbsp;
            {provider.title ?? provider.id}
            &nbsp;&nbsp;
            <ArrowRightIcon width={16} height={16} style={{ opacity: '0.3' }} />
        </>
    )
}

const iconForProvider: Record<string, React.ComponentType> = {
    files: DocumentIcon,
    symbols: CodeBracketSquareIcon,
    'src-search': SourcegraphLogo,
    url: LinkIcon,
    package: ArchiveBoxIcon,
    github: () => <i className="codicon codicon-logo-github" />,
}
