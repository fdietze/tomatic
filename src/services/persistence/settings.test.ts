import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSettings, saveSettings } from './settings';
import { CURRENT_LOCALSTORAGE_VERSION } from './migrations';
import fs from 'fs';
import path from 'path';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
  };
})();

// Mock console.log to capture migration messages
const consoleLogMock = vi.fn();

describe('Settings with Migration Integration', () => {
  beforeEach(() => {
    // Reset localStorage mock
    localStorageMock.clear();
    vi.clearAllMocks();
    
    // Mock global localStorage
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
    
    // Mock console.log
    vi.spyOn(console, 'log').mockImplementation(consoleLogMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadSettings', () => {
    it('should return empty object when localStorage is empty', () => {
      // Purpose: This test verifies that loadSettings returns an empty object when no data exists.
      
      const result = loadSettings();
      
      expect(result).toEqual({});
      expect(localStorageMock.getItem).toHaveBeenCalledWith('tomatic-storage');
    });

    it('should load and migrate V1 deployed data to V2', () => {
      // Purpose: This test verifies that V1 deployed localStorage data is correctly migrated to V2 and loaded.
      
      // Load V1 deployed fixture
      const v1FixturePath = path.join(__dirname, '../../..', 'tests/fixtures/localStorage-v1.json');
      const v1Data = JSON.parse(fs.readFileSync(v1FixturePath, 'utf-8'));
      
      localStorageMock.setItem('tomatic-storage', JSON.stringify(v1Data));
      
      const result = loadSettings();
      
      // Verify migrated data structure (only persisted fields are returned)
      expect(result).toEqual({
        apiKey: 'xxxx',
        modelName: 'google/gemini-2.5-flash-lite',
        selectedPromptName: null,
        autoScrollEnabled: false,
        initialChatPrompt: null,
      });
      
      // Verify migration message was logged
      expect(consoleLogMock).toHaveBeenCalledWith(
        expect.stringContaining('Migrated localStorage from version 1 to 2')
      );
      
      // Verify migrated data was saved back to localStorage
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'tomatic-storage',
        expect.stringContaining('"version":2')
      );
    });

    it('should load V2 data without migration', () => {
      // Purpose: This test verifies that V2 data loads correctly without triggering migration.
      
      // Load V2 current fixture
      const v2FixturePath = path.join(__dirname, '../../..', 'tests/fixtures/localStorage-v2.json');
      const v2Data = JSON.parse(fs.readFileSync(v2FixturePath, 'utf-8'));
      
      localStorageMock.setItem('tomatic-storage', JSON.stringify(v2Data));
      
      const result = loadSettings();
      
      // Only persisted fields are returned
      expect(result).toEqual({
        apiKey: v2Data.state.apiKey,
        modelName: v2Data.state.modelName,
        selectedPromptName: v2Data.state.selectedPromptName,
        autoScrollEnabled: v2Data.state.autoScrollEnabled,
        initialChatPrompt: v2Data.state.initialChatPrompt,
      });
      
      // Verify no migration message
      expect(consoleLogMock).not.toHaveBeenCalledWith(
        expect.stringContaining('Migrated localStorage')
      );
    });

    it('should handle corrupt JSON gracefully', () => {
      // Purpose: This test ensures that corrupt JSON data doesn't crash the application.
      
      localStorageMock.setItem('tomatic-storage', 'invalid-json');
      
      const result = loadSettings();
      
      expect(result).toEqual({});
      expect(consoleLogMock).toHaveBeenCalledWith(
        '[Settings] Error loading settings from localStorage:',
        expect.any(SyntaxError)
      );
    });

    it('should handle migration errors gracefully', () => {
      // Purpose: This test ensures that migration errors are handled gracefully.
      
      // Create data that will cause migration to fail
      const invalidData = {
        state: null,
        version: 0,
      };
      
      localStorageMock.setItem('tomatic-storage', JSON.stringify(invalidData));
      
      const result = loadSettings();
      
      expect(result).toEqual({});
      expect(consoleLogMock).toHaveBeenCalledWith(
        '[Settings] Invalid localStorage data structure after migration, using defaults:',
        expect.any(Object)
      );
    });

    it('should handle validation errors after migration', () => {
      // Purpose: This test ensures that validation errors after migration are handled.
      
      // Create data that migrates but fails validation
      const dataWithInvalidMigratedState = {
        state: {
          apiKey: 123, // Invalid type
          modelName: null,
        },
        version: 0,
      };
      
      localStorageMock.setItem('tomatic-storage', JSON.stringify(dataWithInvalidMigratedState));
      
      const result = loadSettings();
      
      expect(result).toEqual({});
      expect(consoleLogMock).toHaveBeenCalledWith(
        '[Settings] Invalid localStorage data structure after migration, using defaults:',
        expect.any(Object)
      );
    });
  });

  describe('saveSettings', () => {
    it('should save settings with current version', () => {
      // Purpose: This test verifies that settings are saved with the current version number.
      
      const testSettings = {
        apiKey: 'test-key',
        modelName: 'test-model',
        selectedPromptName: null,
        autoScrollEnabled: true,
        initialChatPrompt: null,
        loading: 'idle' as const,
        saving: 'idle' as const,
      };
      
      saveSettings(testSettings);
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'tomatic-storage',
        JSON.stringify({
          state: testSettings,
          version: CURRENT_LOCALSTORAGE_VERSION,
        })
      );
    });

    it('should handle save errors gracefully', () => {
      // Purpose: This test ensures that save errors don't crash the application.
      
      // Mock setItem to throw an error
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('Storage quota exceeded');
      });
      
      const testSettings = {
        apiKey: 'test-key',
        modelName: 'test-model',
        selectedPromptName: null,
        autoScrollEnabled: true,
        initialChatPrompt: null,
        loading: 'idle' as const,
        saving: 'idle' as const,
      };
      
      expect(() => saveSettings(testSettings)).not.toThrow();
      
      expect(consoleLogMock).toHaveBeenCalledWith(
        'Error saving settings to localStorage:',
        expect.any(Error)
      );
    });
  });

  describe('Integration with Migration System', () => {
    it('should perform round-trip migration and save correctly', () => {
      // Purpose: This test verifies the complete cycle of loading migrated data and saving it back.
      
      // Load V1 deployed fixture
      const v1FixturePath = path.join(__dirname, '../../..', 'tests/fixtures/localStorage-v1.json');
      const v1Data = JSON.parse(fs.readFileSync(v1FixturePath, 'utf-8'));
      
      localStorageMock.setItem('tomatic-storage', JSON.stringify(v1Data));
      
      // Load (which triggers migration)
      const loadedSettings = loadSettings();
      
      // Save the loaded settings (cast to SettingsState since loadSettings returns Partial<SettingsState>)
      const settingsToSave = {
        apiKey: loadedSettings.apiKey || '',
        modelName: loadedSettings.modelName || '',
        selectedPromptName: loadedSettings.selectedPromptName || null,
        autoScrollEnabled: loadedSettings.autoScrollEnabled ?? true,
        initialChatPrompt: loadedSettings.initialChatPrompt || null,
        loading: 'idle' as const,
        saving: 'idle' as const,
      };
      saveSettings(settingsToSave);
      
      // Load again to verify round-trip
      const reloadedSettings = loadSettings();
      
      // The reloaded settings should match the original loaded settings
      // but may have additional fields from the persisted schema
      expect(reloadedSettings).toEqual({
        ...loadedSettings,
        initialChatPrompt: null, // This gets added during the round-trip
      });
      
      // Verify only one migration message (not on reload)
      const migrationMessages = consoleLogMock.mock.calls.filter(call => 
        call[0]?.includes?.('Migrated localStorage')
      );
      expect(migrationMessages).toHaveLength(1);
    });
  });
});
