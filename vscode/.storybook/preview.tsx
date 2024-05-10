import type { Preview } from '@storybook/react'
import '../webviews/components/shadcn/shadcn.css'
// biome-ignore lint/correctness/noUnusedImports: needed because UMD import
import React from 'react'

const preview: Preview = {
    globalTypes: {
        theme: {
            description: 'VS Code theme',
            defaultValue: 'dark-plus',
            toolbar: {
                title: 'VS Code Theme',
                icon: 'photo',
                items: [
                    { value: 'dark-plus', title: 'Dark+ Theme' },
                    { value: 'dark-modern', title: 'Dark Modern Theme' },
                    { value: 'dark-high-contrast', title: 'Dark High Contrast Theme' },
                    { value: 'light-plus', title: 'Light+ Theme' },
                    { value: 'light-modern', title: 'Light Modern Theme' },
                    { value: 'light-high-contrast', title: 'Light High Contrast Theme' },
                    { value: 'red', title: 'Red Theme' },
                ],
                dynamicTitle: true,
            },
        },
    },
    decorators: [
        (Story, context) => {
            const theme = context.globals.theme
            return (
                <>
                    <p>TODO: {theme}</p>
                    <Story />
                </>
            )
        },
    ],
    parameters: {
        viewport: {
            viewports: [
                {
                    name: 'VSCode Normal Sidebar',
                    styles: { width: '400px', height: '800px' },
                    type: 'desktop',
                },
                {
                    name: 'VSCode Wide Sidebar',
                    styles: { width: '700px', height: '800px' },
                    type: 'desktop',
                },
                {
                    name: 'VSCode Tall Sidebar',
                    styles: { width: '500px', height: '1200px' },
                    type: 'desktop',
                },
            ],
        },
    },
}

export default preview
