import {
    type ContextItem,
    type ContextMentionProviderMetadata,
    displayPathBasename,
} from '@sourcegraph/cody-shared'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { type Mock, describe, expect, test, vi } from 'vitest'
import { URI } from 'vscode-uri'
import { MentionMenu } from './MentionMenu'
import type { MentionMenuData } from './useMentionMenuData'

vi.mock('./MentionMenuItem', () => ({
    MentionMenuContextItemContent: ({ item }: { item: ContextItem }) =>
        `item ${item.type} ${displayPathBasename(item.uri)}`,
    MentionMenuProviderItemContent: ({ provider }: { provider: ContextMentionProviderMetadata }) =>
        `provider ${provider.id}`,
}))

const PROVIDER_P1: ContextMentionProviderMetadata = {
    id: 'p1',
    triggerPrefixes: [],
}

const PROVIDER_P2: ContextMentionProviderMetadata = {
    id: 'p2',
    triggerPrefixes: ['t2:'],
}

const ITEM_FILE1: ContextItem = {
    type: 'file',
    uri: URI.file('file1.go'),
}

const ITEM_FILE2: ContextItem = {
    type: 'file',
    uri: URI.file('file2.ts'),
}

const PROPS: Pick<
    ComponentProps<typeof MentionMenu>,
    'params' | 'updateMentionMenuParams' | 'appendToEditorQuery' | 'selectOptionAndCleanUp'
> = {
    params: { query: '', parentItem: null },
    updateMentionMenuParams: () => {},
    appendToEditorQuery: () => {},
    selectOptionAndCleanUp: () => {},
}

