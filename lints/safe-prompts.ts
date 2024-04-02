// Checks that prompts track the source of context from the editor through to
// the finished string.
//
// - Literal strings are considered safe.
// - Dynamic strings must be constructed with helper functions that make the
//   correct behavior convenient.
// - Strings derived from the above are considered safe.
// - Functions which finally send prompts on the network should only take prompt-
//   safe strings, not arbitrary strings.
//
// To achieve this, we can't use strings for prompt pieces, but instead use
// objects. Prompts can only be manipulated with a tagged template literal and
// "safe" variants of string functions.
//
// Usage:
// pnpm tsc lints/safe-prompts.ts
// pnpm node lints/safe-prompts.js file.ts
//
// Use `pnpm tsc --listFilesOnly` to get a list of TypeScript files to process.
//
// References:
// https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API
// https://astexplorer.net/ with the parser set to "typescript"

import { readFileSync } from 'node:fs'
import * as ts from 'typescript'

export function delint(sourceFile: ts.SourceFile) {
    delintNode(sourceFile)

    function delintNode(node: ts.Node) {
        if (node.flags & ts.NodeFlags.ThisNodeHasError) {
            report(node, 'error')
            return
        }
        switch (node.kind) {
            case ts.SyntaxKind.Identifier: {
                const identifierNode = node as ts.Identifier
                if (
                    identifierNode.escapedText === 'ps' &&
                    !(
                        (node.parent?.kind === ts.SyntaxKind.TaggedTemplateExpression &&
                            (node.parent as ts.TaggedTemplateExpression).tag === node) ||
                        (node.parent?.kind === ts.SyntaxKind.FunctionDeclaration &&
                            (node.parent as ts.FunctionDeclaration).name === node)
                    )
                ) {
                    report(node, 'Use `ps` only as a tagged template literal')
                }
                break
            }
        }

        ts.forEachChild(node, delintNode)
    }

    function report(node: ts.Node, message: string) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
        console.log(`${sourceFile.fileName} (${line + 1},${character + 1}): ${message}`)
    }
}

const fileNames = process.argv.slice(2)
for (const fileName of fileNames) {
    // Parse a file
    const sourceFile = ts.createSourceFile(
        fileName,
        readFileSync(fileName).toString(),
        ts.ScriptTarget.ES2015, // TODO: is this the right script target?
        /*setParentNodes */ true
    )

    // delint it
    delint(sourceFile)
}
