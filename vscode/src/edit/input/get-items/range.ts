import * as vscode from 'vscode'
import {
    QUICK_PICK_ITEM_CHECKED_PREFIX,
    QUICK_PICK_ITEM_EMPTY_INDENT_PREFIX,
} from '../../../chat/context/constants'
import { isGenerateIntent } from '../../utils/edit-intent'
import { getEditSmartSelection } from '../../utils/edit-selection'
import type { EditInputInitialValues } from '../get-input'
import type { GetItemsResult } from '../quick-pick'
import { CURSOR_RANGE_ITEM, EXPANDED_RANGE_ITEM, SELECTION_RANGE_ITEM } from './constants'
import { RANGE_SYMBOLS_ITEM } from './range-symbols'
import type { EditRangeItem } from './types'

const getDefaultRangeItems = (
    document: vscode.TextDocument,
    initialValues: RangeInputInitialValues
): EditRangeItem[] => {
    const { initialRange, initialExpandedRange, initialCursorPosition } = initialValues

    const cursorItem = {
        ...CURSOR_RANGE_ITEM,
        range: new vscode.Range(initialCursorPosition, initialCursorPosition),
    }

    if (initialExpandedRange) {
        // No need to show the selection (it will be the same as the expanded range)
        return [
            cursorItem,
            {
                ...EXPANDED_RANGE_ITEM,
                range: initialExpandedRange,
            },
        ]
    }

    if (isGenerateIntent(document, initialRange)) {
        // No need to show the selection (it will be the same as the cursor position)
        return [
            cursorItem,
            {
                ...EXPANDED_RANGE_ITEM,
                range: async () =>
                    getEditSmartSelection(document, initialRange, {
                        forceExpand: true,
                    }),
            },
        ]
    }

    return [
        cursorItem,
        {
            ...SELECTION_RANGE_ITEM,
            range: initialRange,
        },
        {
            ...EXPANDED_RANGE_ITEM,
            range: async () =>
                getEditSmartSelection(document, initialRange, {
                    forceExpand: true,
                }),
        },
    ]
}

interface RangeInputInitialValues extends EditInputInitialValues {
    initialCursorPosition: vscode.Position
}

export const getRangeInputItems = async (
    document: vscode.TextDocument,
    initialValues: RangeInputInitialValues,
    activeRange: vscode.Range,
    symbolsPromise: Thenable<vscode.DocumentSymbol[]>
): Promise<GetItemsResult> => {
    const defaultItems = getDefaultRangeItems(document, initialValues).map(item => ({
        ...item,
        label: `${QUICK_PICK_ITEM_EMPTY_INDENT_PREFIX} ${item.label}`,
    }))

    const activeItem = defaultItems.find(
        item => item.range instanceof vscode.Range && item.range.isEqual(activeRange)
    )

    if (activeItem) {
        // Update the label of the active item
        activeItem.label = activeItem.label.replace(
            QUICK_PICK_ITEM_EMPTY_INDENT_PREFIX,
            QUICK_PICK_ITEM_CHECKED_PREFIX
        )
    }

    return {
        items: [
            { label: 'ranges', kind: vscode.QuickPickItemKind.Separator },
            ...defaultItems,
            { label: 'symbols', kind: vscode.QuickPickItemKind.Separator },
            RANGE_SYMBOLS_ITEM,
        ],
        activeItem,
    }
}
