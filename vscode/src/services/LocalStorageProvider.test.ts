import { beforeEach, describe, expect, it } from 'vitest'
import type * as vscode from 'vscode'

import {
    type AuthenticatedAuthStatus,
    DOTCOM_URL,
    type UserLocalHistory,
} from '@sourcegraph/cody-shared'

import { localStorage } from './LocalStorageProvider'

describe('LocalStorageProvider', () => {
    // Set up local storage backed by an object.
    let localStorageData: { [key: string]: unknown } = {}
    localStorage.setStorage({
        get: (key: string) => localStorageData[key],
        update: (key: string, value: unknown) => {
            localStorageData[key] = value
            return Promise.resolve()
        },
    } as any as vscode.Memento)

    beforeEach(() => {
        localStorageData = {}
    })

    it('sets and gets chat history', async () => {
        await localStorage.setChatHistory(DUMMY_AUTH_STATUS, {
            chat: { a: { id: 'a', lastInteractionTimestamp: '123', interactions: [] } },
        })

        const loadedHistory = localStorage.getChatHistory(DUMMY_AUTH_STATUS)
        expect(loadedHistory).toEqual<UserLocalHistory>({
            chat: { a: { id: 'a', lastInteractionTimestamp: '123', interactions: [] } },
        })
    })
})

const DUMMY_AUTH_STATUS: AuthenticatedAuthStatus = {
    endpoint: DOTCOM_URL.toString(),
    isFireworksTracingEnabled: false,
    authenticated: true,
    hasVerifiedEmail: true,
    requiresVerifiedEmail: true,
    siteVersion: '1234',
    username: 'uwu',
    userCanUpgrade: false,
    codyApiVersion: 0,
}
