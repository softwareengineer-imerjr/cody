import { fetchEventSource } from '@microsoft/fetch-event-source'

import { dependentAbortController } from '../../common/abortController'
import { addCustomUserAgent } from '../graphql/client'

import { contextFiltersProvider } from '../../cody-ignore/context-filters-provider'
import { addClientInfoParams } from '../client-name-version'
import { SourcegraphCompletionsClient } from './client'
import type {
    CompletionCallbacks,
    CompletionParameters,
    Event,
    SerializedCompletionParameters,
} from './types'

export class SourcegraphBrowserCompletionsClient extends SourcegraphCompletionsClient {
    protected async _streamWithCallbacks(
        params: CompletionParameters,
        apiVersion: number,
        cb: CompletionCallbacks,
        signal?: AbortSignal
    ): Promise<void> {
        const serializedParams: SerializedCompletionParameters = {
            ...params,
            messages: await Promise.all(
                params.messages.map(async m => ({
                    ...m,
                    text: await m.text?.toFilteredString(contextFiltersProvider),
                }))
            ),
        }

        const url = new URL(this.completionsEndpoint)
        if (apiVersion >= 1) {
            url.searchParams.append('api-version', '' + apiVersion)
        }
        addClientInfoParams(url.searchParams)

        const abort = dependentAbortController(signal)
        const headersInstance = new Headers(this.config.customHeaders as HeadersInit)
        addCustomUserAgent(headersInstance)
        headersInstance.set('Content-Type', 'application/json; charset=utf-8')
        if (this.config.accessToken) {
            headersInstance.set('Authorization', `token ${this.config.accessToken}`)
        }
        const parameters = new URLSearchParams(window.location.search)
        const trace = parameters.get('trace')
        if (trace) {
            headersInstance.set('X-Sourcegraph-Should-Trace', 'true')
        }
        // Disable gzip compression since the sg instance will start to batch
        // responses afterwards.
        headersInstance.set('Accept-Encoding', 'gzip;q=0')
        fetchEventSource(url.toString(), {
            method: 'POST',
            headers: Object.fromEntries(headersInstance.entries()),
            body: JSON.stringify(serializedParams),
            signal: abort.signal,
            openWhenHidden: isRunningInWebWorker, // otherwise tries to call document.addEventListener
            async onopen(response) {
                if (!response.ok && response.headers.get('content-type') !== 'text/event-stream') {
                    let errorMessage: null | string = null
                    try {
                        errorMessage = await response.text()
                    } catch (error) {
                        // We show the generic error message in this case
                        console.error(error)
                    }
                    const error = new Error(
                        errorMessage === null || errorMessage.length === 0
                            ? `Request failed with status code ${response.status}`
                            : errorMessage
                    )
                    cb.onError(error, response.status)
                    abort.abort()
                    return
                }
            },
            onmessage: message => {
                try {
                    const data: Event = { ...JSON.parse(message.data), type: message.event }
                    this.sendEvents([data], cb)
                } catch (error: any) {
                    cb.onError(error.message)
                    abort.abort()
                    console.error(error)
                    // throw the error for not retrying
                    throw error
                }
            },
            onerror(error) {
                cb.onError(error.message)
                abort.abort()
                console.error(error)
                // throw the error for not retrying
                throw error
            },
        }).catch(error => {
            cb.onError(error.message)
            abort.abort()
            console.error(error)
        })
    }
}

declare const WorkerGlobalScope: never
const isRunningInWebWorker =
    typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope

if (isRunningInWebWorker) {
    // HACK: @microsoft/fetch-event-source tries to call document.removeEventListener, which is not
    // available in a worker.
    ;(self as any).document = { removeEventListener: () => {} }
}
