import {
    type CodyCommand,
    type ContextItem,
    featureFlagProvider,
    isFileURI,
} from '@sourcegraph/cody-shared'

import * as vscode from 'vscode'
import { CodyCommandMenuItems } from '..'
import { TreeViewProvider } from '../../services/tree-views/TreeViewProvider'
import { getContextFileFromGitLog } from '../context/git-log'
import { getContextFileFromShell } from '../context/shell'
import { showCommandMenu } from '../menus'
import type { CodyCommandArgs } from '../types'
import { getDefaultCommandsMap } from '../utils/get-commands'
import { CustomCommandsManager, openCustomCommandDocsLink } from './custom-commands'

const vscodeDefaultCommands = getDefaultCommandsMap(CodyCommandMenuItems as CodyCommand[])

/**
 * Provides management and interaction capabilities for both default and custom Cody commands.
 *
 * It is responsible for initializing, grouping, and refreshing command sets,
 * as well as handling command menus and execution.
 */
export class CommandsProvider implements vscode.Disposable {
    private disposables: vscode.Disposable[] = []
    protected readonly defaultCommands = vscodeDefaultCommands
    public treeViewProvider = new TreeViewProvider('command', featureFlagProvider)
    protected customCommandsStore = new CustomCommandsManager(this.treeViewProvider)

    // The commands grouped with default commands and custom commands
    private allCommands = new Map<string, CodyCommand>()

    constructor() {
        this.disposables.push(this.customCommandsStore)
        // adds the default commands to the all commands map
        this.groupCommands(this.defaultCommands)

        // Cody Command Menus
        this.disposables.push(
            vscode.commands.registerCommand('cody.menu.commands', a => this?.menu('default', a)),
            vscode.commands.registerCommand('cody.menu.custom-commands', a => this?.menu('custom', a)),
            vscode.commands.registerCommand('cody.menu.commands-settings', a => this?.menu('config', a)),
            vscode.commands.registerCommand('cody.commands.open.doc', () => openCustomCommandDocsLink()),
            // Update the custom commands when the tree view is refreshed
            this.treeViewProvider.onDidChangeTreeData(() => this.getCustomCommands())
        )

        this.customCommandsStore.init()
        this.refresh()
    }

    private async menu(type: 'custom' | 'config' | 'default', args?: CodyCommandArgs): Promise<void> {
        const customCommands = await this.getCustomCommands()
        const commandArray = [...customCommands].map(command => command[1])
        if (type === 'custom' && !commandArray.length) {
            return showCommandMenu('config', commandArray, args)
        }

        await showCommandMenu(type, commandArray, args)
    }

    /**
     * Find a command by its id
     */
    public get(id: string): CodyCommand | undefined {
        return this.allCommands.get(id)
    }

    protected async getCustomCommands(): Promise<Map<string, CodyCommand>> {
        const commands = this.customCommandsStore.commands
        this.groupCommands(commands)
        return commands
    }

    /**
     * Group the default commands with the custom commands and add a separator
     */
    protected groupCommands(customCommands = new Map<string, CodyCommand>()): void {
        const defaultCommands = [...this.defaultCommands]
        const combinedMap = new Map([...defaultCommands])
        // Add the custom commands to the all commands map
        this.allCommands = new Map([...customCommands, ...combinedMap].sort())
    }

    /**
     * Refresh the custom commands from store before combining with default commands
     */
    protected async refresh(): Promise<void> {
        const { commands } = await this.customCommandsStore.refresh()
        this.groupCommands(commands)
    }

    /**
     * Gets the context file content from executing a shell command.
     * Used for retreiving context for the command field in custom command
     */
    public async runShell(shell: string): Promise<ContextItem[]> {
        return getContextFileFromShell(shell)
    }

    /**
     * History returns the context for how a file changed. Locally this is
     * implemented as git log.
     */
    public async history(
        uri: vscode.Uri,
        options: {
            /**
             * Uses git log's -L:<funcname>:<file> traces the evolution of the
             * function name regex <funcname>, within the <file>. This relies on
             * reasonable heuristics built into git to find function bodies.
             * However, the heuristics often fail so we should switch to computing
             * the line region ourselves.
             * https://git-scm.com/docs/git-log#Documentation/git-log.txt--Lltfuncnamegtltfilegt
             */
            funcname: string
            /**
             * Limit the amount of commits to maxCount.
             */
            maxCount: number
        }
    ): Promise<ContextItem[]> {
        if (!isFileURI(uri)) {
            throw new Error('history only supported on local file paths')
        }
        return getContextFileFromGitLog(uri, options)
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
        this.disposables = []
    }
}
