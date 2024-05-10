import { expect } from '@playwright/test'
import * as mockServer from '../fixtures/mock-server'

import {
    expectContextCellCounts,
    getChatPanel,
    getContextCell,
    sidebarExplorer,
    sidebarSignin,
} from './common'
import {
    type DotcomUrlOverride,
    type ExpectedEvents,
    test as baseTest,
    openCustomCommandMenu,
    withPlatformSlashes,
} from './helpers'
import { testGitWorkspace } from './utils/gitWorkspace'

const test = baseTest.extend<DotcomUrlOverride>({ dotcomUrl: mockServer.SERVER_URL })

test.beforeEach(() => {
    mockServer.resetLoggedEvents()
})

test.extend<ExpectedEvents>({
    // list of events we expect this test to log, add to this list as needed
    expectedEvents: [
        'CodyInstalled',
        'CodyVSCodeExtension:codyIgnore:hasFile',
        'CodyVSCodeExtension:Auth:failed',
        'CodyVSCodeExtension:auth:clickOtherSignInOptions',
        'CodyVSCodeExtension:login:clicked',
        'CodyVSCodeExtension:auth:selectSigninMenu',
        'CodyVSCodeExtension:auth:fromToken',
        'CodyVSCodeExtension:Auth:connected',
        'CodyVSCodeExtension:sidebar:custom:clicked',
        'CodyVSCodeExtension:menu:command:custom:clicked',
        'CodyVSCodeExtension:menu:custom:build:clicked',
    ],
    expectedV2Events: [
        // 'cody.extension:installed', // ToDo: Uncomment once this bug is resolved: https://github.com/sourcegraph/cody/issues/3825
        'cody.extension:savedLogin',
        'cody.codyIgnore:hasFile',
        'cody.auth:failed',
        'cody.auth.login:clicked',
        'cody.auth.signin.menu:clicked',
        'cody.auth.login:firstEver',
        'cody.auth.signin.token:clicked',
        'cody.auth:connected',
        'cody.sidebar.custom:clicked',
        'cody.menu.command.custom:clicked',
        'cody.menu.custom.build:clicked',
        'cody.command.custom.build:executed',
        'cody.command.custom:executed',
        'cody.chat-question:submitted',
        'cody.chat-question:executed',
        'cody.chatResponse:noCode',
    ],
})('create a new user command via the custom commands menu', async ({ page, sidebar }) => {
    await sidebarSignin(page, sidebar)

    // Minimize other sidebar items to make room for the command view,
    // else the test will fail because the Custom Command button is not visible
    await expect(page.getByText('Chat alongside your code, attach files,')).toBeVisible()
    await page.getByLabel('Settings & Support Section').click()
    await page.getByLabel('Chats Section').click()

    // Open the File Explorer view from the sidebar
    await sidebarExplorer(page).click()
    // Open the index.html file from the tree view
    await page.getByRole('treeitem', { name: 'index.html' }).locator('a').dblclick()
    // Wait for index.html to fully open
    await page.getByRole('tab', { name: 'index.html' }).hover()

    // Bring the cody sidebar to the foreground
    await page.getByRole('tab', { name: 'Cody', exact: true }).locator('a').click()
    // Click the Custom Commands button in the Sidebar to open the Custom Commands menu
    await page.getByText('Custom Commands', { exact: true }).click()

    const commandName = 'ATestCommand'
    const prompt = 'The test command has been created'

    // Create a new command via menu
    await page.keyboard.type('New Custom Command...')
    await page
        .locator('a')
        .filter({ hasText: /New Custom Command.../ })
        .click()

    // Enter command name
    const commandInputTitle = page.getByText('New Custom Cody Command: Command Name')
    await expect(commandInputTitle).toBeVisible()
    const commandInputBox = page.getByPlaceholder('e.g. spellchecker')
    await commandInputBox.fill(commandName)
    await commandInputBox.press('Enter')

    // Select mode
    const commandModeTitle = page.getByText('New Custom Cody Command: Command Mode')
    await expect(commandModeTitle).toBeVisible()
    // Hit enter to select the first option on the list: 'ask'
    await page.keyboard.press('Enter')

    // Enter prompt
    const promptInputTitle = page.getByText('New Custom Cody Command: Prompt')
    await expect(promptInputTitle).toBeVisible()
    const promptInputBox = page.getByPlaceholder(
        'e.g. Create five different test cases for the selected code'
    )

    await promptInputBox.fill(prompt)
    await promptInputBox.press('Enter')
    // Use default context
    await expect(page.getByText('New Custom Cody Command: Context Options')).toBeVisible()
    await page.keyboard.press('Enter')

    // Save it to workspace settings
    await expect(page.getByText('New Custom Cody Command: Save To…')).toBeVisible()
    await expect(page.getByText('Workspace Settings.vscode/cody.json')).toBeVisible()
    await page.getByText('Workspace Settings.vscode/cody.json').click()

    // The new command shows up in the sidebar and works on clicks
    await expect(page.getByText('New Custom Cody Command: Save To…')).not.toBeVisible()
    await page.getByText('Custom Commands', { exact: true }).hover()
    const treeItem = page.getByRole('treeitem', { name: 'ATestCommand' }).getByLabel('ATestCommand')
    await treeItem.scrollIntoViewIfNeeded()
    await expect(treeItem).toBeVisible()
    await treeItem.click()

    // Confirm the command prompt is displayed in the chat panel on execution
    const chatPanel = page.frameLocator('iframe.webview').last().frameLocator('iframe')
    await expect(chatPanel.getByText(prompt)).toBeVisible()
    // Close the index.html file
    await page.getByRole('tab', { name: 'index.html' }).hover()
    await page.getByLabel('index.html', { exact: true }).getByLabel(/Close/).click()

    // Check if cody.json in the workspace has the new command added
    await sidebarExplorer(page).click()
    await page.getByLabel('.vscode', { exact: true }).hover()
    await page.getByLabel('.vscode', { exact: true }).click()
    await page.getByRole('treeitem', { name: 'cody.json' }).locator('a').hover()
    await page.getByRole('treeitem', { name: 'cody.json' }).locator('a').dblclick()
    await page.getByRole('tab', { name: 'cody.json' }).hover()
    // Click on minimap to scroll to the buttom
    await page.locator('canvas').nth(2).click()
    await page.getByText(commandName).hover()
    await expect(page.getByText(commandName)).toBeVisible()

    // Show the new command in the menu and execute it
    await page.getByRole('tab', { name: 'Cody', exact: true }).locator('a').click()
    await openCustomCommandMenu(page)
    await page.getByText('Cody: Custom Commands (Beta)').hover()
    await expect(page.getByText('Cody: Custom Commands (Beta)')).toBeVisible()
    await page.getByPlaceholder('Search command to run...').click()
    await page.getByPlaceholder('Search command to run...').fill(commandName)
    // The new command should show up in sidebar and on the menu
    expect((await page.getByText(commandName).all()).length).toBeGreaterThan(1)
})

