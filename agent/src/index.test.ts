import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import * as vscode from 'vscode'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    DOTCOM_URL,
    ModelProvider,
    ModelUsage,
    getDotComDefaultModels,
    isWindows,
} from '@sourcegraph/cody-shared'

import { URI } from 'vscode-uri'
import type { RequestMethodName } from '../../vscode/src/jsonrpc/jsonrpc'
import { TESTING_CREDENTIALS } from '../../vscode/src/testutils/testing-credentials'
import { TestClient, asTranscriptMessage } from './TestClient'
import { TestWorkspace } from './TestWorkspace'
import { decodeURIs } from './decodeURIs'
import type {
    CustomChatCommandResult,
    CustomEditCommandResult,
    EditTask,
    Requests,
} from './protocol-alias'
import { trimEndOfLine } from './trimEndOfLine'

const explainPollyError = `
                console.error(error)

    ===================================================[ NOTICE ]=======================================================
    If you get PollyError or unexpected diff, you might need to update recordings to match your changes.
    Run the following commands locally to update the recordings:

      source agent/scripts/export-cody-http-recording-tokens.sh
      pnpm update-agent-recordings
      # Press 'u' to update the snapshots if the new behavior makes sense. It's
      # normal that the LLM returns minor changes to the wording.
      git commit -am "Update agent recordings"


    More details in https://github.com/sourcegraph/cody/tree/main/agent#updating-the-polly-http-recordings
    ====================================================================================================================

    `

const workspace = new TestWorkspace(path.join(__dirname, '__tests__', 'example-ts'))

const mayRecord =
    process.env.CODY_RECORDING_MODE === 'record' || process.env.CODY_RECORD_IF_MISSING === 'true'

