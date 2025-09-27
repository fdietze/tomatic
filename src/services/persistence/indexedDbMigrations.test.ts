import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  DBV2_ChatSession,
  DBV2_SystemPrompt,
  DBV3_Snippet,
  DBV2_V2SnippetOnDisk,
} from '@/types/storage';

// Mock the events module
vi.mock('@/utils/events', () => ({
  dispatchEvent: vi.fn(),
}));

describe('IndexedDB Migration Data Validation', () => {
  describe('Migration Fixture Validation', () => {
    it('should have valid V2 deployed fixture data', () => {
      // Purpose: This test validates that our V2 deployed fixture data has the correct structure
      // representing the currently deployed database state.
      
      const v2DeployedFixturePath = path.join(__dirname, '../../..', 'tests/fixtures/indexeddb-v2.json');
      const v2Data = JSON.parse(fs.readFileSync(v2DeployedFixturePath, 'utf-8'));
      
      expect(v2Data.dbVersion).toBe(2);
      expect(v2Data.stores.chat_sessions).toHaveLength(2);
      
      const session = v2Data.stores.chat_sessions[0];
      expect(session.session_id).toBeDefined();
      expect(session.messages).toBeDefined();
      expect(session.name).toBeDefined(); // V2 has name field
      
      // V2 has system_prompts store
      expect(v2Data.stores.system_prompts).toBeDefined();
      expect(session.created_at_ms).toBeDefined();
      expect(session.updated_at_ms).toBeDefined();
      
      // V2 characteristics: messages have IDs and prompt_name fields
      session.messages.forEach((message: unknown) => {
        const msg = message as Record<string, unknown>;
        expect(msg.role).toBeDefined();
        expect(msg.content).toBeDefined();
        expect(msg.id).toBeDefined(); // V2 has IDs
        expect(msg.prompt_name).toBeDefined(); // V2 has prompt_name
      });
    });

    it('should have valid V3 current fixture data', () => {
      // Purpose: This test validates that our V3 current fixture data has the correct structure
      // representing the current database state with snippets.
      
      const v3FixturePath = path.join(__dirname, '../../..', 'tests/fixtures/indexeddb-v3.json');
      const v3Data = JSON.parse(fs.readFileSync(v3FixturePath, 'utf-8'));
      
      expect(v3Data.dbVersion).toBe(3);
      expect(v3Data.stores.chat_sessions).toBeDefined();
      expect(v3Data.stores.system_prompts).toBeDefined();
      expect(v3Data.stores.snippets).toBeDefined(); // V3 has snippets
      
      const session = v3Data.stores.chat_sessions[0] as DBV2_ChatSession;
      expect(session.session_id).toBeDefined();
      expect(session.name).toBeDefined(); // V3 has names
      expect(session.messages).toBeDefined();
      
      // V3 characteristics: messages have IDs and prompt_name
      session.messages.forEach((message: unknown) => {
        const msg = message as Record<string, unknown>;
        expect(msg.id).toBeDefined();
        expect(msg.prompt_name).toBeDefined(); // Can be null but must be present
        expect(msg.role).toBeDefined();
        expect(msg.content).toBeDefined();
      });
      
      const prompts = v3Data.stores.system_prompts as DBV2_SystemPrompt[];
      expect(prompts.length).toBeGreaterThan(0);
      prompts.forEach(prompt => {
        expect(prompt.name).toBeDefined();
        expect(prompt.prompt).toBeDefined();
      });
    });

    it('should have valid V3 fixture data', () => {
      // Purpose: This test validates that our V3 fixture data has the complete structure
      // including the new snippets store.
      
      const v3FixturePath = path.join(__dirname, '../../..', 'tests/fixtures/indexeddb-v3.json');
      const v3Data = JSON.parse(fs.readFileSync(v3FixturePath, 'utf-8'));
      
      expect(v3Data.dbVersion).toBe(3);
      expect(v3Data.stores.chat_sessions).toBeDefined();
      expect(v3Data.stores.system_prompts).toBeDefined();
      expect(v3Data.stores.snippets).toBeDefined();
      
      const snippets = v3Data.stores.snippets as DBV3_Snippet[];
      expect(snippets.length).toBeGreaterThan(0);
      
      snippets.forEach(snippet => {
        expect(snippet.id).toBeDefined();
        expect(snippet.name).toBeDefined();
        expect(snippet.content).toBeDefined();
        expect(snippet.isGenerated).toBeDefined();
        expect(snippet.createdAt_ms).toBeDefined();
        expect(snippet.updatedAt_ms).toBeDefined();
        expect(snippet.generationError).toBeDefined(); // Can be null
        expect(snippet.isDirty).toBeDefined();
      });
    });

    it('should have valid V2 snippets fixture for migration testing', () => {
      // Purpose: This test validates the V2 snippets fixture that represents
      // the pre-V3 migration state with old snippet format.
      
      const v2SnippetsFixturePath = path.join(__dirname, '../../..', 'tests/fixtures/indexeddb-v2-with-snippets.json');
      const v2Data = JSON.parse(fs.readFileSync(v2SnippetsFixturePath, 'utf-8'));
      
      expect(v2Data.dbVersion).toBe(2);
      expect(v2Data.stores.snippets).toBeDefined();
      
      const snippets = v2Data.stores.snippets as DBV2_V2SnippetOnDisk[];
      expect(snippets.length).toBeGreaterThan(0);
      
      snippets.forEach(snippet => {
        expect(snippet.name).toBeDefined();
        expect(snippet.content).toBeDefined();
        expect(snippet.isGenerated).toBeDefined();
        // V2 snippets don't have: id, createdAt_ms, updatedAt_ms, generationError, isDirty
        expect('id' in snippet).toBe(false);
        expect('createdAt_ms' in snippet).toBe(false);
        expect('updatedAt_ms' in snippet).toBe(false);
        expect('generationError' in snippet).toBe(false);
        expect('isDirty' in snippet).toBe(false);
      });
    });
  });

  describe('Migration Logic Validation', () => {
    // Note: V1 to V2 migration test removed since deployed version is already V2

    it('should validate V2 to V3 snippet transformation logic', () => {
      // Purpose: This test validates the transformation logic for migrating
      // V2 snippets to V3 format with new required fields.
      
      const v2SnippetsFixturePath = path.join(__dirname, '../../..', 'tests/fixtures/indexeddb-v2-with-snippets.json');
      const v2Data = JSON.parse(fs.readFileSync(v2SnippetsFixturePath, 'utf-8'));
      const v2Snippets = v2Data.stores.snippets as DBV2_V2SnippetOnDisk[];
      
      // Simulate the V2 to V3 transformation
      const now = Date.now();
      const v3Snippets: DBV3_Snippet[] = v2Snippets.map(oldSnippet => ({
        id: 'generated-uuid', // Would be crypto.randomUUID() in real migration
        ...oldSnippet,
        createdAt_ms: now,
        updatedAt_ms: now,
        generationError: null,
        isDirty: false,
      }));
      
      // Validate the transformation
      expect(v3Snippets).toHaveLength(v2Snippets.length);
      
      v3Snippets.forEach((snippet, index) => {
        const originalSnippet = v2Snippets[index];
        if (!originalSnippet) {
          throw new Error(`Missing original snippet at index ${index}`);
        }
        
        // Check new fields were added
        expect(snippet.id).toBeDefined();
        expect(snippet.createdAt_ms).toBe(now);
        expect(snippet.updatedAt_ms).toBe(now);
        expect(snippet.generationError).toBeNull();
        expect(snippet.isDirty).toBe(false);
        
        // Check original fields were preserved
        expect(snippet.name).toBe(originalSnippet.name);
        expect(snippet.content).toBe(originalSnippet.content);
        expect(snippet.isGenerated).toBe(originalSnippet.isGenerated);
        expect(snippet.prompt).toBe(originalSnippet.prompt);
        expect(snippet.model).toBe(originalSnippet.model);
      });
    });
  });

  describe('Migration Constants Validation', () => {
    it('should validate migration constants are consistent', async () => {
      // Purpose: This test ensures that migration-related constants are consistent
      // with our fixture data and expected behavior.
      
      const { DB_VERSION } = await import('../persistence');
      
      expect(DB_VERSION).toBe(3); // Current version should be 3
      
      // Validate that our fixtures cover the migration path (V2 deployed -> V3 current)
      const v2DeployedExists = fs.existsSync(path.join(__dirname, '../../..', 'tests/fixtures/indexeddb-v2.json'));
      const v3CurrentExists = fs.existsSync(path.join(__dirname, '../../..', 'tests/fixtures/indexeddb-v3.json'));
      
      expect(v2DeployedExists).toBe(true);
      expect(v3CurrentExists).toBe(true);
    });
  });
});
