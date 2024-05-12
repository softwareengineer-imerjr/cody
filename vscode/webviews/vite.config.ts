import { resolve } from 'path'

import react from '@vitejs/plugin-react'

import { defineProjectWithDefaults } from '../../.config/viteShared'

export default defineProjectWithDefaults(__dirname, {
    plugins: [react()],
    root: __dirname,
    base: './',
    server: {
        strictPort: true,
        port: 5778,
    },
    build: {
        emptyOutDir: false,
        outDir: __dirname + '/../dist/webviews',
        target: 'esnext',
        assetsDir: '.',
        minify: false,
        sourcemap: false,
        reportCompressedSize: false,
        rollupOptions: {
            external: ['node:https'],
            watch: {
                include: ['**'],
                exclude: [__dirname + '/../node_modules', __dirname + '/../src'],
            },
            input: {
                index: resolve(__dirname, 'index.html'),
            },
            output: {
                entryFileNames: '[name].js',
            },
        },
    },
})
