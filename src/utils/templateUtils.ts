/**
 * An asynchronous function constructor.
 */
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

/**
 * Evaluates a JavaScript template string asynchronously.
 *
 * This function allows the use of `await` within the template. It also provides
 * all variables from the `scope` object as global variables within the template's execution context.
 *
 * @param template The template string to evaluate. It should be valid content for a JavaScript backtick string.
 * @param scope An object where keys are variable names and values are their corresponding values, to be made available in the template.
 * @returns A Promise that resolves to the evaluated string.
 * @throws An error if the template string is invalid or if the code within it throws an error.
 *
 * @example
 * const scope = { name: 'World', anAsyncFunc: async () => 'from async' };
 * const template = 'Hello, ${name}! This is a message ${await anAsyncFunc()}.';
 * const result = await evaluateTemplate(template, scope);
// result is 'Hello, World! This is a message from async.'
 */
export async function evaluateTemplate(
  template: string,
  scope: Record<string, unknown>
): Promise<string> {
  // Get the names of the variables in the scope
  const scopeKeys = Object.keys(scope);

  // Get the values of the variables in the scope
  const scopeValues = Object.values(scope);

  // Create a new async function with the scope variables as its arguments
  // The function body will be the template string, wrapped in backticks
  const func = new AsyncFunction(...scopeKeys, `return \`${template}\`;`);

  // Call the function with the scope values, and return the result
  return func(...scopeValues);
}