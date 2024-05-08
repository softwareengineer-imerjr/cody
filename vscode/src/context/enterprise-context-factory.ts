import type * as vscode from 'vscode'
import { EnterpriseRepoNameResolver } from '../repository/enterprise-repo-name-resolver'
import { RemoteRepoSearcher } from './remote-repo-searcher'
import { RemoteSearch } from './remote-search'
import { RepoFetcher, type RepoWithoutUrl } from './repo-fetcher'
import { RemoteRepoPicker } from './repo-picker'
import { WorkspaceRepoMapper } from './workspace-repo-mapper'

export class EnterpriseContextFactory implements vscode.Disposable {
    // Only one RemoteRepoPicker can be displayed at once, so we share one
    // instance.
    private readonly fetcher = new RepoFetcher()
    private readonly workspaceRepoMapper = new WorkspaceRepoMapper()
    public readonly repoPicker = new RemoteRepoPicker(this.fetcher, this.workspaceRepoMapper)
    public readonly repoSearcher = new RemoteRepoSearcher(this.fetcher)
    public readonly repoNameResolver = new EnterpriseRepoNameResolver(this.fetcher)

    /**
     * Starts fetching repositories immediately on init.
     */
    constructor() {
        this.fetcher.resume()
    }

    public dispose(): void {
        this.fetcher.dispose()
        this.repoPicker.dispose()
        this.repoSearcher.dispose()
        this.workspaceRepoMapper.dispose()
    }

    public clientConfigurationDidChange(): void {
        this.fetcher.clientConfigurationDidChange()
        this.workspaceRepoMapper.clientConfigurationDidChange()
    }

    // Creates a new RemoteSearch proxy. The RemoteSearch is stateful because
    // it maintains a set of selected repositories to search, so each chat panel
    // should use a separate instance. The returned RemoteSearch does not get
    // configuration updates; this is fine for the SimpleChatPanelProvider
    // client because chats are restarted if the configuration changes.
    public createRemoteSearch(): RemoteSearch {
        return new RemoteSearch()
    }

    // Gets an object that can map codebase repo names into repository IDs on
    // the Sourcegraph remote.
    public getCodebaseRepoIdMapper(): CodebaseRepoIdMapper {
        return this.workspaceRepoMapper
    }
}

// Maps a codebase name to a repo ID on the Sourcegraph remote, or undefined if
// there is none.
export interface CodebaseRepoIdMapper {
    repoForCodebase(codebase: string): Promise<RepoWithoutUrl | undefined>
}