describe('MentionMenu', () => {
    describe('initial states', () => {
        test('loading items', () => {
            const { container } = render(
                <MentionMenu {...PROPS} data={{ items: undefined, providers: [PROVIDER_P1] }} />
            )
            expectMenu(container, ['>provider p1', 'Loading...'])
        })

        test('empty items', () => {
            const { container } = render(
                <MentionMenu {...PROPS} data={{ items: [], providers: [PROVIDER_P1] }} />
            )
            expectMenu(container, ['>provider p1'])
        })

        test('with items', () => {
            const { container } = render(
                <MentionMenu
                    {...PROPS}
                    data={{
                        items: [ITEM_FILE1, ITEM_FILE2],
                        providers: [PROVIDER_P1],
                    }}
                />
            )
            expectMenu(container, ['>provider p1', 'item file file1.go', 'item file file2.ts'])
        })
    })

    function renderWithMocks(data: MentionMenuData): {
        updateMentionMenuParams: Mock
        appendToEditorQuery: Mock
        selectOptionAndCleanUp: Mock
        container: HTMLElement
    } {
        const updateMentionMenuParams = vi.fn()
        const appendToEditorQuery = vi.fn()
        const selectOptionAndCleanUp = vi.fn()
        const { container } = render(
            <MentionMenu
                {...PROPS}
                data={data}
                updateMentionMenuParams={updateMentionMenuParams}
                appendToEditorQuery={appendToEditorQuery}
                selectOptionAndCleanUp={selectOptionAndCleanUp}
            />
        )
        return {
            updateMentionMenuParams,
            appendToEditorQuery,
            selectOptionAndCleanUp,
            container,
        }
    }

    describe('select provider with no trigger prefix', () => {
        function doTest(action: (container: HTMLElement) => void) {
            const { updateMentionMenuParams, appendToEditorQuery, selectOptionAndCleanUp, container } =
                renderWithMocks({ items: [], providers: [PROVIDER_P1] })
            expectMenu(container, ['>provider p1'])
            action(container)
            expect(updateMentionMenuParams).toBeCalledTimes(1)
            expect(updateMentionMenuParams).toBeCalledWith({ parentItem: PROVIDER_P1 })
            expect(appendToEditorQuery).toBeCalledTimes(0)
            expect(selectOptionAndCleanUp).toBeCalledTimes(0)
        }
        test('click', () => doTest(() => fireEvent.click(screen.getByText('provider p1'))))
        test('keyboard', () =>
            doTest(container => {
                // ArrowDown then ArrowUp is a noop, but do it just to test
                fireEvent.keyDown(container, { key: 'ArrowDown' })
                fireEvent.keyDown(container, { key: 'ArrowUp' })
                fireEvent.keyDown(container, { key: 'Enter' })
            }))
    })

    describe('select provider with trigger prefix', () => {
        function doTest(action: (container: HTMLElement) => void): void {
            const { updateMentionMenuParams, appendToEditorQuery, selectOptionAndCleanUp, container } =
                renderWithMocks({ items: [], providers: [PROVIDER_P2] })
            expectMenu(container, ['>provider p2'])
            action(container)
            expect(updateMentionMenuParams).toBeCalledTimes(1)
            expect(updateMentionMenuParams).toBeCalledWith({ parentItem: PROVIDER_P2 })
            expect(appendToEditorQuery).toBeCalledTimes(1)
            expect(appendToEditorQuery).toBeCalledWith('t2:')
            expect(selectOptionAndCleanUp).toBeCalledTimes(0)
        }
        test('click', () => doTest(() => fireEvent.click(screen.getByText('provider p2'))))
        test('keyboard', () =>
            doTest(container => {
                // ArrowDown then ArrowUp is a noop, but do it just to test
                fireEvent.keyDown(container, { key: 'ArrowDown' })
                fireEvent.keyDown(container, { key: 'ArrowUp' })
                fireEvent.keyDown(container, { key: 'Enter' })
            }))
    })

    describe('select item', () => {
        function doTest(action: (container: HTMLElement) => void): void {
            const { updateMentionMenuParams, appendToEditorQuery, selectOptionAndCleanUp, container } =
                renderWithMocks({ items: [ITEM_FILE1, ITEM_FILE2], providers: [PROVIDER_P1] })
            expectMenu(container, ['provider p1', 'item file file1.go', 'item file file2.ts'])
            action(container)
            expect(updateMentionMenuParams).toBeCalledTimes(0)
            expect(appendToEditorQuery).toBeCalledTimes(0)
            expect(selectOptionAndCleanUp).toBeCalledTimes(1)
            expect(selectOptionAndCleanUp.mock.lastCall[0].item).toEqual(ITEM_FILE1)
        }
        test('click', () => doTest(() => fireEvent.click(screen.getByText('item file file1.go'))))
        test('keyboard', () =>
            doTest(container => {
                fireEvent.keyDown(container, { key: 'ArrowDown' })
                fireEvent.keyDown(container, { key: 'Enter' })
            }))
    })

    test('keyboard navigation', () => {
        const { container } = render(
            <MentionMenu
                {...PROPS}
                data={{ items: [ITEM_FILE1, ITEM_FILE2], providers: [PROVIDER_P1] }}
            />
        )
        expectMenu(container, ['>provider p1', 'item file file1.go', 'item file file2.ts'])
        fireEvent.keyDown(container, { key: 'ArrowDown' })
        expectMenu(container, ['provider p1', '>item file file1.go', 'item file file2.ts'])
        fireEvent.keyDown(container, { key: 'ArrowDown' })
        expectMenu(container, ['provider p1', 'item file file1.go', '>item file file2.ts'])
        fireEvent.keyDown(container, { key: 'ArrowDown' })
        expectMenu(container, ['>provider p1', 'item file file1.go', 'item file file2.ts'])
    })

    test('handle selection when data changes', () => {
        const { container, rerender } = render(
            <MentionMenu
                {...PROPS}
                data={{ items: [ITEM_FILE1, ITEM_FILE2], providers: [PROVIDER_P1, PROVIDER_P2] }}
            />
        )
        fireEvent.keyDown(container, { key: 'ArrowDown' })
        fireEvent.keyDown(container, { key: 'ArrowDown' })
        fireEvent.keyDown(container, { key: 'ArrowDown' })
        expectMenu(container, [
            'provider p1',
            'provider p2',
            'item file file1.go',
            '>item file file2.ts',
        ])

        // Data updates and the selected option is still present. It should remain selected.
        rerender(<MentionMenu {...PROPS} data={{ items: [ITEM_FILE1, ITEM_FILE2], providers: [] }} />)
        expectMenu(container, ['item file file1.go', '>item file file2.ts'])

        // Data updates and the selected option is no longer present. The first option should be
        // selected.
        rerender(<MentionMenu {...PROPS} data={{ items: [ITEM_FILE1], providers: [] }} />)
        expectMenu(container, ['>item file file1.go'])
    })
})

/** A test helper to make it easier to describe an expected {@link MentionMenu}. */
function expectMenu(container: HTMLElement, expectedRows: string[]): void {
    const actualRows = Array.from(
        container.querySelectorAll<HTMLElement>(':is([role=option], [role=progressbar])')
    )
    expect.soft(actualRows).toHaveLength(expectedRows.length)
    for (let i = 0; i < Math.max(expectedRows.length, actualRows.length); i++) {
        const { row: expectedRow, isSelected: expectedRowIsSelected } = parseExpectedRow(
            expectedRows.at(i)
        )
        const actualRow = actualRows.at(i)
        if (actualRow && expectedRow) {
            expect.soft(actualRow).toHaveTextContent(expectedRow)
            if (expectedRowIsSelected) {
                expect.soft(actualRow).toHaveAttribute('aria-selected', 'true')
            }
        } else if (actualRow) {
            expect.fail(
                `Expected no row ${i}, but it is present and has content ${JSON.stringify(
                    actualRow.innerText
                )}`
            )
        } else {
            expect.fail(`Expected row ${i} with content ${JSON.stringify(expectedRow)}`)
        }
    }

    function parseExpectedRow(expectedRow: string | undefined): {
        row: string | undefined
        isSelected: boolean
    } {
        return {
            row: expectedRow?.replace(/^>/, ''),
            isSelected: expectedRow?.startsWith('>') ?? false,
        }
    }
}
