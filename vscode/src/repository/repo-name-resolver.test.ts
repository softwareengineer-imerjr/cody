import { afterEach, describe, expect, it, vi } from 'vitest'

import { AUTH_STATUS_FIXTURE_AUTHED, DOTCOM_URL, EMPTY, graphqlClient } from '@sourcegraph/cody-shared'

import { type AuthProvider, authProvider } from '../services/AuthProvider'

import * as gitExtensionAPI from './git-extension-api'
import { RepoNameResolver } from './repo-name-resolver'
import { mockFsCalls } from './test-helpers'

describe('getRepoNamesFromWorkspaceUri', () => {
    afterEach(() => {
        authProvider.instance = null
    })
    it('resolves the repo name using graphql for enterprise accounts', async () => {
        const repoNameResolver = new RepoNameResolver()
        authProvider.instance = {
            changes: EMPTY,
            status: {
                ...AUTH_STATUS_FIXTURE_AUTHED,
                authenticated: true,
                endpoint: 'https://example.com',
            },
        } as Pick<AuthProvider, 'changes' | 'status'> as unknown as AuthProvider
        repoNameResolver.init()

        vi.spyOn(gitExtensionAPI, 'gitRemoteUrlsFromGitExtension').mockReturnValue([
            'git@github.com:sourcegraph/cody.git',
        ])

        const { fileUri } = mockFsCalls({
            filePath: '/repo/submodule/foo.ts',
            gitRepoPath: '/repo',
            gitConfig: `
                [core]
                    repositoryformatversion = 0
                    filemode = true
                [remote "origin"]
                    url = https://github.com/sourcegraph/cody.git
                    fetch = +refs/heads/*:refs/remotes/origin/*
            `,
        })

        const getRepoNameGraphQLMock = vi
            .spyOn(graphqlClient, 'getRepoName')
            .mockResolvedValue('sourcegraph/cody')

        expect(await repoNameResolver.getRepoNamesFromWorkspaceUri(fileUri)).toEqual([
            'sourcegraph/cody',
        ])
        expect(getRepoNameGraphQLMock).toBeCalledTimes(1)
    })

    it('resolves the repo name using local conversion function for PLG accounts', async () => {
        const repoNameResolver = new RepoNameResolver()
        authProvider.instance = {
            changes: EMPTY,
            status: {
                ...AUTH_STATUS_FIXTURE_AUTHED,
                authenticated: true,
                endpoint: DOTCOM_URL.toString(),
            },
        } as Pick<AuthProvider, 'changes' | 'status'> as unknown as AuthProvider
        repoNameResolver.init()

        vi.spyOn(gitExtensionAPI, 'gitRemoteUrlsFromGitExtension').mockReturnValue([
            'git@github.com:sourcegraph/cody.git',
        ])

        const { fileUri } = mockFsCalls({
            filePath: '/repo/submodule/foo.ts',
            gitRepoPath: '/repo',
            gitConfig: `
                [core]
                    repositoryformatversion = 0
                    filemode = true
                [remote "origin"]
                    url = https://github.com/sourcegraph/cody.git
                    fetch = +refs/heads/*:refs/remotes/origin/*
            `,
        })

        const getRepoNameGraphQLMock = vi
            .spyOn(graphqlClient, 'getRepoName')
            .mockResolvedValue('sourcegraph/cody')

        expect(await repoNameResolver.getRepoNamesFromWorkspaceUri(fileUri)).toEqual([
            'github.com/sourcegraph/cody',
        ])
        expect(getRepoNameGraphQLMock).not.toBeCalled()
    })
})
