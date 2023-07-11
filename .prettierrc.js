// @ts-check

const baseConfig = require('@sourcegraph/prettierrc')

/** @type {import('prettier').Config} */
module.exports = {
  ...baseConfig,
  plugins: [...(baseConfig.plugins || []), '@ianvs/prettier-plugin-sort-imports'],
  importOrder: [
    '^react$',
    '',
    '<THIRD_PARTY_MODULES>', // Note: Any unmatched modules will be placed here
    '',
    '^@sourcegraph/(.*)$', // Any internal module
    '',
    '^(?!.*.s?css$)(?!\\.\\/)(\\.\\.\\/.*$|\\.\\.$)', // Matches parent directory paths, e.g. "../Foo", or "../../Foo". or ".."
    '',
    '^(?!.*.s?css$)(\\.\\/.*$|\\.$)', // Matches sibling directory paths, e.g. "./Foo" or ".",
    '',
    '.*\\.s?css$', // SCSS imports. Note: This must be last to ensure predictable styling.
  ],
}
