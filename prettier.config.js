/**
 * Prettier configuration. Formatting is enforced in CI with `npm run format:check`.
 * @type {import('prettier').Config}
 */
export default {
  printWidth: 120,
  singleQuote: true,
  semi: true,
  trailingComma: 'none',
  arrowParens: 'always',
  endOfLine: 'lf'
};
