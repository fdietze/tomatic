
import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage } from './test-helpers';

test.describe('Snippet Management (CRUD)', () => {
    let settingsPage: SettingsPage;

    test.beforeEach(async ({ context, page }) => {
        await mockGlobalApis(context);

        await seedLocalStorage(context, {
            'tomatic-storage': {
                state: { 
                    apiKey: OPENROUTER_API_KEY,
                    snippets: [],
                },
                version: 1,
            },
        });
        
        settingsPage = new SettingsPage(page);
        await settingsPage.goto();
    });

    test('creates a new standard snippet', async () => {
        await settingsPage.createNewSnippet('greet', 'Hello, world!');
        
        await settingsPage.expectSnippetToBeVisible('greet');
        await expect(settingsPage.getSnippetItem('greet')).toHaveText(/Hello, world!/);
    });

    test('updates an existing snippet', async () => {
        await settingsPage.createNewSnippet('my_snippet', 'Initial content');
        await settingsPage.expectSnippetToBeVisible('my_snippet');

        await settingsPage.startEditingSnippet('my_snippet');
        await settingsPage.fillSnippetForm('my_renamed_snippet', 'Updated content');
        await settingsPage.saveSnippet();

        await settingsPage.expectSnippetToNotExist('my_snippet');
        await settingsPage.expectSnippetToBeVisible('my_renamed_snippet');
        await expect(settingsPage.getSnippetItem('my_renamed_snippet')).toHaveText(/Updated content/);
    });

    test('deletes a snippet', async () => {
        await settingsPage.createNewSnippet('to_delete', 'I am temporary');
        await settingsPage.expectSnippetToBeVisible('to_delete');
        
        await settingsPage.deleteSnippet('to_delete');
        
        await settingsPage.expectSnippetToNotExist('to_delete');
    });
});
