import * as vscode from 'vscode'

import { type Configuration, DOTCOM_URL } from '@sourcegraph/cody-shared'

import { telemetryRecorder } from '@sourcegraph/cody-shared'
import type { View } from '../../../webviews/NavBar'
import type { startTokenReceiver } from '../../auth/token-receiver'
import { logDebug } from '../../log'
import type { AuthProvider } from '../../services/AuthProvider'
import { AuthProviderSimplified } from '../../services/AuthProviderSimplified'
import { telemetryService } from '../../services/telemetry'
import { openExternalLinks } from '../../services/utils/workspace-action'
import type { ContextProvider } from '../ContextProvider'
import type { MessageErrorType, MessageProviderOptions } from '../MessageProvider'
import type { ExtensionMessage, WebviewMessage } from '../protocol'

import {
    closeAuthProgressIndicator,
    startAuthProgressIndicator,
} from '../../auth/auth-progress-indicator'
import { addWebviewViewHTML } from './ChatManager'

export interface SidebarChatWebview extends Omit<vscode.Webview, 'postMessage'> {
    postMessage(message: ExtensionMessage): Thenable<boolean>
}

export interface SidebarViewOptions extends MessageProviderOptions {
    extensionUri: vscode.Uri
    startTokenReceiver?: typeof startTokenReceiver
    config: Pick<Configuration, 'isRunningInsideAgent'>
}

export class SidebarViewController implements vscode.WebviewViewProvider {
    private extensionUri: vscode.Uri
    public webview?: SidebarChatWebview

    private disposables: vscode.Disposable[] = []

    private authProvider: AuthProvider
    private readonly contextProvider: ContextProvider
    private startTokenReceiver?: typeof startTokenReceiver

    constructor({ extensionUri, ...options }: SidebarViewOptions) {
        this.authProvider = options.authProvider
        this.contextProvider = options.contextProvider
        this.extensionUri = extensionUri
        this.startTokenReceiver = options.startTokenReceiver
    }

    private async onDidReceiveMessage(message: WebviewMessage): Promise<void> {
        switch (message.command) {
            case 'ready':
                await this.contextProvider.syncAuthStatus()
                break
            case 'initialized':
                logDebug('SidebarViewController:onDidReceiveMessage', 'initialized')
                await this.setWebviewView('chat')
                await this.contextProvider.init()
                break
            case 'auth': {
                if (message.authKind === 'callback' && message.endpoint) {
                    this.authProvider.redirectToEndpointLogin(message.endpoint)
                    break
                }
                if (message.authKind === 'simplified-onboarding') {
                    const endpoint = DOTCOM_URL.href

                    let tokenReceiverUrl: string | undefined = undefined
                    closeAuthProgressIndicator()
                    startAuthProgressIndicator()
                    tokenReceiverUrl = await this.startTokenReceiver?.(
                        endpoint,
                        async (token, endpoint) => {
                            closeAuthProgressIndicator()
                            const authStatus = await this.authProvider.auth({ endpoint, token })
                            telemetryService.log(
                                'CodyVSCodeExtension:auth:fromTokenReceiver',
                                {
                                    type: 'callback',
                                    from: 'web',
                                    success: Boolean(authStatus?.isLoggedIn),
                                },
                                {
                                    hasV2Event: true,
                                }
                            )
                            telemetryRecorder.recordEvent(
                                'cody.auth.fromTokenReceiver.web',
                                'succeeded',
                                {
                                    metadata: {
                                        success: authStatus?.isLoggedIn ? 1 : 0,
                                    },
                                }
                            )
                            if (!authStatus?.isLoggedIn) {
                                void vscode.window.showErrorMessage(
                                    'Authentication failed. Please check your token and try again.'
                                )
                            }
                        }
                    )

                    const authProviderSimplified = new AuthProviderSimplified()
                    const authMethod = message.authMethod || 'dotcom'
                    const successfullyOpenedUrl = await authProviderSimplified.openExternalAuthUrl(
                        this.authProvider,
                        authMethod,
                        tokenReceiverUrl
                    )
                    if (!successfullyOpenedUrl) {
                        closeAuthProgressIndicator()
                    }
                    break
                }
                // cody.auth.signin or cody.auth.signout
                await vscode.commands.executeCommand(`cody.auth.${message.authKind}`)
                break
            }
            case 'event':
                telemetryService.log(message.eventName, message.properties)
                break
            case 'links':
                void openExternalLinks(message.value)
                break
            case 'simplified-onboarding':
                if (message.onboardingKind === 'web-sign-in-token') {
                    void vscode.window
                        .showInputBox({ prompt: 'Enter web sign-in token' })
                        .then(async token => {
                            if (!token) {
                                return
                            }
                            const authStatus = await this.authProvider.auth({
                                endpoint: DOTCOM_URL.href,
                                token,
                            })
                            if (!authStatus?.isLoggedIn) {
                                void vscode.window.showErrorMessage(
                                    'Authentication failed. Please check your token and try again.'
                                )
                            }
                        })
                    break
                }
                break
            case 'show-page':
                await vscode.commands.executeCommand('show-page', message.page)
                break
            case 'troubleshoot/reloadAuth': {
                await this.authProvider.reloadAuthStatus()
                const nextAuth = this.authProvider.getAuthStatus()
                telemetryService.log(
                    'CodyVSCodeExtension:troubleshoot:reloadAuth',
                    {
                        success: Boolean(nextAuth?.isLoggedIn),
                    },
                    {
                        hasV2Event: true,
                    }
                )
                telemetryRecorder.recordEvent('cody.troubleshoot', 'reloadAuth', {
                    metadata: {
                        success: nextAuth.isLoggedIn ? 1 : 0,
                    },
                })
                break
            }
            default:
                this.handleError(new Error('Invalid request type from Webview'), 'system')
        }
    }

    /**
     * Display error message in webview as a banner alongside the chat.
     */
    private handleError(error: Error, type: MessageErrorType): void {
        if (type === 'transcript') {
            // not required for non-chat view
            return
        }
        void this.webview?.postMessage({
            type: 'errors',
            errors: error.toString(),
        })
    }

    /**
     * Set webview view
     */
    private async setWebviewView(view: View): Promise<void> {
        await vscode.commands.executeCommand('cody.chat.focus')
        await this.webview?.postMessage({
            type: 'view',
            view: view,
        })
    }

    /**
     * create webview resources for Auth page
     */
    public async resolveWebviewView(
        webviewView: vscode.WebviewView,

        _context: vscode.WebviewViewResolveContext<unknown>,

        _token: vscode.CancellationToken
    ): Promise<void> {
        this.webview = webviewView.webview
        this.contextProvider.webview = webviewView.webview

        const webviewPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews')
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [webviewPath],
            enableCommandUris: true,
        }

        await addWebviewViewHTML(this.extensionUri, webviewView)

        // Register to receive messages from webview
        this.disposables.push(
            webviewView.webview.onDidReceiveMessage(message => this.onDidReceiveMessage(message))
        )
    }
}
