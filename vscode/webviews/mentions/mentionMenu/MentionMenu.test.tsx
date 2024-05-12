import {
    type ContextItem,
    type ContextMentionProviderMetadata,
    displayPathBasename,
} from '@sourcegraph/cody-shared'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { URI } from 'vscode-uri'
import { MentionMenu } from './MentionMenu'

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

const PROPS: Pick<
    ComponentProps<typeof MentionMenu>,
    'params' | 'data' | 'updateMentionMenuParams' | 'appendToEditorQuery' | 'selectOptionAndCleanUp'
> = {
    params: { query: '', parentItem: null },
    data: { items: [], providers: [PROVIDER_P1] },
    updateMentionMenuParams: () => {},
    appendToEditorQuery: () => {},
    selectOptionAndCleanUp: () => {},
}

describe('MentionMenu', () => {
    describe('top-level', () => {
        test('loading items', () => {
            const { container } = render(
                <MentionMenu {...PROPS} data={{ items: undefined, providers: [PROVIDER_P1] }} />
            )
            expectMenu(container, ['provider p1', 'Loading...'])
        })

        test('empty items', () => {
            const { container } = render(
                <MentionMenu {...PROPS} data={{ items: [], providers: [PROVIDER_P1] }} />
            )
            expectMenu(container, ['provider p1'])
        })

        test('select provider with no trigger char', () => {
            const updateMentionMenuParams = vi.fn()
            const appendToEditorQuery = vi.fn()
            const selectOptionAndCleanUp = vi.fn()
            const { container } = render(
                <MentionMenu
                    {...PROPS}
                    data={{ items: [], providers: [PROVIDER_P1] }}
                    updateMentionMenuParams={updateMentionMenuParams}
                    appendToEditorQuery={appendToEditorQuery}
                    selectOptionAndCleanUp={selectOptionAndCleanUp}
                />
            )
            expectMenu(container, ['provider p1'])
            fireEvent.click(screen.getByText('provider p1'))
            expect(updateMentionMenuParams).toBeCalledTimes(1)
            expect(updateMentionMenuParams).toBeCalledWith({ parentItem: PROVIDER_P1 })
            expect(appendToEditorQuery).toBeCalledTimes(0)
            expect(selectOptionAndCleanUp).toBeCalledTimes(0)
        })

        test('select provider with trigger prefix', () => {
            const updateMentionMenuParams = vi.fn()
            const appendToEditorQuery = vi.fn()
            const selectOptionAndCleanUp = vi.fn()
            const { container } = render(
                <MentionMenu
                    {...PROPS}
                    data={{ items: [], providers: [PROVIDER_P2] }}
                    updateMentionMenuParams={updateMentionMenuParams}
                    appendToEditorQuery={appendToEditorQuery}
                    selectOptionAndCleanUp={selectOptionAndCleanUp}
                />
            )
            expectMenu(container, ['provider p2'])
            fireEvent.click(screen.getByText('provider p2'))
            expect(updateMentionMenuParams).toBeCalledTimes(1)
            expect(updateMentionMenuParams).toBeCalledWith({ parentItem: PROVIDER_P2 })
            expect(appendToEditorQuery).toBeCalledTimes(1)
            expect(appendToEditorQuery).toBeCalledWith('t2:')
            expect(selectOptionAndCleanUp).toBeCalledTimes(0)
        })

        test('with items', () => {
            const { container } = render(
                <MentionMenu
                    {...PROPS}
                    data={{
                        items: [{ type: 'file', uri: URI.file('foo.go') }],
                        providers: [PROVIDER_P1],
                    }}
                />
            )
            expectMenu(container, ['provider p1', 'item file foo.go'])
        })
    })

    describe('file query', () => {
        test('with items', () => {
            const { container } = render(
                <MentionMenu
                    {...PROPS}
                    params={{ parentItem: null, query: 'f' }}
                    data={{
                        items: [{ type: 'file', uri: URI.file('foo.go') }],
                        providers: [PROVIDER_P1],
                    }}
                />
            )
            expectMenu(container, ['provider p1', 'item file foo.go'])
        })
    })
})

/** A test helper to make it easier to describe an expected {@link MentionMenu}. */
function expectMenu(container: HTMLElement, expectedRows: string[]): void {
    const actualRows = Array.from(
        container.querySelectorAll<HTMLElement>(':is([role=option], [role=progressbar])')
    )
    expect.soft(actualRows).toHaveLength(expectedRows.length)
    for (let i = 0; i < Math.max(expectedRows.length, actualRows.length); i++) {
        const expectedRow = expectedRows.at(i)
        const actualRow = actualRows.at(i)
        if (actualRow && expectedRow) {
            expect.soft(actualRow).toHaveTextContent(expectedRow)
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
}