describe('Agent', () => {
    const client = TestClient.create({
        workspaceRootUri: workspace.rootUri,
        name: 'defaultClient',
        credentials: TESTING_CREDENTIALS.dotcom,
    })

    // Initialize inside beforeAll so that subsequent tests are skipped if initialization fails.
    beforeAll(async () => {
        ModelProvider.setProviders(getDotComDefaultModels())
        await workspace.beforeAll()

        // Init a repo in the workspace to make the tree-walk repo-name resolver work for Cody Ignore tests.
        spawnSync('git', ['init'], { cwd: workspace.rootPath, stdio: 'inherit' })
        spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:sourcegraph/cody.git'], {
            cwd: workspace.rootPath,
            stdio: 'inherit',
        })

        const serverInfo = await client.initialize({
            serverEndpoint: 'https://sourcegraph.com',
            // Initialization should always succeed even if authentication fails
            // because otherwise clients need to restart the process to test
            // with a new access token.
            accessToken: 'sgp_INVALIDACCESSTOK_ENTHISSHOULDFAILEEEEEEEEEEEEEEEEEEEEEEE2',
        })
        expect(serverInfo?.authStatus?.isLoggedIn).toBeFalsy()

        // Log in so test cases are authenticated by default
        const valid = await client.request('extensionConfiguration/change', {
            ...client.info.extensionConfiguration,
            anonymousUserID: 'abcde1234',
            accessToken: client.info.extensionConfiguration?.accessToken ?? 'invalid',
            serverEndpoint: client.info.extensionConfiguration?.serverEndpoint ?? DOTCOM_URL.toString(),
            customHeaders: {},
        })
        expect(valid?.isLoggedIn).toBeTruthy()

        // Confirm .cody/ignore is active at start up
        const ignore = await client.request('ignore/test', {
            uri: URI.file(ignoredUri.fsPath).toString(),
        })
        // TODO(dpc): Integrate file-based .cody/ignore with ignore/test
        expect(ignore.policy).toBe('use')
    }, 20_000)

    beforeEach(async () => {
        await client.request('testing/reset', null)
    })

    const sumUri = workspace.file('src', 'sum.ts')
    const animalUri = workspace.file('src', 'animal.ts')
    const squirrelUri = workspace.file('src', 'squirrel.ts')
    const multipleSelectionsUri = workspace.file('src', 'multiple-selections.ts')

    // Context files ends with 'Ignored.ts' will be excluded by .cody/ignore
    const ignoredUri = workspace.file('src', 'isIgnored.ts')

    it('extensionConfiguration/change (handle errors)', async () => {
        // Send two config change notifications because this is what the
        // JetBrains client does and there was a bug where everything worked
        // fine as long as we didn't send the second unauthenticated config
        // change.
        const invalid = await client.request('extensionConfiguration/change', {
            ...client.info.extensionConfiguration,
            anonymousUserID: 'abcde1234',
            // Redacted format of an invalid access token (just random string). Tests fail in replay mode
            // if we don't use the redacted format here.
            accessToken: 'REDACTED_0ba08837494d00e3943c46999589eb29a210ba8063f084fff511c8e4d1503909',
            serverEndpoint: 'https://sourcegraph.com/',
            customHeaders: {},
        })
        expect(invalid?.isLoggedIn).toBeFalsy()
        const valid = await client.request('extensionConfiguration/change', {
            ...client.info.extensionConfiguration,
            anonymousUserID: 'abcde1234',
            accessToken: client.info.extensionConfiguration?.accessToken ?? 'invalid',
            serverEndpoint: client.info.extensionConfiguration?.serverEndpoint ?? DOTCOM_URL.toString(),
            customHeaders: {},
        })
        expect(valid?.isLoggedIn).toBeTruthy()

        // Please don't update the recordings to use a different account without consulting #wg-cody-agent.
        // When changing an account, you also need to update the REDACTED_ hash above.
        //
        // To update the recordings with the correct account, run the following command
        // from the root of this repository:
        //
        //    source agent/scripts/export-cody-http-recording-tokens.sh
        //
        // If you don't have access to this private file then you need to ask
        expect(valid?.username).toStrictEqual('sourcegraphbot9k-fnwmu')
    }, 10_000)

    describe('Autocomplete', () => {
        it('autocomplete/execute (non-empty result)', async () => {
            await client.openFile(sumUri)
            const completions = await client.request('autocomplete/execute', {
                uri: sumUri.toString(),
                position: { line: 1, character: 3 },
                triggerKind: 'Invoke',
            })
            const texts = completions.items.map(item => item.insertText)
            expect(completions.items.length).toBeGreaterThan(0)
            expect(texts).toMatchInlineSnapshot(
                `
              [
                "   return a + b;",
              ]
            `
            )
            client.notify('autocomplete/completionAccepted', {
                completionID: completions.items[0].id,
            })
        }, 10_000)
    })

    it('graphql/getCurrentUserCodySubscription', async () => {
        const currentUserCodySubscription = await client.request(
            'graphql/getCurrentUserCodySubscription',
            null
        )
        expect(currentUserCodySubscription).toMatchInlineSnapshot(`
          {
            "applyProRateLimits": true,
            "currentPeriodEndAt": "2024-04-14T22:11:32Z",
            "currentPeriodStartAt": "2024-03-14T22:11:32Z",
            "plan": "PRO",
            "status": "ACTIVE",
          }
        `)
    }, 10_000)

    describe('Chat', () => {
        it('chat/submitMessage (short message)', async () => {
            const lastMessage = await client.sendSingleMessageToNewChat('Hello!')
            expect(lastMessage).toMatchInlineSnapshot(
                `
              {
                "speaker": "assistant",
                "text": "Hello there! I'm Claude, an AI assistant created by Anthropic. It's nice to meet you. How can I help you today?",
              }
            `
            )
        }, 30_000)

        it('chat/submitMessage (long message)', async () => {
            const lastMessage = await client.sendSingleMessageToNewChat(
                'Generate simple hello world function in java!'
            )
            const trimmedMessage = trimEndOfLine(lastMessage?.text ?? '')
            expect(trimmedMessage).toMatchInlineSnapshot(
                `
              "Sure, here's a simple "Hello, World!" function in Java:

              \`\`\`java
              public class HelloWorld {
                  public static void main(String[] args) {
                      System.out.println("Hello, World!");
                  }
              }
              \`\`\`

              This code defines a class named \`HelloWorld\` with a \`main\` method. When you run this program, it will print the string \`"Hello, World!"\` to the console.

              In Java, the \`main\` method is the entry point of a program. It's where the execution of the program starts. The \`public static void main(String[] args)\` line is a required signature for the \`main\` method.

              Inside the \`main\` method, we use the \`System.out.println()\` method to print the string \`"Hello, World!"\` to the console. \`System.out\` is an output stream that represents the console, and \`println()\` is a method that prints the specified string to the console and adds a newline character at the end.

              To run this program, you need to save the code in a file with a \`.java\` extension (e.g., \`HelloWorld.java\`), compile it using a Java compiler, and then execute the compiled bytecode."
            `,
                explainPollyError
            )
        }, 30_000)

        it('chat/restore', async () => {
            // Step 1: create a chat session where I share my name.
            const id1 = await client.request('chat/new', null)
            const reply1 = asTranscriptMessage(
                await client.request('chat/submitMessage', {
                    id: id1,
                    message: {
                        command: 'submit',
                        text: 'My name is Lars Monsen.',
                        submitType: 'user',
                        addEnhancedContext: false,
                    },
                })
            )

            // Step 2: restore a new chat session with a transcript including my name, and
            //  and assert that it can retrieve my name from the transcript.
            const {
                models: [model],
            } = await client.request('chat/models', { modelUsage: ModelUsage.Chat })

            const id2 = await client.request('chat/restore', {
                modelID: model.model,
                messages: reply1.messages,
                chatID: new Date().toISOString(), // Create new Chat ID with a different timestamp
            })
            const reply2 = asTranscriptMessage(
                await client.request('chat/submitMessage', {
                    id: id2,
                    message: {
                        command: 'submit',
                        text: 'What is my name?',
                        submitType: 'user',
                        addEnhancedContext: false,
                    },
                })
            )
            expect(reply2.messages.at(-1)?.text).toMatchInlineSnapshot(
                `"You told me your name is Lars Monsen."`,
                explainPollyError
            )
        }, 30_000)

        it('chat/restore (With null model)', async () => {
            // Step 1: Create a chat session asking what model is used.
            const id1 = await client.request('chat/new', null)
            const reply1 = asTranscriptMessage(
                await client.request('chat/submitMessage', {
                    id: id1,
                    message: {
                        command: 'submit',
                        text: 'What model are you?',
                        submitType: 'user',
                        addEnhancedContext: false,
                    },
                })
            )

            // Step 2: Restoring chat session without model.
            const id2 = await client.request('chat/restore', {
                messages: reply1.messages,
                chatID: new Date().toISOString(), // Create new Chat ID with a different timestamp
            })
            // Step 2: Asking again what model is used
            const reply2 = asTranscriptMessage(
                await client.request('chat/submitMessage', {
                    id: id2,
                    message: {
                        command: 'submit',
                        text: 'What model are you?',
                        submitType: 'user',
                        addEnhancedContext: false,
                    },
                })
            )
            expect(reply2.messages.at(-1)?.text).toMatchInlineSnapshot(
                `"As I mentioned, I am an AI model called Claude created by Anthropic. I don't have detailed technical information about my underlying architecture or training process. Is there something specific you're wondering about in terms of my capabilities?"`,
                explainPollyError
            )
        }, 30_000)

        it('chat/restore (multiple) & export', async () => {
            const date = new Date(1997, 7, 2, 12, 0, 0, 0)

            // Step 1: Restore multiple chats
            const NUMBER_OF_CHATS_TO_RESTORE = 300
            for (let i = 0; i < NUMBER_OF_CHATS_TO_RESTORE; i++) {
                const myDate = new Date(date.getTime() + i * 60 * 1000)
                await client.request('chat/restore', {
                    modelID: 'anthropic/claude-2.0',
                    messages: [
                        { text: 'What model are you?', speaker: 'human', contextFiles: [] },
                        {
                            text: " I'm Claude, an AI assistant created by Anthropic.",
                            speaker: 'assistant',
                        },
                    ],
                    chatID: myDate.toISOString(), // Create new Chat ID with a different timestamp
                })
            }

            // Step 2: export history
            const chatHistory = await client.request('chat/export', null)

            chatHistory.forEach((result, index) => {
                const myDate = new Date(date.getTime() + index * 60 * 1000).toISOString()

                expect(result.transcript).toMatchInlineSnapshot(`{
  "chatModel": "anthropic/claude-2.0",
  "id": "${myDate}",
  "interactions": [
    {
      "assistantMessage": {
        "speaker": "assistant",
        "text": " I'm Claude, an AI assistant created by Anthropic.",
      },
      "humanMessage": {
        "contextFiles": [],
        "speaker": "human",
        "text": "What model are you?",
      },
    },
  ],
  "lastInteractionTimestamp": "${myDate}",
}`)
            })
        }, 30_000)

        it('chat/submitMessage (addEnhancedContext: true)', async () => {
            await client.openFile(animalUri)
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            const lastMessage = await client.sendSingleMessageToNewChat(
                'Write a class Dog that implements the Animal interface in my workspace. Show the code only, no explanation needed.',
                {
                    addEnhancedContext: true,
                }
            )
            // TODO: make this test return a TypeScript implementation of
            // `animal.ts`. It currently doesn't do this because the workspace root
            // is not a git directory and symf reports some git-related error.
            expect(trimEndOfLine(lastMessage?.text ?? '')).toMatchInlineSnapshot(
                `
              "\`\`\`typescript
              class Dog implements Animal {
                  name: string;
                  isMammal: boolean = true;

                  constructor(name: string) {
                      this.name = name;
                  }

                  makeAnimalSound(): string {
                      return "Woof!";
                  }
              }
              \`\`\`"
            `,
                explainPollyError
            )
        }, 30_000)

        it('chat/submitMessage (addEnhancedContext: true, squirrel test)', async () => {
            await client.openFile(squirrelUri)
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            const { lastMessage, transcript } =
                await client.sendSingleMessageToNewChatWithFullTranscript('What is Squirrel?', {
                    addEnhancedContext: true,
                })
            expect(lastMessage?.text?.toLocaleLowerCase() ?? '').includes('code nav')
            expect(lastMessage?.text?.toLocaleLowerCase() ?? '').includes('sourcegraph')
            decodeURIs(transcript)
            const contextFiles = transcript.messages.flatMap(m => m.contextFiles ?? [])
            expect(contextFiles).not.toHaveLength(0)
            expect(contextFiles.map(file => file.uri.toString())).includes(squirrelUri.toString())
        }, 30_000)

        it('webview/receiveMessage (type: chatModel)', async () => {
            const id = await client.request('chat/new', null)
            {
                await client.setChatModel(id, 'openai/gpt-3.5-turbo')
                const lastMessage = await client.sendMessage(id, 'what color is the sky?')
                expect(lastMessage?.text?.toLocaleLowerCase().includes('blue')).toBeTruthy()
            }
        }, 30_000)

        it('webview/receiveMessage (type: reset)', async () => {
            const id = await client.request('chat/new', null)
            await client.setChatModel(id, 'fireworks/accounts/fireworks/models/mixtral-8x7b-instruct')
            await client.sendMessage(
                id,
                'The magic word is "kramer". If I say the magic word, respond with a single word: "quone".'
            )
            {
                const lastMessage = await client.sendMessage(id, 'kramer')
                expect(lastMessage?.text?.toLocaleLowerCase().includes('quone')).toBeTruthy()
            }
            await client.reset(id)
            {
                const lastMessage = await client.sendMessage(id, 'kramer')
                expect(lastMessage?.text?.toLocaleLowerCase().includes('quone')).toBeFalsy()
            }
        })

        describe('chat/editMessage', () => {
            it(
                'edits the last human chat message',
                async () => {
                    const id = await client.request('chat/new', null)
                    await client.setChatModel(
                        id,
                        'fireworks/accounts/fireworks/models/mixtral-8x7b-instruct'
                    )
                    await client.sendMessage(
                        id,
                        'The magic word is "kramer". If I say the magic word, respond with a single word: "quone".'
                    )
                    await client.editMessage(
                        id,
                        'Another magic word is "georgey". If I say the magic word, respond with a single word: "festivus".'
                    )
                    {
                        const lastMessage = await client.sendMessage(id, 'kramer')
                        expect(lastMessage?.text?.toLocaleLowerCase().includes('quone')).toBeFalsy()
                    }
                    {
                        const lastMessage = await client.sendMessage(id, 'georgey')
                        expect(lastMessage?.text?.toLocaleLowerCase().includes('festivus')).toBeTruthy()
                    }
                },
                { timeout: mayRecord ? 10_000 : undefined }
            )

            it('edits messages by index', async () => {
                const id = await client.request('chat/new', null)
                await client.setChatModel(
                    id,
                    'fireworks/accounts/fireworks/models/mixtral-8x7b-instruct'
                )
                // edits by index replaces message at index, and erases all subsequent messages
                await client.sendMessage(
                    id,
                    'I have a turtle named "potter", reply single "ok" if you understand.'
                )
                await client.sendMessage(
                    id,
                    'I have a bird named "skywalker", reply single "ok" if you understand.'
                )
                await client.sendMessage(
                    id,
                    'I have a dog named "happy", reply single "ok" if you understand.'
                )
                await client.editMessage(
                    id,
                    'I have a tiger named "zorro", reply single "ok" if you understand',
                    { index: 2 }
                )
                {
                    const lastMessage = await client.sendMessage(id, 'What pets do I have?')
                    const answer = lastMessage?.text?.toLocaleLowerCase()
                    expect(answer?.includes('turtle')).toBeTruthy()
                    expect(answer?.includes('tiger')).toBeTruthy()
                    expect(answer?.includes('bird')).toBeFalsy()
                    expect(answer?.includes('dog')).toBeFalsy()
                }
            }, 30_000)
        })
    })

    // TODO(dpc): Integrate file-based .cody/ignore with ignore/test
    describe.skip('Cody Ignore', () => {
        beforeAll(async () => {
            // Make sure Cody ignore config exists and works
            const codyIgnoreConfig = workspace.file('.cody', 'ignore')
            await client.openFile(codyIgnoreConfig)
            const codyIgnoreConfigFile = client.workspace.getDocument(codyIgnoreConfig)
            expect(codyIgnoreConfigFile?.content).toBeDefined()

            const result = await client.request('ignore/test', {
                uri: ignoredUri.toString(),
            })
            expect(result.policy).toBe('ignore')
        }, 10_000)

        it('autocomplete/execute on ignored file', async () => {
            await client.openFile(ignoredUri)
            const completions = await client.request('autocomplete/execute', {
                uri: ignoredUri.toString(),
                position: { line: 1, character: 3 },
                triggerKind: 'Invoke',
            })
            const texts = completions.items.map(item => item.insertText)
            expect(completions.items.length).toBe(0)
            expect(texts).toMatchInlineSnapshot(
                `
              []
            `
            )
        }, 10_000)

        it('chat/submitMessage on an ignored file (addEnhancedContext: true)', async () => {
            await client.openFile(ignoredUri)
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            const { transcript } = await client.sendSingleMessageToNewChatWithFullTranscript(
                'What files contain SELECTION_START?',
                { addEnhancedContext: true }
            )
            decodeURIs(transcript)
            const contextFiles = transcript.messages.flatMap(m => m.contextFiles ?? [])
            // Current file which is ignored, should not be included in context files
            expect(contextFiles.find(f => f.uri.toString() === ignoredUri.toString())).toBeUndefined()
            // Ignored file should not be included in context files
            const contextFilesUrls = contextFiles.map(f => f.uri).filter(uri => uri)
            const result = await Promise.all(
                contextFilesUrls.map(uri => client.request('ignore/test', { uri: uri.toString() }))
            )
            for (const r of result) {
                expect(r.policy).toBe('use')
            }
            // Files that are not ignored should be used as context files
            expect(contextFiles.length).toBeGreaterThan(0)
        }, 30_000)

        it('chat/submitMessage on an ignored file (addEnhancedContext: false)', async () => {
            await client.openFile(ignoredUri)
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            const { transcript } = await client.sendSingleMessageToNewChatWithFullTranscript(
                'Which file is the isIgnoredByCody functions defined?',
                { addEnhancedContext: false }
            )
            decodeURIs(transcript)
            const contextFiles = transcript.messages.flatMap(m => m.contextFiles ?? [])
            const contextUrls = contextFiles.map(f => f.uri?.path)
            // Current file which is ignored, should not be included in context files
            expect(contextUrls.find(uri => uri === ignoredUri.toString())).toBeUndefined()
            // Since no enhanced context is requested, no context files should be included
            expect(contextFiles.length).toBe(0)
            // Ignored file should not be included in context files
            const result = await Promise.all(
                contextUrls.map(uri =>
                    client.request('ignore/test', {
                        uri,
                    })
                )
            )
            expect(result.every(entry => entry.policy === 'use')).toBe(true)
        }, 30_000)

        it('chat command on an ignored file', async () => {
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            await client.openFile(ignoredUri)
            // Cannot execute commands in an ignored files, so this should throw error
            await client.request('commands/explain', null).catch(err => {
                expect(err).toBeDefined()
            })
        }, 30_000)

        it('inline edit on an ignored file', async () => {
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            await client.openFile(ignoredUri, { removeCursor: false })
            await client.request('editCommands/document', null).catch(err => {
                expect(err).toBeDefined()
            })
        })

        it('ignore rule is not case sensitive', async () => {
            const alsoIgnored = workspace.file('src', 'is_ignored.ts')
            const result = await client.request('ignore/test', {
                uri: URI.file(alsoIgnored.fsPath).toString(),
            })
            expect(result.policy).toBe('ignore')
        })

        afterAll(async () => {
            // Makes sure cody ignore is still active after tests
            // as it should stay active for each workspace session.
            const result = await client.request('ignore/test', {
                uri: ignoredUri.toString(),
            })
            expect(result.policy).toBe('ignore')

            // Check the network requests to ensure no requests include context from ignored files
            const { requests } = await client.request('testing/networkRequests', null)

            const groupedMsgs = []
            for (const req of requests) {
                // Get the messages from the request body
                const messages = JSON.parse(req.body || '{}')?.messages as {
                    speaker: string
                    text: string
                }[]
                // Filter out messages that do not include context snippets.
                const text = messages
                    ?.filter(m => m.speaker === 'human' && m.text !== undefined)
                    ?.map(m => m.text)

                groupedMsgs.push(...(text ?? []))
            }
            expect(groupedMsgs.length).toBeGreaterThan(0)

            // Join all the string from each groupedMsgs[] together into
            // one block of text, and then check if it contains the ignored file name
            // to confirm context from the ignored file was not sent to the server.
            const groupedText = groupedMsgs.flat().join(' ')
            expect(groupedText).not.includes('src/isIgnored.ts')

            // Confirm the grouped text is valid by checking for known
            // context file names from the test.
            expect(groupedText).includes('src/squirrel.ts')
        }, 10_000)
    })

    describe('Text documents', () => {
        it('chat/submitMessage (understands the selected text)', async () => {
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            await client.openFile(multipleSelectionsUri)
            await client.changeFile(multipleSelectionsUri)
            await client.changeFile(multipleSelectionsUri, {
                selectionName: 'SELECTION_2',
            })
            const reply = await client.sendSingleMessageToNewChat(
                'What is the name of the function that I have selected? Only answer with the name of the function, nothing else',
                { addEnhancedContext: true }
            )
            expect(reply?.text?.trim()).includes('anotherFunction')
            expect(reply?.text?.trim()).not.includes('inner')
            await client.changeFile(multipleSelectionsUri)
            const reply2 = await client.sendSingleMessageToNewChat(
                'What is the name of the function that I have selected? Only answer with the name of the function, nothing else',
                { addEnhancedContext: true }
            )
            expect(reply2?.text?.trim()).includes('inner')
            expect(reply2?.text?.trim()).not.includes('anotherFunction')
        }, 20_000)
    })

    function checkEditCommand(
        documentClient: TestClient,
        command: RequestMethodName,
        name: string,
        filename: string,
        param: any,
        assertion: (obtained: string) => void
    ): void {
        it(
            name,
            async () => {
                await documentClient.request('command/execute', {
                    command: 'cody.search.index-update',
                })
                const uri = workspace.file('src', filename)
                await documentClient.openFile(uri, { removeCursor: false })
                const task = await documentClient.request(command, param)
                await documentClient.taskHasReachedAppliedPhase(task)
                const lenses = documentClient.codeLenses.get(uri.toString()) ?? []
                expect(lenses).toHaveLength(0) // Code lenses are now handled client side

                await documentClient.request('editTask/accept', { id: task.id })
                const newContent = documentClient.workspace.getDocument(uri)?.content
                assertion(trimEndOfLine(newContent))
            },
            20_000
        )
    }

    function checkEditCodeCommand(
        documentClient: TestClient,
        name: string,
        filename: string,
        instruction: string,
        assertion: (obtained: string) => void
    ): void {
        checkEditCommand(
            documentClient,
            'editCommands/code',
            name,
            filename,
            { instruction: instruction },
            assertion
        )
    }

    function checkDocumentCommand(
        documentClient: TestClient,
        name: string,
        filename: string,
        assertion: (obtained: string) => void
    ): void {
        checkEditCommand(documentClient, 'editCommands/document', name, filename, null, assertion)
    }

    describe('Commands', () => {
        it('commands/explain', async () => {
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            await client.openFile(animalUri)
            const freshChatID = await client.request('chat/new', null)
            const id = await client.request('commands/explain', null)

            // Assert that the server is not using IDs between `chat/new` and
            // `chat/explain`. In VS Code, we try to reuse empty webview panels,
            // which is undesireable for agent clients.
            expect(id).not.toStrictEqual(freshChatID)

            const lastMessage = await client.firstNonEmptyTranscript(id)
            expect(trimEndOfLine(lastMessage.messages.at(-1)?.text ?? '')).toMatchInlineSnapshot(
                `
              "\`@src/animal.ts:1-6\` is a TypeScript code snippet that defines an interface called \`Animal\`. An interface in TypeScript is a way to define the shape, or structure, of an object. It specifies the properties and methods that an object must have to be considered an instance of that interface.

              In this case, the \`Animal\` interface has three properties:

              1. \`name\`: This is a string property that represents the name of the animal.
              2. \`makeAnimalSound()\`: This is a method that returns a string, representing the sound the animal makes.
              3. \`isMammal\`: This is a boolean property that indicates whether the animal is a mammal or not.

              The purpose of this code is to provide a blueprint or contract for any object that needs to represent an animal in the application. It does not take any direct input, but it specifies the requirements for an object to be considered an \`Animal\`.

              The output of this code is not a value, but rather a definition or specification that can be used throughout the application to ensure that any object representing an animal adheres to this structure.

              The code achieves its purpose by defining the \`Animal\` interface with the specified properties and methods. Any object that needs to be an instance of \`Animal\` must have these properties and methods defined, with the correct types and return types.

              For example, if you were to create an object representing a dog, it would need to have a \`name\` property of type string, a \`makeAnimalSound()\` method that returns a string (e.g., "Woof!"), and a \`isMammal\` property of type boolean (which would be true for dogs).

              There is no complex logic or data transformation happening in this code snippet. It is simply a definition or contract that other parts of the application can use to ensure consistency and type safety when working with animal objects."
            `,
                explainPollyError
            )
        }, 30_000)

        // This test seems extra sensitive on Node v16 for some reason.
        it.skipIf(isWindows())(
            'commands/test',
            async () => {
                await client.request('command/execute', {
                    command: 'cody.search.index-update',
                })
                await client.openFile(animalUri)
                const id = await client.request('commands/test', null)
                const lastMessage = await client.firstNonEmptyTranscript(id)
                expect(trimEndOfLine(lastMessage.messages.at(-1)?.text ?? '')).toMatchInlineSnapshot(
                    `
                  "Based on the shared code context, the test framework being used is Vitest. It appears to be following the same testing patterns as Jest, with \`describe\` blocks for test suites and \`it\` blocks for individual test cases.

                  No new imports needed - using existing libs (vitest and its existing imports).

                  The provided code snippet defines an \`Animal\` interface with three properties: \`name\` of type string, \`makeAnimalSound\` which is a function that returns a string, and \`isMammal\` of type boolean.

                  Test coverage summary:
                  - The tests will cover the properties and expected behavior of the \`Animal\` interface.
                  - No actual implementation of the \`makeAnimalSound\` function is provided, so the tests will have to make assumptions about its expected behavior.
                  - Edge cases like handling empty or invalid inputs for the \`name\` property can be tested.

                  Here is a suite of unit tests for the \`Animal\` interface:

                  \`\`\`typescript
                  import { describe, it, expect } from 'vitest'
                  import { Animal } from './animal'

                  describe('Animal', () => {
                    it('should have a name property', () => {
                      const animal: Animal = {
                        name: 'Tiger',
                        makeAnimalSound: () => 'Roar',
                        isMammal: true
                      }

                      expect(animal.name).toBe('Tiger')
                    })

                    it('should have a isMammal property', () => {
                      const animal: Animal = {
                        name: 'Crocodile',
                        makeAnimalSound: () => 'Hiss',
                        isMammal: false
                      }

                      expect(animal.isMammal).toBe(false)
                    })

                    it('should have a makeAnimalSound function', () => {
                      const animal: Animal = {
                        name: 'Elephant',
                        makeAnimalSound: () => 'Trumpet',
                        isMammal: true
                      }

                      expect(typeof animal.makeAnimalSound).toBe('function')
                    })

                    it('should handle empty name', () => {
                      const animal: Animal = {
                        name: '',
                        makeAnimalSound: () => 'Meow',
                        isMammal: true
                      }

                      expect(animal.name).toBe('')
                    })
                  })
                  \`\`\`

                  These tests cover the basic properties and behavior of the \`Animal\` interface, including checking for the presence of the required properties, testing the \`makeAnimalSound\` function type, and handling edge cases like an empty name."
                `,
                    explainPollyError
                )
            },
            30_000
        )

        it('commands/smell', async () => {
            await client.openFile(animalUri)
            const id = await client.request('commands/smell', null)
            const lastMessage = await client.firstNonEmptyTranscript(id)

            expect(trimEndOfLine(lastMessage.messages.at(-1)?.text ?? '')).toMatchInlineSnapshot(
                `
              "The provided code snippet defines an interface \`Animal\` with three properties: \`name\` of type \`string\`, \`makeAnimalSound\` of type function returning a \`string\`, and \`isMammal\` of type \`boolean\`. Here are a few suggestions for potential improvements:

              1. **Consider using a more descriptive name for the \`makeAnimalSound\` function**: The name \`makeAnimalSound\` may not accurately describe the purpose of the function. A more descriptive name such as \`getSound\` or \`produceSound\` could improve code readability and maintainability.

              2. **Consider adding type annotations for function parameters and return types**: Although TypeScript can infer the types of function parameters and return values, it's generally considered a best practice to explicitly annotate them. This can improve code readability and maintainability, especially for more complex functions.

              3. **Consider using a more specific type for the \`name\` property**: Instead of using the generic \`string\` type for the \`name\` property, you could consider using a more specific type like \`AnimalName\` or \`string\` with a constraint on the allowed values (e.g., \`string\` with a minimum length). This can help catch potential errors during development and provide better documentation for the expected values.

              4. **Consider adding comments or documentation**: While the code is relatively simple, adding comments or documentation can improve code maintainability, especially if the interface is used across multiple files or by different developers. This can help explain the purpose of the interface, the intended use cases, and any design decisions or assumptions made.

              5. **Consider separating concerns**: If the \`Animal\` interface is part of a larger codebase, it might be beneficial to separate it into its own file or module. This can improve code organization and make it easier to manage and maintain different parts of the codebase independently.

              Overall, while the provided code snippet is relatively straightforward and follows basic TypeScript syntax, there are opportunities for improvement in terms of readability, maintainability, and adherence to best practices. However, the code does not appear to have any glaring errors or design flaws."
            `,
                explainPollyError
            )
        }, 30_000)

        it('editCommand/test', async () => {
            const uri = workspace.file('src', 'trickyLogic.ts')

            await client.openFile(uri)
            const id = await client.request('editCommands/test', null)
            await client.taskHasReachedAppliedPhase(id)
            const originalDocument = client.workspace.getDocument(uri)!
            expect(trimEndOfLine(originalDocument.getText())).toMatchInlineSnapshot(
                `
              "export function trickyLogic(a: number, b: number): number {
                  if (a === 0) {
                      return 1
                  }
                  if (b === 2) {
                      return 1
                  }

                  return a - b
              }


              "
            `,
                explainPollyError
            )

            const untitledDocuments = client.workspace
                .allUris()
                .filter(uri => vscode.Uri.parse(uri).scheme === 'untitled')
            const fileDocuments = client.workspace
                .allUris()
                .filter(uri => vscode.Uri.parse(uri).scheme === 'file')
            expect(untitledDocuments).toHaveLength(2)
            expect(fileDocuments).toHaveLength(1)
            const [untitledDocument] = untitledDocuments.slice(1)
            const testDocument = client.workspace.getDocument(vscode.Uri.parse(untitledDocument))
            expect(trimEndOfLine(testDocument?.getText())).toMatchInlineSnapshot(
                `
              "import { expect } from 'vitest'
              import { describe } from 'vitest';
              import { it } from 'vitest';
              import { trickyLogic } from './trickyLogic';

              describe('trickyLogic', () => {
                  it('should return 1 when a is 0', () => {
                      expect(trickyLogic(0, 5)).toBe(1);
                  });

                  it('should return 1 when b is 2', () => {
                      expect(trickyLogic(5, 2)).toBe(1);
                  });

                  it('should return a - b when a is not 0 and b is not 2', () => {
                      expect(trickyLogic(5, 3)).toBe(2);
                      expect(trickyLogic(10, 5)).toBe(5);
                  });

                  it('should handle negative numbers', () => {
                      expect(trickyLogic(-5, 3)).toBe(-8);
                      expect(trickyLogic(5, -3)).toBe(8);
                  });
              });
              "
            `,
                explainPollyError
            )

            // Just to make sure the edit happened via `workspace/edit` instead
            // of `textDocument/edit`.
            expect(client.workspaceEditParams).toHaveLength(1)
        }, 30_000)

        describe('Edit code', () => {
            checkEditCodeCommand(
                client,
                'editCommands/code (basic function)',
                'sum.ts',
                'Rename `a` parameter to `c`',
                obtained =>
                    expect(obtained).toMatchInlineSnapshot(
                        `
                    "export function sum(c: number, b: number): number {
                        /* CURSOR */
                    }
                    "
                    `,
                        explainPollyError
                    )
            )

            it('editCommand/code (add prop types)', async () => {
                const uri = workspace.file('src', 'ChatColumn.tsx')
                await client.openFile(uri)
                const task = await client.request('editCommands/code', {
                    instruction: 'Add types to these props. If you have to create types, add them',
                    model: ModelProvider.getProviderByModelSubstringOrError('anthropic/claude-3-opus')
                        .model,
                })
                await client.acceptEditTask(uri, task)
                expect(client.documentText(uri)).toMatchInlineSnapshot(
                    `
                  "import { useEffect } from "react";
                  import React = require("react");

                  import { Message } from "../types";

                  type Props = {
                      messages: Message[];
                      setChatID: (chatID: string) => void;
                      isLoading: boolean;
                  };

                  export default function ChatColumn({
                      messages,
                      setChatID,
                      isLoading,
                  }: Props) {
                  	useEffect(() => {
                  		if (!isLoading) {
                  			setChatID(messages[0].chatID);
                  		}
                  	}, [messages]);
                  	return (
                  		<>
                  			<h1>Messages</h1>
                  			<ul>
                  				{messages.map((message) => (
                  					<li>{message.text}</li>
                  				))}
                  			</ul>
                  		</>
                  	);
                  }
                  "
                `,
                    explainPollyError
                )
            }, 20_000)
        })

        describe('Document code', () => {
            checkDocumentCommand(client, 'editCommands/document (basic function)', 'sum.ts', obtained =>
                expect(obtained).toMatchInlineSnapshot(
                    `
                  "/**
                   * Computes the sum of two numbers.
                   * @param a - The first number to add.
                   * @param b - The second number to add.
                   * @returns The sum of \`a\` and \`b\`.
                   */
                  export function sum(a: number, b: number): number {
                      /* CURSOR */
                  }
                  "
                `,
                    explainPollyError
                )
            )

            checkDocumentCommand(
                client,
                'commands/document (Method as part of a class)',
                'TestClass.ts',
                obtained =>
                    expect(obtained).toMatchInlineSnapshot(
                        `
                  "const foo = 42

                  export class TestClass {
                      constructor(private shouldGreet: boolean) {}

                          /**
                       * Logs "Hello World!" to the console if \`shouldGreet\` is true.
                       */
                  public functionName() {
                          if (this.shouldGreet) {
                              console.log(/* CURSOR */ 'Hello World!')
                          }
                      }
                  }
                  "
                `,
                        explainPollyError
                    )
            )

            checkDocumentCommand(
                client,
                'commands/document (Function within a property)',
                'TestLogger.ts',
                obtained =>
                    expect(obtained).toMatchInlineSnapshot(`
                  "const foo = 42
                  export const TestLogger = {
                      startLogging: () => {
                          // Do some stuff

                                  /**
                           * Records a log message to the console.
                           */
                  function recordLog() {
                              console.log(/* CURSOR */ 'Recording the log')
                          }

                          recordLog()
                      },
                  }
                  "
                `)
            )

            checkDocumentCommand(
                client,
                'commands/document (nested test case)',
                'example.test.ts',
                obtained =>
                    expect(obtained).toMatchInlineSnapshot(
                        `
                  "import { expect } from 'vitest'
                  import { it } from 'vitest'
                  import { describe } from 'vitest'

                  describe('test block', () => {
                      it('does 1', () => {
                          expect(true).toBe(true)
                      })

                      it('does 2', () => {
                          expect(true).toBe(true)
                      })

                      it('does something else', () => {
                          // This line will error due to incorrect usage of \`performance.now\`
                                  /**
                           * Returns the current time in milliseconds since the page was loaded.
                           *
                           * Use this to measure the duration of an operation or to profile code performance.
                           */
                  const startTime = performance.now(/* CURSOR */)
                      })
                  })
                  "
                `,
                        explainPollyError
                    )
            )
        })
    })

    describe('Custom Commands', () => {
        it('commands/custom, chat command, open tabs context', async () => {
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            // Note: The test editor has all the files opened from previous tests as open tabs,
            // so we will need to open a new file that has not been opened before,
            // to make sure this context type is working.
            const trickyLogicUri = workspace.file('src', 'trickyLogic.ts')
            await client.openFile(trickyLogicUri)

            const result = (await client.request('commands/custom', {
                key: '/countTabs',
            })) as CustomChatCommandResult
            expect(result.type).toBe('chat')
            const lastMessage = await client.firstNonEmptyTranscript(result?.chatResult as string)
            expect(trimEndOfLine(lastMessage.messages.at(-1)?.text ?? '')).toMatchInlineSnapshot(`
              "Based on the code snippets you've shared, the files I've seen so far are:

              1. \`src/TestLogger.ts\`
              2. \`src/TestClass.ts\`
              3. \`src/sum.ts\`
              4. \`src/squirrel.ts\`
              5. \`src/multiple-selections.ts\`
              6. \`src/example.test.ts\`
              7. \`src/ChatColumn.tsx\`
              8. \`src/animal.ts\`
              9. \`src/trickyLogic.ts\`"
            `)
        }, 30_000)

        it('commands/custom, chat command, adds argument', async () => {
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            await client.openFile(animalUri)
            const result = (await client.request('commands/custom', {
                key: '/translate Python',
            })) as CustomChatCommandResult
            expect(result.type).toBe('chat')
            const lastMessage = await client.firstNonEmptyTranscript(result?.chatResult as string)
            expect(trimEndOfLine(lastMessage.messages.at(-1)?.text ?? '')).toMatchInlineSnapshot(
                `
              "In Python, the equivalent of an interface is an abstract base class (ABC). Here's how you can translate the provided TypeScript code to Python:

              \`\`\`python
              from abc import ABC, abstractmethod

              class Animal(ABC):
                  @property
                  @abstractmethod
                  def name(self) -> str:
                      pass

                  @abstractmethod
                  def make_animal_sound(self) -> str:
                      pass

                  @property
                  @abstractmethod
                  def is_mammal(self) -> bool:
                      pass
              \`\`\`

              Explanation:

              1. We import the \`ABC\` (Abstract Base Class) and \`abstractmethod\` decorators from the \`abc\` module.
              2. We define an abstract base class named \`Animal\` that inherits from \`ABC\`.
              3. The \`@property\` and \`@abstractmethod\` decorators are used to declare abstract properties and methods, respectively.
              4. The \`name\` and \`is_mammal\` are defined as abstract properties, while \`make_animal_sound\` is defined as an abstract method.
              5. All methods and properties in the abstract base class are meant to be overridden by concrete subclasses.

              In Python, abstract classes cannot be instantiated directly. Instead, you need to create concrete subclasses that implement the abstract methods and properties defined in the abstract base class.

              Here's an example of a concrete subclass that implements the \`Animal\` abstract base class:

              \`\`\`python
              class Dog(Animal):
                  def __init__(self, name: str):
                      self._name = name
                      self._is_mammal = True

                  @property
                  def name(self) -> str:
                      return self._name

                  @property
                  def is_mammal(self) -> bool:
                      return self._is_mammal

                  def make_animal_sound(self) -> str:
                      return "Woof!"
              \`\`\`

              In this example, the \`Dog\` class inherits from \`Animal\` and provides concrete implementations for all the abstract methods and properties defined in the \`Animal\` abstract base class."
            `,
                explainPollyError
            )
        }, 30_000)

        it('commands/custom, chat command, no context', async () => {
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            await client.openFile(animalUri)
            const result = (await client.request('commands/custom', {
                key: '/none',
            })) as CustomChatCommandResult
            expect(result.type).toBe('chat')
            const lastMessage = await client.firstNonEmptyTranscript(result.chatResult as string)
            expect(trimEndOfLine(lastMessage.messages.at(-1)?.text ?? '')).toMatchInlineSnapshot(
                `"no"`,
                explainPollyError
            )
        }, 30_000)

        // The context files are presented in an order in the CI that is different
        // than the order shown in recordings when on Windows, causing it to fail.
        it('commands/custom, chat command, current directory context', async () => {
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            await client.openFile(animalUri)
            const result = (await client.request('commands/custom', {
                key: '/countDirFiles',
            })) as CustomChatCommandResult
            expect(result.type).toBe('chat')
            const lastMessage = await client.firstNonEmptyTranscript(result.chatResult as string)
            const reply = trimEndOfLine(lastMessage.messages.at(-1)?.text ?? '')
            expect(reply).not.includes('.cody/ignore') // file that's not located in the src/directory
            expect(reply).toMatchInlineSnapshot(
                `"You have shared code contexts from 9 different files."`,
                explainPollyError
            )
        }, 30_000)

        it('commands/custom, edit command, insert mode', async () => {
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            await client.openFile(sumUri, { removeCursor: false })
            const result = (await client.request('commands/custom', {
                key: '/hello',
            })) as CustomEditCommandResult
            expect(result.type).toBe('edit')
            await client.taskHasReachedAppliedPhase(result.editResult as EditTask)

            const originalDocument = client.workspace.getDocument(sumUri)!
            expect(trimEndOfLine(originalDocument.getText())).toMatchInlineSnapshot(
                `
              "// hello
              export function sum(a: number, b: number): number {
                  /* CURSOR */
              }
              "
            `,
                explainPollyError
            )
        }, 30_000)

        it('commands/custom, edit command, edit mode', async () => {
            await client.request('command/execute', {
                command: 'cody.search.index-update',
            })
            await client.openFile(animalUri)

            const result = (await client.request('commands/custom', {
                key: '/newField',
            })) as CustomEditCommandResult
            expect(result.type).toBe('edit')
            await client.taskHasReachedAppliedPhase(result.editResult as EditTask)

            const originalDocument = client.workspace.getDocument(animalUri)!
            expect(trimEndOfLine(originalDocument.getText())).toMatchInlineSnapshot(`
              "export interface Animal {
                  name: string
                  makeAnimalSound(): string
                  isMammal: boolean
                  logName(): void {
                      console.log(this.name);
                  }
              }

              "
            `)
        }, 30_000)
    })

    describe('Progress bars', () => {
        it('progress/report', async () => {
            const { result } = await client.request('testing/progress', {
                title: 'Susan',
            })
            expect(result).toStrictEqual('Hello Susan')
            let progressID: string | undefined
            for (const message of client.progressMessages) {
                if (
                    message.method === 'progress/start' &&
                    message.message.options.title === 'testing/progress'
                ) {
                    progressID = message.message.id
                    break
                }
            }
            assert(progressID !== undefined, JSON.stringify(client.progressMessages))
            const messages = client.progressMessages
                .filter(message => message.id === progressID)
                .map(({ method, message }) => [method, { ...message, id: 'THE_ID' }])
            expect(messages).toMatchInlineSnapshot(`
              [
                [
                  "progress/start",
                  {
                    "id": "THE_ID",
                    "options": {
                      "cancellable": true,
                      "location": "Notification",
                      "title": "testing/progress",
                    },
                  },
                ],
                [
                  "progress/report",
                  {
                    "id": "THE_ID",
                    "message": "message1",
                  },
                ],
                [
                  "progress/report",
                  {
                    "id": "THE_ID",
                    "increment": 50,
                  },
                ],
                [
                  "progress/report",
                  {
                    "id": "THE_ID",
                    "increment": 50,
                  },
                ],
                [
                  "progress/end",
                  {
                    "id": "THE_ID",
                  },
                ],
              ]
            `)
        })

        it('progress/cancel', async () => {
            const disposable = client.progressStartEvents.event(params => {
                if (params.options.title === 'testing/progressCancelation') {
                    client.notify('progress/cancel', { id: params.id })
                }
            })
            try {
                const { result } = await client.request('testing/progressCancelation', {
                    title: 'Leona',
                })
                expect(result).toStrictEqual("request with title 'Leona' cancelled")
            } finally {
                disposable.dispose()
            }
        })
    })

    describe('RateLimitedAgent', () => {
        const rateLimitedClient = TestClient.create({
            workspaceRootUri: workspace.rootUri,
            name: 'rateLimitedClient',
            credentials: TESTING_CREDENTIALS.dotcomProUserRateLimited,
        })
        // Initialize inside beforeAll so that subsequent tests are skipped if initialization fails.
        beforeAll(async () => {
            const serverInfo = await rateLimitedClient.initialize()

            expect(serverInfo.authStatus?.isLoggedIn).toBeTruthy()
            expect(serverInfo.authStatus?.username).toStrictEqual('david.veszelovszki')
        }, 10_000)

        it('chat/submitMessage (RateLimitError)', async () => {
            const lastMessage = await rateLimitedClient.sendSingleMessageToNewChat('sqrt(9)')
            // Intentionally not a snapshot assertion because we should never
            // automatically update 'RateLimitError' to become another value.
            expect(lastMessage?.error?.name).toStrictEqual('RateLimitError')
        }, 30_000)

        afterAll(async () => {
            await rateLimitedClient.shutdownAndExit()
            // Long timeout because to allow Polly.js to persist HTTP recordings
        }, 30_000)
    })

    describe('Enterprise', () => {
        const demoEnterpriseClient = TestClient.create({
            workspaceRootUri: workspace.rootUri,
            name: 'enterpriseClient',
            credentials: TESTING_CREDENTIALS.enterprise,
            logEventMode: 'connected-instance-only',
        })
        // Initialize inside beforeAll so that subsequent tests are skipped if initialization fails.
        beforeAll(async () => {
            const serverInfo = await demoEnterpriseClient.initialize()

            expect(serverInfo.authStatus?.isLoggedIn).toBeTruthy()
            expect(serverInfo.authStatus?.username).toStrictEqual('codytesting')
        }, 10_000)

        it('chat/submitMessage', async () => {
            const lastMessage = await demoEnterpriseClient.sendSingleMessageToNewChat('Reply with "Yes"')
            expect(lastMessage?.text?.trim()).toStrictEqual('Yes')
        }, 20_000)

        checkDocumentCommand(
            demoEnterpriseClient,
            'commands/document (enterprise client)',
            'example.test.ts',
            obtained =>
                expect(obtained).toMatchInlineSnapshot(
                    `
              "import { expect } from 'vitest'
              import { it } from 'vitest'
              import { describe } from 'vitest'

              /**
               * Test block for example functionality
               *
               * This test block contains three test cases:
               * - "does 1": Verifies that true is equal to true
               * - "does 2": Verifies that true is equal to true
               * - "does something else": Currently incomplete test case that will error due to incorrect usage of \`performance.now\`
               */
              describe('test block', () => {
                  it('does 1', () => {
                      expect(true).toBe(true)
                  })

                  it('does 2', () => {
                      expect(true).toBe(true)
                  })

                  it('does something else', () => {
                      // This line will error due to incorrect usage of \`performance.now\`
                      const startTime = performance.now(/* CURSOR */)
                  })
              })
              "
            `,
                    explainPollyError
                )
        )

        // NOTE(olafurpg) disabled on Windows because the multi-repo keyword
        // query is not replaying on Windows due to some platform-dependency on
        // how the HTTP request is constructed. I manually tested multi-repo on
        // a Windows computer to confirm that it does work as expected.
        it.skipIf(isWindows())(
            'chat/submitMessage (addEnhancedContext: true, multi-repo test)',
            async () => {
                const id = await demoEnterpriseClient.request('chat/new', null)
                const { repos } = await demoEnterpriseClient.request('graphql/getRepoIds', {
                    names: ['github.com/sourcegraph/sourcegraph'],
                    first: 1,
                })
                await demoEnterpriseClient.request('webview/receiveMessage', {
                    id,
                    message: {
                        command: 'context/choose-remote-search-repo',
                        explicitRepos: repos,
                    },
                })
                const { lastMessage, transcript } =
                    await demoEnterpriseClient.sendSingleMessageToNewChatWithFullTranscript(
                        'What is Squirrel?',
                        {
                            id,
                            addEnhancedContext: true,
                        }
                    )

                expect(lastMessage?.text ?? '').includes('code intelligence')
                expect(lastMessage?.text ?? '').includes('tree-sitter')

                const contextUris: URI[] = []
                for (const message of transcript.messages) {
                    for (const file of message.contextFiles ?? []) {
                        if (file.type === 'file') {
                            file.uri = URI.from(file.uri)
                            contextUris.push(file.uri)
                        }
                    }
                }
                const paths = contextUris.map(uri => uri.path.split('/-/blob/').at(1) ?? '').sort()
                expect(paths).includes('cmd/symbols/squirrel/README.md')

                const { remoteRepos } = await demoEnterpriseClient.request('chat/remoteRepos', { id })
                expect(remoteRepos).toStrictEqual(repos)
            },
            30_000
        )

        it('remoteRepo/list', async () => {
            // List a repo without a query
            let repos: Requests['remoteRepo/list'][1]
            do {
                repos = await demoEnterpriseClient.request('remoteRepo/list', {
                    query: undefined,
                    first: 10,
                })
            } while (repos.state.state === 'fetching')
            expect(repos.repos).toHaveLength(10)

            // Make a paginated query.
            const secondLastRepo = repos.repos.at(-2)
            const moreRepos = await demoEnterpriseClient.request('remoteRepo/list', {
                query: undefined,
                first: 2,
                afterId: secondLastRepo?.id,
            })
            expect(moreRepos.repos[0].id).toBe(repos.repos.at(-1)?.id)

            // Make a query.
            const filteredRepos = await demoEnterpriseClient.request('remoteRepo/list', {
                query: 'sourceco',
                first: 1000,
            })
            expect(
                filteredRepos.repos.find(repo => repo.name === 'github.com/sourcegraph/cody')
            ).toBeDefined()
        })

        it('remoteRepo/has', async () => {
            // Query a repo that does exist.
            const codyRepoExists = await demoEnterpriseClient.request('remoteRepo/has', {
                repoName: 'github.com/sourcegraph/cody',
            })
            expect(codyRepoExists.result).toBe(true)

            // Query a repo that does not exist.
            const codyForDos = await demoEnterpriseClient.request('remoteRepo/has', {
                repoName: 'github.com/sourcegraph/cody-edlin',
            })
            expect(codyForDos.result).toBe(false)
        })

        afterAll(async () => {
            const { requests } = await demoEnterpriseClient.request('testing/networkRequests', null)
            const nonServerInstanceRequests = requests
                .filter(({ url }) => !url.startsWith(demoEnterpriseClient.serverEndpoint))
                .map(({ url }) => url)
            expect(JSON.stringify(nonServerInstanceRequests)).toStrictEqual('[]')
            await demoEnterpriseClient.shutdownAndExit()
            // Long timeout because to allow Polly.js to persist HTTP recordings
        }, 30_000)
    })

    // Enterprise tests are run at demo instance, which is at a recent release version.
    // Use this section if you need to run against S2 which is released continuously.
    describe('Enterprise - close main branch', () => {
        const s2EnterpriseClient = TestClient.create({
            workspaceRootUri: workspace.rootUri,
            name: 'enterpriseMainBranchClient',
            credentials: TESTING_CREDENTIALS.s2,
            logEventMode: 'connected-instance-only',
        })

        // Initialize inside beforeAll so that subsequent tests are skipped if initialization fails.
        beforeAll(async () => {
            const serverInfo = await s2EnterpriseClient.initialize({
                autocompleteAdvancedProvider: 'fireworks',
            })

            expect(serverInfo.authStatus?.isLoggedIn).toBeTruthy()
            expect(serverInfo.authStatus?.username).toStrictEqual('codytesting')
        }, 10_000)

        // Disabled because `attribution/search` GraphQL does not work on S2
        // See https://sourcegraph.slack.com/archives/C05JDP433DL/p1714017586160079
        it.skip('attribution/found', async () => {
            const id = await s2EnterpriseClient.request('chat/new', null)
            const { repoNames, error } = await s2EnterpriseClient.request('attribution/search', {
                id,
                snippet: 'sourcegraph.Location(new URL',
            })
            expect(repoNames).not.empty
            expect(error).null
        }, 20_000)

        it('attribution/not found', async () => {
            const id = await s2EnterpriseClient.request('chat/new', null)
            const { repoNames, error } = await s2EnterpriseClient.request('attribution/search', {
                id,
                snippet: 'sourcegraph.Location(new LRU',
            })
            expect(repoNames).empty
            expect(error).null
        }, 20_000)

        // Use S2 instance for Cody Ignore enterprise tests
        describe('Cody Ignore for enterprise', () => {
            it('testing/ignore/overridePolicy', async () => {
                const onChangeCallback = vi.fn()

                // `sumUri` is located inside of the github.com/sourcegraph/cody repo.
                const ignoreTest = () =>
                    s2EnterpriseClient.request('ignore/test', { uri: sumUri.toString() })
                s2EnterpriseClient.registerNotification('ignore/didChange', onChangeCallback)

                expect(await ignoreTest()).toStrictEqual({ policy: 'use' })

                await s2EnterpriseClient.request('testing/ignore/overridePolicy', {
                    include: [{ repoNamePattern: '' }],
                    exclude: [{ repoNamePattern: '.*sourcegraph/cody.*' }],
                })

                expect(onChangeCallback).toBeCalledTimes(1)
                expect(await ignoreTest()).toStrictEqual({ policy: 'ignore' })

                await s2EnterpriseClient.request('testing/ignore/overridePolicy', {
                    include: [{ repoNamePattern: '' }],
                    exclude: [{ repoNamePattern: '.*sourcegraph/sourcegraph.*' }],
                })

                expect(onChangeCallback).toBeCalledTimes(2)
                expect(await ignoreTest()).toStrictEqual({ policy: 'use' })

                await s2EnterpriseClient.request('testing/ignore/overridePolicy', {
                    include: [{ repoNamePattern: '' }],
                    exclude: [{ repoNamePattern: '.*sourcegraph/sourcegraph.*' }],
                })

                // onChangeCallback is not called again because filters are the same
                expect(onChangeCallback).toBeCalledTimes(2)
            })

            // The site config `cody.contextFilters` value on sourcegraph.sourcegraph.com instance
            // should include `sourcegraph/cody` repo for this test to pass.
            it('autocomplete/execute (with Cody Ignore filters)', async () => {
                // Documents to be used as context sources.
                await s2EnterpriseClient.openFile(animalUri)
                await s2EnterpriseClient.openFile(squirrelUri)

                // Document to generate a completion from.
                await s2EnterpriseClient.openFile(sumUri)

                const { items, completionEvent } = await s2EnterpriseClient.request(
                    'autocomplete/execute',
                    {
                        uri: sumUri.toString(),
                        position: { line: 1, character: 3 },
                        triggerKind: 'Invoke',
                    }
                )

                expect(items.length).toBeGreaterThan(0)
                expect(items.map(item => item.insertText)).toMatchInlineSnapshot(
                    `
              [
                "   return a + b",
              ]
            `
                )

                // Two documents will be checked against context filters set in site-config on S2.
                expect(
                    completionEvent?.params.contextSummary?.retrieverStats['jaccard-similarity']
                        .suggestedItems
                ).toEqual(2)

                s2EnterpriseClient.notify('autocomplete/completionAccepted', {
                    completionID: items[0].id,
                })
            }, 10_000)
        })

        afterAll(async () => {
            await s2EnterpriseClient.shutdownAndExit()
            // Long timeout because to allow Polly.js to persist HTTP recordings
        }, 30_000)
    })

    afterAll(async () => {
        await workspace.afterAll()
        await client.shutdownAndExit()
        // Long timeout because to allow Polly.js to persist HTTP recordings
    }, 30_000)
})
