import { FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, type MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { $createTextNode, $insertNodes, COMMAND_PRIORITY_NORMAL, type TextNode } from 'lexical'
import { useCallback, useEffect, useState } from 'react'
import styles from './atMentions.module.css'

import {
    type ContextItem,
    FAST_CHAT_INPUT_TOKEN_BUDGET,
    scanForMentionTriggerInUserTextInput,
} from '@sourcegraph/cody-shared'
import { clsx } from 'clsx'
import { useCurrentChatModel } from '../../../chat/models/chatModelContext'
import { MentionMenu } from '../../../mentions/mentionMenu/MentionMenu'
import {
    useMentionMenuData,
    useMentionMenuParams,
} from '../../../mentions/mentionMenu/useMentionMenuData'
import { toSerializedPromptEditorValue } from '../../PromptEditor'
import {
    $createContextItemMentionNode,
    $createContextItemTextNode,
    ContextItemMentionNode,
} from '../../nodes/ContextItemMentionNode'
import { contextItemID } from './util'

const SUGGESTION_LIST_LENGTH_LIMIT = 20

export interface MentionMenuOption extends MenuOption {
    item: ContextItem
}

export function createMentionMenuOption(item: ContextItem): MentionMenuOption {
    return {
        item,
        key: contextItemID(item),

        // This is not used by LexicalMenu or LexicalTypeaheadMenuPlugin, so we can just make it a
        // noop.
        setRefElement: () => {},
    }
}

export default function MentionsPlugin(): JSX.Element | null {
    const [editor] = useLexicalComposerContext()

    /**
     * Total sum of tokens represented by all of the @-mentioned items.
     */
    const [tokenAdded, setTokenAdded] = useState<number>(0)

    const { x, y, refs, strategy, update } = useFloating({
        placement: 'top-start',
        middleware: [offset(6), flip(), shift()],
    })

    const model = useCurrentChatModel()
    const limit =
        model?.contextWindow?.context?.user ||
        model?.contextWindow?.input ||
        FAST_CHAT_INPUT_TOKEN_BUDGET
    const remainingTokenBudget = limit - tokenAdded

    const { params, updateQuery, updateMentionMenuParams } = useMentionMenuParams()

    const data = useMentionMenuData(params, {
        remainingTokenBudget,
        limit: SUGGESTION_LIST_LENGTH_LIMIT,
    })

    const appendToEditorQuery = useCallback(
        (suffix: string): void => {
            if (editor) {
                editor.update(() => {
                    $insertNodes([$createTextNode(suffix)])
                })
                setTokenAdded(prev => prev + suffix.length)
            }
        },
        [editor]
    )

    useEffect(() => {
        // Listen for changes to ContextItemMentionNode to update the token count.
        // This updates the token count when a mention is added or removed.
        const unregister = editor.registerMutationListener(ContextItemMentionNode, () => {
            const items = toSerializedPromptEditorValue(editor)?.contextItems
            if (!items?.length) {
                setTokenAdded(0)
                return
            }
            setTokenAdded(items?.reduce((acc, item) => acc + (item.size ?? 0), 0) ?? 0)
        })
        return unregister
    }, [editor])

    const onSelectOption = useCallback(
        (selectedOption: MentionMenuOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
            editor.update(() => {
                const currentInputText = nodeToReplace?.__text
                if (!currentInputText) {
                    return
                }

                const selectedItem = selectedOption.item
                const isLargeFile = selectedItem.isTooLarge
                // When selecting a large file without range, add the selected option as text node with : at the end.
                // This allows users to autocomplete the file path, and provide them with the options to add range.
                if (isLargeFile && !selectedItem.range) {
                    const textNode = $createContextItemTextNode(selectedItem)
                    nodeToReplace.replace(textNode)
                    const colonNode = $createTextNode(':')
                    textNode.insertAfter(colonNode)
                    colonNode.select()
                } else {
                    const mentionNode = $createContextItemMentionNode(selectedItem)
                    nodeToReplace.replace(mentionNode)
                    const spaceNode = $createTextNode(' ')
                    mentionNode.insertAfter(spaceNode)
                    spaceNode.select()
                }
                closeMenu()
            })
        },
        [editor]
    )

    return (
        <LexicalTypeaheadMenuPlugin<MentionMenuOption>
            onQueryChange={query => updateQuery(query ?? '')}
            onSelectOption={onSelectOption}
            onClose={() => updateMentionMenuParams({ parentItem: null })}
            triggerFn={scanForMentionTriggerInUserTextInput}
            options={DUMMY_OPTIONS}
            anchorClassName={styles.resetAnchor}
            commandPriority={
                COMMAND_PRIORITY_NORMAL /* so Enter keypress selects option and doesn't submit form */
            }
            onOpen={menuResolution => {
                refs.setPositionReference({
                    getBoundingClientRect: menuResolution.getRect,
                })
            }}
            menuRenderFn={(anchorElementRef, { selectOptionAndCleanUp }) =>
                anchorElementRef.current && (
                    <FloatingPortal root={anchorElementRef.current}>
                        <div
                            ref={refs.setFloating}
                            style={{
                                position: strategy,
                                top: y ?? 0,
                                left: x ?? 0,
                                width: 'max-content',
                            }}
                            className={clsx(styles.popover)}
                        >
                            <MentionMenu
                                params={params}
                                updateMentionMenuParams={updateMentionMenuParams}
                                appendToEditorQuery={appendToEditorQuery}
                                data={data}
                                selectOptionAndCleanUp={selectOptionAndCleanUp}
                            />
                        </div>
                    </FloatingPortal>
                )
            }
        />
    )
}

/**
 * Dummy options for LexicalTypeaheadMenuPlugin. See {@link MentionMenu} for an explanation of why
 * we handle options ourselves.
 */
const DUMMY_OPTIONS: MentionMenuOption[] = []
