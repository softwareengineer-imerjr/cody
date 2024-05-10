import {
    type ContextItem,
    type EditModel,
    type EventSource,
    ModelProvider,
    PromptString,
    displayLineRange,
    parseMentionQuery,
    scanForMentionTriggerInUserTextInput,
} from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'

import { telemetryRecorder } from '@sourcegraph/cody-shared'
import { getEnabledContextMentionProviders } from '../../chat/context/chatContext'
import {
    FILE_HELP_LABEL,
    GENERAL_HELP_LABEL,
    LARGE_FILE_WARNING_LABEL,
    NO_FILE_MATCHES_LABEL,
    NO_PACKAGE_MATCHES_LABEL,
    NO_SYMBOL_MATCHES_LABEL,
    PACKAGE_HELP_LABEL,
    SYMBOL_HELP_LABEL,
} from '../../chat/context/constants'
import { ACCOUNT_UPGRADE_URL } from '../../chat/protocol'
import { executeDocCommand, executeTestEditCommand } from '../../commands/execute'
import { getEditor } from '../../editor/active-editor'
import { editModel } from '../../models'
import { type TextChange, updateRangeMultipleChanges } from '../../non-stop/tracked-range'
import type { AuthProvider } from '../../services/AuthProvider'
// biome-ignore lint/nursery/noRestrictedImports: Deprecated v1 telemetry used temporarily to support existing analytics.
import { telemetryService } from '../../services/telemetry'
import type { EditIntent } from '../types'
import { isGenerateIntent } from '../utils/edit-intent'
import { getEditModelsForUser } from '../utils/edit-models'
import { CURSOR_RANGE_ITEM, EXPANDED_RANGE_ITEM, SELECTION_RANGE_ITEM } from './get-items/constants'
import { DOCUMENT_ITEM, MODEL_ITEM, RANGE_ITEM, TEST_ITEM, getEditInputItems } from './get-items/edit'
import { getModelInputItems, getModelOptionItems } from './get-items/model'
import { getRangeInputItems } from './get-items/range'
import { RANGE_SYMBOLS_ITEM, getRangeSymbolInputItems } from './get-items/range-symbols'
import type { EditModelItem, EditRangeItem } from './get-items/types'
import { getMatchingContext } from './get-matching-context'
import { createQuickPick } from './quick-pick'
import { fetchDocumentSymbols, getLabelForContextItem, removeAfterLastAt } from './utils'

interface QuickPickInput {
    /** The user provided instruction */
    instruction: PromptString
    /** Any user provided context, from @ or @# */
    userContextFiles: ContextItem[]
    /** The LLM that the user has selected */
    model: EditModel
    /** The range that the user has selected */
    range: vscode.Range
    /**
     * The derived intent from the users instructions
     * This will effectively only change if the user switching from a "selection" to a "cursor"
     * position, or vice-versa.
     */
    intent: EditIntent
}

export interface EditInputInitialValues {
    initialRange: vscode.Range
    initialExpandedRange?: vscode.Range
    initialModel: EditModel
    initialIntent: EditIntent
    initialInputValue?: PromptString
    initialSelectedContextItems?: ContextItem[]
}

const PREVIEW_RANGE_DECORATION = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.wordHighlightTextBackground'),
    borderColor: new vscode.ThemeColor('editor.wordHighlightTextBorder'),
    borderWidth: '3px',
    borderStyle: 'solid',
})