// NOTE: If no custom commands are showing up in the command menu, it might
// indicate a breaking change during the custom command building step.
test.extend<ExpectedEvents>({
    // list of events we expect this test to log, add to this list as needed
    expectedEvents: [
        'CodyVSCodeExtension:auth:clickOtherSignInOptions',
        'CodyVSCodeExtension:login:clicked',
        'CodyVSCodeExtension:auth:selectSigninMenu',
        'CodyVSCodeExtension:auth:fromToken',
        'CodyVSCodeExtension:Auth:connected',
        'CodyVSCodeExtension:menu:command:custom:clicked',
        'CodyVSCodeExtension:command:custom:executed',
        'CodyVSCodeExtension:chat-question:submitted',
        'CodyVSCodeExtension:chat-question:executed',
    ],
    expectedV2Events: [
        // 'cody.extension:installed', // ToDo: Uncomment once this bug is resolved: https://github.com/sourcegraph/cody/issues/3825
        'cody.extension:savedLogin',
        'cody.codyIgnore:hasFile',
        'cody.auth:failed',
        'cody.auth.login:clicked',
        'cody.auth.signin.menu:clicked',
        'cody.auth.login:firstEver',
        'cody.auth.signin.token:clicked',
        'cody.sidebar.custom:clicked',
        'cody.menu.command.custom:clicked',
        'cody.command.custom:executed',
        'cody.chat-question:submitted',
        'cody.chat-question:executed',
        'cody.chatResponse:noCode',
        'cody.ghostText:visible',
    ],
})('execute custom commands with context defined in cody.json', async ({ page, sidebar }) => {
    await sidebarSignin(page, sidebar)

    // Minimize other sidebar items to make room for the command view,
    // else the test will fail because the Custom Command button is not visible
    await expect(page.getByText('Chat alongside your code, attach files,')).toBeVisible()
    await page.getByLabel('Settings & Support Section').click()
    await page.getByLabel('Chats Section').click()

    // Open the File Explorer view from the sidebar
    await sidebarExplorer(page).click()
    await page.getByRole('treeitem', { name: 'index.html' }).locator('a').dblclick()
    // Wait for index.html to fully open
    await page.getByRole('tab', { name: 'index.html' }).hover()

    // Open the chat sidebar to click on the Custom Command option
    // Search for the command defined in cody.json and execute it
    await page.getByRole('tab', { name: 'Cody', exact: true }).locator('a').click()
    await openCustomCommandMenu(page)

    /* Test: context.currentDir with currentDir command */
    await expect(page.getByPlaceholder('Search command to run...')).toBeVisible()
    await page.getByPlaceholder('Search command to run...').fill('currentDir')
    await page.keyboard.press('Enter')

    const chatPanel = page.frameLocator('iframe.webview').last().frameLocator('iframe')

    await expect(chatPanel.getByText('Add four context files from the current directory.')).toBeVisible()
    // Show the current file numbers used as context
    const contextCell = getContextCell(chatPanel)
    await expectContextCellCounts(contextCell, { files: 5 })
    await contextCell.click()
    // Display the context files to confirm no hidden files are included
    await expect(chatPanel.getByRole('link', { name: '.mydotfile:1-2' })).not.toBeVisible()
    await expect(chatPanel.getByRole('link', { name: 'error.ts:1-9' })).toBeVisible()
    await expect(chatPanel.getByRole('link', { name: 'Main.java:1-9' })).toBeVisible()
    await expect(chatPanel.getByRole('link', { name: 'buzz.test.ts:1-12' })).toBeVisible()
    await expect(chatPanel.getByRole('link', { name: 'buzz.ts:1-15' })).toBeVisible()
    await expect(chatPanel.getByRole('link', { name: 'index.html:1-11' })).toBeVisible()

    /* Test: context.filePath with filePath command */
    // Locate the filePath command in the tree view and execute it from there to verify
    // custom commands are working in the sidebar
    await page.getByRole('treeitem', { name: 'filePath' }).locator('a').click()
    await expect(chatPanel.getByText('Add lib/batches/env/var.go as context.')).toBeVisible()
    // Should show 2 files with current file added as context
    await expectContextCellCounts(contextCell, { files: 2 })

    /* Test: context.directory with directory command */

    await openCustomCommandMenu(page)
    await expect(page.getByPlaceholder('Search command to run...')).toBeVisible()
    await page.getByPlaceholder('Search command to run...').click()
    await page.getByPlaceholder('Search command to run...').fill('directory')
    await page.keyboard.press('Enter')
    await expect(chatPanel.getByText('Directory has one context file.')).toBeVisible()
    await expectContextCellCounts(contextCell, { files: 2 })
    await contextCell.click()
    await expect(
        chatPanel.getByRole('link', { name: withPlatformSlashes('lib/batches/env/var.go:1') })
    ).toBeVisible()
    // Click on the file link should open the 'var.go file in the editor
    const chatContext = chatPanel.locator('details').last()
    await chatContext
        .getByRole('link', { name: withPlatformSlashes('lib/batches/env/var.go:1') })
        .click()
    await expect(page.getByRole('tab', { name: 'var.go' })).toBeVisible()

    /* Test: context.openTabs with openTabs command */

    await openCustomCommandMenu(page)
    await expect(page.getByPlaceholder('Search command to run...')).toBeVisible()
    await page.getByPlaceholder('Search command to run...').click()
    await page.getByPlaceholder('Search command to run...').fill('openTabs')
    await page.keyboard.press('Enter')
    await expect(chatPanel.getByText('Open tabs as context.')).toBeVisible()
    // The files from the open tabs should be added as context
    await expectContextCellCounts(contextCell, { files: 2 })
    await contextCell.click()
    await expect(chatContext.getByRole('link', { name: 'index.html:1-11' })).toBeVisible()
    await expect(
        chatContext.getByRole('link', { name: withPlatformSlashes('lib/batches/env/var.go:1') })
    ).toBeVisible()
})

