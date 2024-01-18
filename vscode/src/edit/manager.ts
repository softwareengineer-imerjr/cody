import * as vscode from 'vscode'

import { ConfigFeaturesSingleton, type ChatClient, type ChatEventSource, isDotCom } from '@sourcegraph/cody-shared'

import { type ContextProvider } from '../chat/ContextProvider'
import { type GhostHintDecorator } from '../commands/GhostHintDecorator'
import { getEditor } from '../editor/active-editor'
import { type VSCodeEditor } from '../editor/vscode-editor'
import { FixupController } from '../non-stop/FixupController'
import { type FixupTask } from '../non-stop/FixupTask'
import { type AuthProvider } from '../services/AuthProvider'
import { telemetryService } from '../services/telemetry'
import { telemetryRecorder } from '../services/telemetry-v2'

import { type ExecuteEditArguments } from './execute'
import { EditProvider } from './provider'
import { type EditIntent, type EditMode } from './types'

export interface EditManagerOptions {
    editor: VSCodeEditor
    chat: ChatClient
    contextProvider: ContextProvider
    ghostHintDecorator: GhostHintDecorator
    authProvider: AuthProvider
}

export class EditManager implements vscode.Disposable {
    private controller: FixupController
    private disposables: vscode.Disposable[] = []
    private editProviders = new Map<FixupTask, EditProvider>()

    constructor(public options: EditManagerOptions) {
        const authProvider = this.options.authProvider
        this.controller = new FixupController(authProvider)
        this.disposables.push(
            this.controller,
            vscode.commands.registerCommand(
                'cody.command.edit-code',
                (
                    args: {
                        range?: vscode.Range
                        instruction?: string
                        intent?: EditIntent
                        document?: vscode.TextDocument
                        mode?: EditMode
                    },
                    source?: ChatEventSource
                ) => this.executeEdit(args, source)
            )
        )
    }

        public async executeEdit(args: ExecuteEditArguments = {}, source: ChatEventSource = 'editor'): Promise<void> {
        const configFeatures = await ConfigFeaturesSingleton.getInstance().getConfigFeatures()
        if (!configFeatures.commands) {
            void vscode.window.showErrorMessage('This feature has been disabled by your Sourcegraph site admin.')
            return
        }
        const commandEventName = source === 'doc' ? 'doc' : 'edit'
        const authStatus = this.options.authProvider.getAuthStatus()
        telemetryService.log(
            `CodyVSCodeExtension:command:${commandEventName}:executed`,
            { source },
            { hasV2Event: true }
        )
        telemetryRecorder.recordEvent(`cody.command.${commandEventName}`, 'executed', {
            // Flag indicating this is a transcript event to go through ML data pipeline. Only for DotCom users
            // See https://github.com/sourcegraph/sourcegraph/pull/59524
            metadata: {
                recordsPrivateMetadataTranscript: authStatus.endpoint && isDotCom(authStatus.endpoint) ? 1 : 0,
            },
            privateMetadata: { source },
        })

        const editor = getEditor()
        if (editor.ignored) {
            void vscode.window.showInformationMessage('Cannot edit Cody ignored file.')
            return
        }

        const document = args.document || editor.active?.document
        if (!document) {
            void vscode.window.showErrorMessage('Please open a file before running a command.')
            return
        }

        const range = args.range || editor.active?.selection
        if (!range) {
            return
        }

        if (editor.active) {
            // Clear out any active ghost text
            this.options.ghostHintDecorator.clearGhostText(editor.active)
        }

        const task = args.instruction?.trim()
            ? await this.controller.createTask(
                  document,
                  args.instruction,
                  args.userContextFiles ?? [],
                  range,
                  args.intent,
                  args.mode,
                  source,
                  args.contextMessages
              )
            : await this.controller.promptUserForTask(args, source)
        if (!task) {
            return
        }

        const provider = this.getProviderForTask(task)
        return provider.startEdit()
    }

    public getProviderForTask(task: FixupTask): EditProvider {
        let provider = this.editProviders.get(task)

        if (!provider) {
            provider = new EditProvider({ task, controller: this.controller, ...this.options })
            this.editProviders.set(task, provider)
        }

        return provider
    }

    public removeProviderForTask(task: FixupTask): void {
        const provider = this.editProviders.get(task)

        if (provider) {
            this.editProviders.delete(task)
        }
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
        this.disposables = []
    }
}
