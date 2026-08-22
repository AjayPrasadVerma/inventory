/**
 * Wrap a user-supplied search term for LIKE / ILIKE, escaping the wildcards.
 *
 * `%` and `_` are LIKE wildcards. Unescaped, a search for `%` matches every row
 * in the table and no index can be used — that shipped once in the global search,
 * where `%%` and `a%` returned the entire catalogue.
 *
 * Always pair the result with `ESCAPE '\'` in the statement, or the escapes are
 * treated as literal backslashes instead.
 */
export function likeTerm(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, '\\$&')}%`;
}
