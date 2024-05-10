import * as vscode from 'vscode'

import {
    BotResponseMultiplexer,
    type ChatMessage,
    type CompletionParameters,
    type EditModel,
    type Message,
    ModelProvider,
    PromptString,
    TokenCounter,
    getSimplePreamble,
    ps,
} from '@sourcegraph/cody-shared'

import type { VSCodeEditor } from '../../editor/vscode-editor'
import type { FixupTask } from '../../non-stop/FixupTask'
import type { EditIntent } from '../types'

import { PromptBuilder } from '../../prompt-builder'
import { getContext } from './context'
import { claude } from './models/claude'
import { openai } from './models/openai'
import type { EditLLMInteraction, GetLLMInteractionOptions, LLMInteraction } from './type'

const INTERACTION_MODELS: Record<EditModel, EditLLMInteraction> = {
    'anthropic/claude-3-opus-20240229': claude,
    'anthropic/claude-3-sonnet-20240229': claude,
    'anthropic/claude-3-haiku-20240307': claude,
    'openai/gpt-3.5-turbo': openai,
    'openai/gpt-4-turbo': openai,
} as const

const getInteractionArgsFromIntent = (
    intent: EditIntent,
    model: EditModel,
    options: GetLLMInteractionOptions
): LLMInteraction => {
    // Default to the generic Claude prompt if the model is unknown
    const interaction = INTERACTION_MODELS[model] || claude
    switch (intent) {
        case 'add':
            return interaction.getAdd(options)
        case 'fix':
            return interaction.getFix(options)
        case 'doc':
            return interaction.getDoc(options)
        case 'edit':
            return interaction.getEdit(options)
        case 'test':
            return interaction.getTest(options)
    }
}

interface BuildInteractionOptions {
    model: EditModel
    codyApiVersion: number
    contextWindow: number
    task: FixupTask
    editor: VSCodeEditor
}

interface BuiltInteraction extends Pick<CompletionParameters, 'stopSequences'> {
    messages: Message[]
    responseTopic: string
    responsePrefix?: string
}

export const buildInteraction = async ({
    model,
    codyApiVersion,
    contextWindow,
    task,
    editor,
}: BuildInteractionOptions): Promise<BuiltInteraction> => {
    const document = await vscode.workspace.openTextDocument(task.fixupFile.uri)
    const precedingText = PromptString.fromDocumentText(
        document,
        new vscode.Range(
            task.selectionRange.start.translate({
                lineDelta: -Math.min(task.selectionRange.start.line, 50),
            }),
            task.selectionRange.start
        )
    )
    const selectedText = PromptString.fromDocumentText(document, task.selectionRange)
    const tokenCount = TokenCounter.countPromptString(selectedText)
    if (tokenCount > contextWindow) {
        throw new Error("The amount of text selected exceeds Cody's current capacity.")
    }
    task.original = selectedText.toString()
    const followingText = PromptString.fromDocumentText(
        document,
        new vscode.Range(task.selectionRange.end, task.selectionRange.end.translate({ lineDelta: 50 }))
    )
    const { prompt, responseTopic, stopSequences, assistantText, assistantPrefix } =
        getInteractionArgsFromIntent(task.intent, model, {
            uri: task.fixupFile.uri,
            followingText,
            precedingText,
            selectedText,
            instruction: task.instruction,
            document,
        })
    const promptBuilder = new PromptBuilder(ModelProvider.getContextWindowByID(model))

    const preamble = getSimplePreamble(model, codyApiVersion, prompt.system)
    promptBuilder.tryAddToPrefix(preamble)

    // Add pre-instruction for edit commands to end of human prompt to override the default
    // prompt. This is used for providing additional information and guidelines by the user.
    const preInstruction = PromptString.fromConfig(
        vscode.workspace.getConfiguration('cody.edit'),
        'preInstruction',
        ps``
    )
    const additionalRule = preInstruction.length > 0 ? ps`\nIMPORTANT: ${preInstruction.trim()}` : ps``

    const transcript: ChatMessage[] = [
        { speaker: 'human', text: prompt.instruction.concat(additionalRule) },
    ]
    if (assistantText) {
        transcript.push({ speaker: 'assistant', text: assistantText })
    }
    promptBuilder.tryAddMessages(transcript.reverse())

    const contextItemsAndMessages = await getContext({
        intent: task.intent,
        uri: task.fixupFile.uri,
        selectionRange: task.selectionRange,
        userContextItems: task.userContextItems,
        editor,
        followingText,
        precedingText,
        selectedText,
    })
    await promptBuilder.tryAddContext('user', contextItemsAndMessages)

    return {
        messages: promptBuilder.build(),
        stopSequences,
        responseTopic: responseTopic?.toString() || BotResponseMultiplexer.DEFAULT_TOPIC,
        responsePrefix: assistantPrefix?.toString(),
    }
}
