import { describe, it, expect } from 'vitest';
import { migrateLocalStorage, CURRENT_LOCALSTORAGE_VERSION } from './migrations';
import fs from 'fs';
import path from 'path';

describe('localStorage Migrations', () => {
  describe('migrateLocalStorage', () => {
    it('should migrate from V1 (deployed) to V2 (current)', () => {
      // Purpose: This test verifies that localStorage data is correctly migrated from V1 (deployed) to V2 (current) format.
      // V1 had cachedModels and input fields, V2 removes them and adds initialChatPrompt.
      
      // Load V1 fixture
      const v1FixturePath = path.join(__dirname, '../../..', 'tests/fixtures/localStorage-v1.json');
      const v1Data = JSON.parse(fs.readFileSync(v1FixturePath, 'utf-8'));
      
      const result = migrateLocalStorage(v1Data);
      
      expect(result.version).toBe(2);
      expect(result.state).toEqual({
        apiKey: 'xxxx',
        modelName: 'google/gemini-2.5-flash-lite',
        selectedPromptName: null,
        autoScrollEnabled: false,
        initialChatPrompt: null, // New field in V2
        // Note: cachedModels and input are no longer persisted in V2
      });
    });

    it('should handle V1 data with missing autoScrollEnabled', () => {
      // Purpose: This test ensures that V1 data without autoScrollEnabled field gets the default value.
      
      const v1DataWithoutAutoScroll = {
        state: {
          apiKey: 'test-key',
          modelName: 'test-model',
          cachedModels: [],
          input: '',
          selectedPromptName: null,
        },
        version: 1,
      };

      const result = migrateLocalStorage(v1DataWithoutAutoScroll);
      
      expect(result.version).toBe(2);
      expect(result.state.autoScrollEnabled).toBe(true);
      expect(result.state.initialChatPrompt).toBeNull();
    });

    it('should preserve existing autoScrollEnabled in V1 data', () => {
      // Purpose: This test ensures that if V1 data already has autoScrollEnabled, it's preserved.
      
      const v1DataWithAutoScroll = {
        state: {
          apiKey: 'test-key',
          modelName: 'test-model',
          cachedModels: [],
          input: '',
          selectedPromptName: null,
          autoScrollEnabled: false,
        },
        version: 1,
      };

      const result = migrateLocalStorage(v1DataWithAutoScroll);
      
      expect(result.version).toBe(2);
      expect(result.state.autoScrollEnabled).toBe(false);
    });

    it('should handle V1 data with invalid selectedPromptName', () => {
      // Purpose: This test ensures that non-string selectedPromptName values are converted to null.
      
      const v1DataWithInvalidPromptName = {
        state: {
          apiKey: 'test-key',
          modelName: 'test-model',
          cachedModels: [],
          input: '',
          selectedPromptName: { invalid: 'object' },
          autoScrollEnabled: true,
        },
        version: 1,
      };

      const result = migrateLocalStorage(v1DataWithInvalidPromptName);
      
      expect(result.version).toBe(2);
      expect(result.state.selectedPromptName).toBeNull();
    });

    it('should not modify V2 data', () => {
      // Purpose: This test verifies that V2 data passes through unchanged.
      
      // Load V2 fixture
      const v2FixturePath = path.join(__dirname, '../../..', 'tests/fixtures/localStorage-v2.json');
      const v2Data = JSON.parse(fs.readFileSync(v2FixturePath, 'utf-8'));
      
      const result = migrateLocalStorage(v2Data);
      
      expect(result).toEqual(v2Data);
    });

    it('should handle missing or invalid fields gracefully', () => {
      // Purpose: This test ensures the migration handles corrupt or incomplete V1 data gracefully.
      
      const corruptV1Data = {
        state: {
          // Missing required fields
          cachedModels: 'invalid',
        },
        version: 1,
      };

      const result = migrateLocalStorage(corruptV1Data);
      
      expect(result.version).toBe(2);
      expect(result.state.apiKey).toBe('');
      expect(result.state.modelName).toBe('');
      expect(result.state.selectedPromptName).toBeNull();
      expect(result.state.autoScrollEnabled).toBe(true);
      expect(result.state.initialChatPrompt).toBeNull();
    });
  });

  describe('Migration Integration', () => {
    it('should match current version constant', () => {
      // Purpose: This test ensures the migration system is in sync with the expected current version.
      
      expect(CURRENT_LOCALSTORAGE_VERSION).toBe(2);
    });

    it('should handle edge case version numbers', () => {
      // Purpose: This test ensures unknown version numbers are handled gracefully.
      
      const unknownVersionData = {
        state: { some: 'data' },
        version: 999,
      };

      const result = migrateLocalStorage(unknownVersionData);
      
      // Should pass through unchanged for future versions
      expect(result).toEqual(unknownVersionData);
    });
  });
});