test.extend<ExpectedEvents>({
    // list of events we expect this test to log, add to this list as needed
    expectedEvents: [
        'CodyVSCodeExtension:auth:clickOtherSignInOptions',
        'CodyVSCodeExtension:login:clicked',
        'CodyVSCodeExtension:auth:selectSigninMenu',
        'CodyVSCodeExtension:auth:fromToken',
        'CodyVSCodeExtension:Auth:connected',
        'CodyVSCodeExtension:menu:command:custom:clicked',
        'CodyVSCodeExtension:menu:command:config:clicked',
    ],
    expectedV2Events: [
        // 'cody.extension:installed', // ToDo: Uncomment once this bug is resolved: https://github.com/sourcegraph/cody/issues/3825
        'cody.extension:savedLogin',
        'cody.codyIgnore:hasFile',
        'cody.auth:failed',
        'cody.auth.login:clicked',
        'cody.auth.signin.menu:clicked',
        'cody.auth.login:firstEver',
        'cody.auth.signin.token:clicked',
        'cody.auth:connected',
        'cody.sidebar.custom:clicked',
        'cody.menu.command.custom:clicked',
        'cody.menu.command.config:clicked',
    ],
})('open and delete cody.json from the custom command menu', async ({ page, sidebar }) => {
    await sidebarSignin(page, sidebar)

    // Minimize other sidebar items to make room for the command view,
    // else the test will fail because the Custom Command button is not visible
    await expect(page.getByText('Chat alongside your code, attach files,')).toBeVisible()
    await page.getByLabel('Settings & Support Section').click()
    await page.getByLabel('Chats Section').click()

    // Open the File Explorer view from the sidebar
    await sidebarExplorer(page).click()
    // Check if cody.json exists in the workspace
    await page.getByRole('treeitem', { name: '.vscode' }).locator('a').click()
    await page.getByRole('treeitem', { name: 'cody.json' }).locator('a').dblclick()
    await page.getByRole('tab', { name: 'cody.json' }).hover()

    await page.getByRole('tab', { name: 'Cody', exact: true }).locator('a').click()
    await openCustomCommandMenu(page)

    // Able to open the cody.json file in the editor from the command menu
    await expect(page.getByPlaceholder('Search command to run...')).toBeVisible()
    await page.getByLabel('Configure Custom Commands...', { exact: true }).click()
    await page.locator('a').filter({ hasText: 'Open Workspace Settings (JSON)' }).hover()
    await expect(page.getByRole('button', { name: 'Open or Create Settings File' })).toBeVisible()
    await page.getByRole('button', { name: 'Open or Create Settings File' }).click()

    // Close file.
    const codyJSONFileTab = page.getByRole('tab', { name: 'cody.json' })
    await page.getByRole('tab', { name: 'cody.json' }).hover()
    await expect(codyJSONFileTab).toBeVisible()
    await codyJSONFileTab.getByRole('button', { name: /^Close/ }).click()

    // Check button click to delete the cody.json file from the workspace tree view
    await openCustomCommandMenu(page)
    await expect(page.getByPlaceholder('Search command to run...')).toBeVisible()
    await page.getByLabel('Configure Custom Commands...', { exact: true }).click()
    await page.locator('a').filter({ hasText: 'Open Workspace Settings (JSON)' }).hover()
    await page.getByRole('button', { name: 'Delete Settings File' }).hover()
    await page.getByRole('button', { name: 'Delete Settings File' }).click()
    // Because we have turned off notification, we will need to check the notification center
    // for the deletion-confirmation message.
    await page.getByRole('button', { name: 'Do Not Disturb' }).click()
    await page.getByRole('button', { name: /^Move to / }).click() // Move to trash on Mac and bin on Windows

    // Confirm cody.json has been deleted from workspace
    await sidebarExplorer(page).click()
    await expect(page.getByRole('treeitem', { name: 'cody.json' }).locator('a')).not.toBeVisible()

    // Open the cody.json from User Settings

    // NOTE: This is expected to fail locally if you currently have User commands configured
    await page.waitForTimeout(100)
    await page.getByRole('tab', { name: 'Cody', exact: true }).locator('a').click()
    await openCustomCommandMenu(page)
    await page.locator('a').filter({ hasText: 'Open User Settings (JSON)' }).hover()
    await page.getByRole('button', { name: 'Open or Create Settings File' }).hover()
    await page.getByRole('button', { name: 'Open or Create Settings File' }).click()
    await page.getByRole('tab', { name: 'cody.json, preview' }).hover()
    await expect(page.getByRole('tab', { name: 'cody.json, preview' })).toHaveCount(1)
})

