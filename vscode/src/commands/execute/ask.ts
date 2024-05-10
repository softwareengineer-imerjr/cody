import {
    ConfigFeaturesSingleton,
    type DefaultChatCommands,
    type EventSource,
    type PromptString,
} from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'
import type { ChatSession } from '../../chat/chat-view/SimpleChatPanelProvider'
import type { WebviewSubmitMessage } from '../../chat/protocol'
import { isUriIgnoredByContextFilterWithNotification } from '../../cody-ignore/context-filter'
import { showCodyIgnoreNotification } from '../../cody-ignore/notification'
import { getEditor } from '../../editor/active-editor'

export interface ExecuteChatArguments extends Omit<WebviewSubmitMessage, 'text'> {
    source?: EventSource
    command?: DefaultChatCommands
    text: PromptString
}

/**
 * Wrapper around the `cody.action.chat` command that can be used anywhere but with better type-safety.
 * This is also called by all the default chat commands (e.g. /explain, /smell).
 */
export const executeChat = async (args: ExecuteChatArguments): Promise<ChatSession | undefined> => {
    const { chat, commands } = await ConfigFeaturesSingleton.getInstance().getConfigFeatures()
    const isCommand = Boolean(args.command)
    if ((!isCommand && !chat) || (isCommand && !commands)) {
        void vscode.window.showErrorMessage(
            'This feature has been disabled by your Sourcegraph site admin.'
        )
        return undefined
    }

    const editor = getEditor()
    if (isCommand && editor.ignored) {
        showCodyIgnoreNotification('command', 'cody-ignore')
        return undefined
    }
    if (
        editor.active &&
        (await isUriIgnoredByContextFilterWithNotification(editor.active.document.uri, 'command'))
    ) {
        return
    }

    return vscode.commands.executeCommand<ChatSession | undefined>('cody.action.chat', args)
}
