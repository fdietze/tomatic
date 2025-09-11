import { test } from './fixtures';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, mockGpt } from './test-helpers';
import { SettingsPage } from './pom/SettingsPage';

test.describe('Snippet CRUD', () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ page, context }) => {
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 1 },
    });
    settingsPage = new SettingsPage(page);
    await settingsPage.goto();
  });

  test('creates a new standard snippet', async () => {
    await settingsPage.newSnippetButton.click();
    await settingsPage.getSnippetItemInputs('new').name.fill('test_snippet');
    await settingsPage.getSnippetItemInputs('new').content.fill('Hello, world!');
    await settingsPage.getSnippetItem('new').saveButton.click();

    await expect(settingsPage.getSnippetItem('test_snippet').view).toBeVisible();
    await expect(settingsPage.getSnippetItem('test_snippet').name).toHaveText('test_snippet');
    await expect(settingsPage.getSnippetItem('test_snippet').content).toHaveText('Hello, world!');
  });

  test('updates an existing snippet', async () => {
    await settingsPage.addSnippet({ name: 'to_update', content: 'initial', isGenerated: false });
    await settingsPage.goto(); // Reload to see the new snippet

    await settingsPage.getSnippetItem('to_update').editButton.click();
    await settingsPage.getSnippetItemInputs('to_update').name.fill('updated_snippet');
    await settingsPage.getSnippetItemInputs('to_update').content.fill('updated content');
    await settingsPage.getSnippetItem('to_update').saveButton.click();

    await expect(settingsPage.getSnippetItem('to_update').view).not.toBeVisible();
    await expect(settingsPage.getSnippetItem('updated_snippet').view).toBeVisible();
    await expect(settingsPage.getSnippetItem('updated_snippet').content).toHaveText('updated content');
  });

  test('deletes a snippet', async () => {
    await settingsPage.addSnippet({ name: 'to_delete', content: 'delete me', isGenerated: false });
    await settingsPage.goto();

    await expect(settingsPage.getSnippetItem('to_delete').view).toBeVisible();
    await settingsPage.getSnippetItem('to_delete').deleteButton.click();
    await expect(settingsPage.getSnippetItem('to_delete').view).not.toBeVisible();
  });

  test('prevents saving a snippet with an invalid name', async () => {
    await settingsPage.newSnippetButton.click();
    const inputs = settingsPage.getSnippetItemInputs('new');

    // Empty name
    await inputs.name.fill('');
    await inputs.content.fill('some content');
    await settingsPage.getSnippetItem('new').saveButton.click();
    await expect(settingsPage.getSnippetItem('new').errorMessage).toHaveText('Name cannot be empty.');

    // Invalid characters
    await inputs.name.fill('invalid name');
    await expect(settingsPage.getSnippetItem('new').errorMessage).toHaveText('Name can only contain alphanumeric characters and underscores.');

    // Duplicate name
    await settingsPage.addSnippet({ name: 'existing_snippet', content: 'exists', isGenerated: false });
    await settingsPage.goto();
    await settingsPage.newSnippetButton.click();
    await settingsPage.getSnippetItemInputs('new').name.fill('existing_snippet');
    await expect(settingsPage.getSnippetItem('new').errorMessage).toHaveText('A snippet with this name already exists.');
  });

  test('creates a generated snippet and regenerates content', async ({ context }) => {
    await mockGpt(context, 'This is the generated content.');

    await settingsPage.newSnippetButton.click();
    const inputs = settingsPage.getSnippetItemInputs('new');
    await inputs.name.fill('gen_snippet');
    await inputs.generatedCheckbox.check();
    await inputs.prompt.fill('Generate some content');

    // Mock the API call for the first generation
    await settingsPage.getSnippetItem('new').saveButton.click();

    await expect(settingsPage.getSnippetItem('gen_snippet').view).toBeVisible();
    await expect(settingsPage.getSnippetItem('gen_snippet').content).toHaveText('This is the generated content.');

    // Mock the API call for the second generation
    await mockGpt(context, 'This is the NEWLY generated content.');

    await settingsPage.getSnippetItem('gen_snippet').editButton.click();
    await settingsPage.getSnippetItemInputs('gen_snippet').prompt.fill('Generate some new content');
    await settingsPage.getSnippetItem('gen_snippet').saveButton.click();

    await expect(settingsPage.getSnippetItem('gen_snippet').content).toHaveText('This is the NEWLY generated content.');
  });
});