export const getInput = async (
    document: vscode.TextDocument,
    authProvider: AuthProvider,
    initialValues: EditInputInitialValues,
    source: EventSource
): Promise<QuickPickInput | null> => {
    const editor = getEditor().active
    if (!editor) {
        return null
    }

    telemetryService.log('CodyVSCodeExtension:menu:edit:clicked', { source }, { hasV2Event: true })
    telemetryRecorder.recordEvent('cody.menu.edit', 'clicked', { privateMetadata: { source } })

    const initialCursorPosition = editor.selection.active
    let activeRange = initialValues.initialExpandedRange || initialValues.initialRange
    let activeRangeItem =
        initialValues.initialIntent === 'add'
            ? CURSOR_RANGE_ITEM
            : initialValues.initialExpandedRange
              ? EXPANDED_RANGE_ITEM
              : SELECTION_RANGE_ITEM

    const authStatus = authProvider.getAuthStatus()
    const isCodyPro = !authStatus.userCanUpgrade
    const modelOptions = getEditModelsForUser(authStatus)
    const modelItems = getModelOptionItems(modelOptions, isCodyPro)
    const showModelSelector = modelOptions.length > 1 && authStatus.isDotCom

    let activeModel = initialValues.initialModel
    let activeModelItem = modelItems.find(item => item.model === initialValues.initialModel)

    const getContextWindowOnModelChange = (model: EditModel) => {
        const latestContextWindow = ModelProvider.getContextWindowByID(model)
        return latestContextWindow.input + (latestContextWindow.context?.user ?? 0)
    }
    let activeModelContextWindow = getContextWindowOnModelChange(activeModel)

    // ContextItems to store possible user-provided context
    const contextItems = new Map<string, ContextItem>()
    const selectedContextItems = new Map<string, ContextItem>()

    // Initialize the selectedContextItems with any previous items
    // This is primarily for edit retries, where a user may want to reuse their context
    for (const file of initialValues.initialSelectedContextItems ?? []) {
        selectedContextItems.set(getLabelForContextItem(file), file)
    }

    /**
     * Set the title of the quick pick to include the file and range
     * Update the title as the range changes
     */
    const relativeFilePath = vscode.workspace.asRelativePath(document.uri.fsPath)
    let activeTitle: string
    const updateActiveTitle = (newRange: vscode.Range) => {
        activeTitle = `Edit ${relativeFilePath}:${displayLineRange(newRange)} with Cody`
    }
    updateActiveTitle(activeRange)

    /**
     * Listens for text document changes and updates the range when changes occur.
     * This allows the range to stay in sync if the user continues editing after
     * requesting the refactoring.
     */
    const registerRangeListener = () => {
        return vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document !== document) {
                return
            }

            const changes = new Array<TextChange>(...event.contentChanges)
            const updatedRange = updateRangeMultipleChanges(activeRange, changes)
            if (!updatedRange.isEqual(activeRange)) {
                activeRange = updatedRange
                updateActiveTitle(activeRange)
            }
        })
    }
    let textDocumentListener = registerRangeListener()
    const updateActiveRange = (range: vscode.Range) => {
        // Clear any set decorations
        editor.setDecorations(PREVIEW_RANGE_DECORATION, [])

        // Pause listening to range changes to avoid a possible race condition
        textDocumentListener.dispose()

        editor.selection = new vscode.Selection(range.start, range.end)
        activeRange = range

        // Resume listening to range changes
        textDocumentListener = registerRangeListener()
        // Update the title to reflect the new range
        updateActiveTitle(activeRange)
    }
    const previewActiveRange = (range: vscode.Range) => {
        editor.setDecorations(PREVIEW_RANGE_DECORATION, [range])
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    }
    previewActiveRange(activeRange)

    // Start fetching symbols early, so they can be used immediately if an option is selected
    const symbolsPromise = fetchDocumentSymbols(document)

    return new Promise(resolve => {
        const modelInput = createQuickPick({
            title: activeTitle,
            placeHolder: 'Select a model',
            getItems: () => getModelInputItems(modelOptions, activeModel, isCodyPro),
            buttons: [vscode.QuickInputButtons.Back],
            onDidHide: () => editor.setDecorations(PREVIEW_RANGE_DECORATION, []),
            onDidTriggerButton: () => editInput.render(editInput.input.value),
            onDidAccept: async item => {
                const acceptedItem = item as EditModelItem
                if (!acceptedItem) {
                    return
                }
                telemetryRecorder.recordEvent('cody.fixup.input.model', 'selected')

                if (acceptedItem.codyProOnly && !isCodyPro) {
                    const option = await vscode.window.showInformationMessage(
                        'Upgrade to Cody Pro',
                        {
                            modal: true,
                            detail: `Upgrade to Cody Pro to use ${acceptedItem.modelTitle} for Edit`,
                        },
                        'Upgrade',
                        'See Plans'
                    )

                    // Both options go to the same URL
                    if (option) {
                        void vscode.env.openExternal(vscode.Uri.parse(ACCOUNT_UPGRADE_URL.toString()))
                    }

                    return
                }

                editModel.set(acceptedItem.model)
                activeModelItem = acceptedItem
                activeModel = acceptedItem.model
                activeModelContextWindow = getContextWindowOnModelChange(acceptedItem.model)

                editInput.render(editInput.input.value)
            },
        })

        const rangeSymbolsInput = createQuickPick({
            title: activeTitle,
            placeHolder: 'Select a symbol',
            getItems: () =>
                getRangeSymbolInputItems({ ...initialValues, initialCursorPosition }, symbolsPromise),
            buttons: [vscode.QuickInputButtons.Back],
            onDidTriggerButton: () => editInput.render(editInput.input.value),
            onDidHide: () => editor.setDecorations(PREVIEW_RANGE_DECORATION, []),
            onDidChangeActive: async items => {
                const item = items[0] as EditRangeItem
                if (item) {
                    const range = item.range instanceof vscode.Range ? item.range : await item.range()
                    previewActiveRange(range)
                }
            },
            onDidAccept: async item => {
                const acceptedItem = item as EditRangeItem
                if (!acceptedItem) {
                    return
                }
                telemetryRecorder.recordEvent('cody.fixup.input.rangeSymbol', 'selected')

                activeRangeItem = acceptedItem
                const range =
                    acceptedItem.range instanceof vscode.Range
                        ? acceptedItem.range
                        : await acceptedItem.range()

                updateActiveRange(range)
                editInput.render(editInput.input.value)
            },
        })

        const rangeInput = createQuickPick({
            title: activeTitle,
            placeHolder: 'Select a range to edit',
            getItems: () =>
                getRangeInputItems(
                    document,
                    { ...initialValues, initialCursorPosition },
                    activeRange,
                    symbolsPromise
                ),
            buttons: [vscode.QuickInputButtons.Back],
            onDidTriggerButton: () => editInput.render(editInput.input.value),
            onDidHide: () => editor.setDecorations(PREVIEW_RANGE_DECORATION, []),
            onDidChangeActive: async items => {
                const item = items[0] as EditRangeItem
                if (item) {
                    const range = item.range instanceof vscode.Range ? item.range : await item.range()
                    previewActiveRange(range)
                }
            },
            onDidAccept: async item => {
                const acceptedItem = item as EditRangeItem
                if (!acceptedItem) {
                    return
                }

                if (acceptedItem.label === RANGE_SYMBOLS_ITEM.label) {
                    rangeSymbolsInput.render('')
                    return
                }

                telemetryRecorder.recordEvent('cody.fixup.input.range', 'selected')

                activeRangeItem = acceptedItem
                const range =
                    acceptedItem.range instanceof vscode.Range
                        ? acceptedItem.range
                        : await acceptedItem.range()

                updateActiveRange(range)
                editInput.render(editInput.input.value)
            },
        })

        const editInput = createQuickPick({
            title: activeTitle,
            placeHolder: 'Enter edit instructions (type @ to include code, ⏎ to submit)',
            getItems: () =>
                getEditInputItems(
                    editInput.input.value,
                    activeRangeItem,
                    activeModelItem,
                    showModelSelector
                ),
            onDidHide: () => editor.setDecorations(PREVIEW_RANGE_DECORATION, []),
            ...(source === 'menu'
                ? {
                      buttons: [vscode.QuickInputButtons.Back],
                      onDidTriggerButton: target => {
                          if (target === vscode.QuickInputButtons.Back) {
                              void vscode.commands.executeCommand('cody.menu.commands')
                              editInput.input.hide()
                          }
                      },
                  }
                : {}),
            onDidChangeValue: async value => {
                const input = editInput.input
                if (
                    initialValues.initialInputValue !== undefined &&
                    value.toString() === initialValues.initialInputValue.toString()
                ) {
                    // Noop, this event is fired when an initial value is set
                    return
                }

                const mentionTrigger = scanForMentionTriggerInUserTextInput(value)
                const mentionQuery = mentionTrigger
                    ? parseMentionQuery(
                          mentionTrigger.matchingString,
                          getEnabledContextMentionProviders()
                      )
                    : undefined

                if (!mentionQuery) {
                    // Nothing to match, re-render existing items
                    input.items = getEditInputItems(
                        input.value,
                        activeRangeItem,
                        activeModelItem,
                        showModelSelector
                    ).items
                    return
                }

                const matchingContext = await getMatchingContext(mentionQuery)
                if (matchingContext.length === 0) {
                    // Attempted to match but found nothing
                    input.items = [
                        {
                            alwaysShow: true,
                            label:
                                mentionQuery.provider === 'package'
                                    ? mentionQuery.text.length < 3
                                        ? PACKAGE_HELP_LABEL
                                        : NO_PACKAGE_MATCHES_LABEL
                                    : mentionQuery.provider === 'symbol'
                                      ? mentionQuery.text.length === 0
                                          ? SYMBOL_HELP_LABEL
                                          : NO_SYMBOL_MATCHES_LABEL
                                      : mentionQuery.text.length === 0
                                        ? FILE_HELP_LABEL
                                        : NO_FILE_MATCHES_LABEL,
                        },
                    ]
                    return
                }

                // Update stored context items so we can retrieve them later
                for (const { key, item } of matchingContext) {
                    contextItems.set(key, item)
                }

                /**
                 * Checks if the total size of the selected context items exceeds the context budget.
                 */
                const isOverLimit = (size?: number): boolean => {
                    const currentInput = input.value
                    let used = currentInput.length
                    for (const [k, v] of selectedContextItems) {
                        if (currentInput.includes(`@${k}`)) {
                            used += v.size ?? 0
                        } else {
                            selectedContextItems.delete(k)
                        }
                    }
                    const totalBudget = activeModelContextWindow
                    return size ? totalBudget - used < size : false
                }

                // Add human-friendly labels to the quick pick so the user can select them
                input.items = [
                    ...matchingContext.map(({ key, shortLabel, item }) => ({
                        alwaysShow: true,
                        label: shortLabel || key,
                        description: shortLabel ? key : undefined,
                        detail: isOverLimit(item.size) ? LARGE_FILE_WARNING_LABEL : undefined,
                    })),
                    {
                        kind: vscode.QuickPickItemKind.Separator,
                        label: 'help',
                    },
                    {
                        alwaysShow: true,
                        label:
                            mentionQuery?.provider === 'package'
                                ? PACKAGE_HELP_LABEL
                                : mentionQuery?.provider === 'symbol'
                                  ? SYMBOL_HELP_LABEL
                                  : mentionQuery?.provider === 'file'
                                    ? FILE_HELP_LABEL
                                    : GENERAL_HELP_LABEL,
                    },
                ]
            },
            onDidAccept: () => {
                const input = editInput.input
                const instruction = PromptString.unsafe_fromUserQuery(input.value.trim())

                // Selected item flow, update the input and store it for submission
                const selectedItem = input.selectedItems[0]
                switch (selectedItem.label) {
                    case MODEL_ITEM.label:
                        modelInput.render('')
                        return
                    case RANGE_ITEM.label:
                        rangeInput.render('')
                        return
                    case DOCUMENT_ITEM.label:
                        input.hide()
                        return executeDocCommand({ range: activeRange, source: 'menu' })
                    case TEST_ITEM.label:
                        input.hide()
                        return executeTestEditCommand({ range: activeRange, source: 'menu' })
                    case FILE_HELP_LABEL:
                    case LARGE_FILE_WARNING_LABEL:
                    case SYMBOL_HELP_LABEL:
                    case PACKAGE_HELP_LABEL:
                    case NO_FILE_MATCHES_LABEL:
                    case NO_SYMBOL_MATCHES_LABEL:
                    case GENERAL_HELP_LABEL:
                        // Noop, the user has actioned an item that is non intended to be actionable.
                        return
                }

                // Empty input flow, do nothing
                if (instruction.length === 0) {
                    return
                }

                // User provided context flow, the `key` is provided as the `description` for symbol items, use this if available.
                const key = selectedItem?.description || selectedItem?.label
                if (selectedItem) {
                    const contextItem = contextItems.get(key)
                    if (contextItem) {
                        // Replace fuzzy value with actual context in input
                        input.value = `${removeAfterLastAt(instruction.toString())}@${key} `
                        selectedContextItems.set(key, contextItem)
                        return
                    }
                }

                // Submission flow, validate selected items and return final output
                input.hide()
                textDocumentListener.dispose()
                return resolve({
                    instruction: instruction.trim(),
                    userContextFiles: Array.from(selectedContextItems)
                        .filter(([key]) => instruction.toString().includes(`@${key}`))
                        .map(([, value]) => value),
                    model: activeModel,
                    range: activeRange,
                    intent: isGenerateIntent(document, activeRange) ? 'add' : 'edit',
                })
            },
        })

        const initialInput = initialValues.initialInputValue?.toString() || ''
        editInput.render(initialInput)

        if (initialInput.length === 0) {
            // If we have no initial input, we want to ensure we don't auto-select anything
            // This helps ensure the input does not feel like a menu.
            editInput.input.activeItems = []
        }
    })
}