testGitWorkspace('use terminal output as context', async ({ page, sidebar }) => {
    await sidebarSignin(page, sidebar)
    // Open the Source Control View to confirm this is a git workspace
    // Check the change is showing as a Git file in the sidebar
    const sourceControlView = page.getByLabel(/Source Control/).nth(2)
    await sourceControlView.click()
    await page.getByRole('heading', { name: 'Source Control' }).hover()
    await page.getByText('index.js').hover()
    await page.locator('a').filter({ hasText: 'index.js' }).click()

    // Run the custom command that uses terminal output as context
    await page.getByRole('button', { name: 'Cody Commands' }).click()
    const menuInputBox = page.getByPlaceholder('Search for a command or enter your question here...')
    await expect(menuInputBox).toBeVisible()
    await menuInputBox.fill('shellOutput')
    await page.keyboard.press('Enter')

    await expect(menuInputBox).not.toBeVisible()

    // Check the context list to confirm the terminal output is added as file
    const panel = getChatPanel(page)
    const contextCell = getContextCell(panel)
    await expectContextCellCounts(contextCell, { files: 2 })
    await contextCell.click()
    const chatContext = panel.locator('details').last()
    await expect(chatContext.getByRole('link', { name: withPlatformSlashes('/git diff') })).toBeVisible()
})
