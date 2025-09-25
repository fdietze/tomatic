/**
 * Core error types for the application.
 * These provide structured, type-safe error handling throughout the codebase.
 */

export type AppError =
  | { type: 'API_ERROR'; message: string; statusCode?: number; endpoint?: string }
  | { type: 'VALIDATION_ERROR'; field: string; message: string }
  | { type: 'SNIPPET_REGENERATION_ERROR'; snippetName: string; reason: string }
  | { type: 'NETWORK_ERROR'; message: string; retryable: boolean }
  | { type: 'PERSISTENCE_ERROR'; operation: string; message: string }
  | { type: 'AUTHENTICATION_ERROR'; message: string }
  | { type: 'UNKNOWN_ERROR'; message: string; originalError?: unknown };

/**
 * Result type for operations that can succeed or fail.
 * This provides a functional approach to error handling.
 */
export type Result<T, E = AppError> = 
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Helper functions for creating AppError instances
 */
export const createAppError = {
  api: (message: string, statusCode?: number, endpoint?: string): AppError => ({
    type: 'API_ERROR',
    message,
    statusCode,
    endpoint,
  }),
  
  validation: (field: string, message: string): AppError => ({
    type: 'VALIDATION_ERROR',
    field,
    message,
  }),
  
  snippetRegeneration: (snippetName: string, reason: string): AppError => ({
    type: 'SNIPPET_REGENERATION_ERROR',
    snippetName,
    reason,
  }),
  
  network: (message: string, retryable: boolean = true): AppError => ({
    type: 'NETWORK_ERROR',
    message,
    retryable,
  }),
  
  persistence: (operation: string, message: string): AppError => ({
    type: 'PERSISTENCE_ERROR',
    operation,
    message,
  }),
  
  authentication: (message: string): AppError => ({
    type: 'AUTHENTICATION_ERROR',
    message,
  }),
  
  unknown: (message: string, originalError?: unknown): AppError => ({
    type: 'UNKNOWN_ERROR',
    message,
    originalError,
  }),
};

/**
 * Helper functions for working with Result types
 */
export const Result = {
  success: <T>(value: T): Result<T> => ({ success: true, value }),
  failure: <T, E = AppError>(error: E): Result<T, E> => ({ success: false, error }),
};

/**
 * Extract a user-friendly message from an AppError for UI display
 */
export function getErrorMessage(error: AppError): string {
  switch (error.type) {
    case 'API_ERROR':
      return `API Error: ${error.message}`;
    case 'VALIDATION_ERROR':
      return `Validation Error in ${error.field}: ${error.message}`;
    case 'SNIPPET_REGENERATION_ERROR':
      return `Snippet '@${error.snippetName}' failed: ${error.reason}`;
    case 'NETWORK_ERROR':
      return `Network Error: ${error.message}`;
    case 'PERSISTENCE_ERROR':
      return `Storage Error (${error.operation}): ${error.message}`;
    case 'AUTHENTICATION_ERROR':
      return `Authentication Error: ${error.message}`;
    case 'UNKNOWN_ERROR':
      return `Unknown Error: ${error.message}`;
    default:
      // This ensures exhaustiveness checking
      const _exhaustive: never = error;
      return `Unexpected error: ${JSON.stringify(_exhaustive)}`;
  }
}

/**
 * Convert a generic Error or unknown error to an AppError
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof Error) {
    return createAppError.unknown(error.message, error);
  }
  
  if (typeof error === 'string') {
    return createAppError.unknown(error);
  }
  
  return createAppError.unknown('An unknown error occurred', error);
}
