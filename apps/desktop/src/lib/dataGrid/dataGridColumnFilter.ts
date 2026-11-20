import type { ColumnInfo, DatabaseType } from "@/types/database";
import type { DataGridColumnInfo, DataGridContextFilterMode, GridCellValue } from "@/lib/dataGrid/dataGridSql";
import { buildDataGridColumnValueFilterCondition, buildDataGridColumnValuesFilterCondition } from "@/lib/dataGrid/dataGridSql";
import { normalizeWhereInput } from "@/lib/table/tableSelectSql";

export function buildColumnValueFilterCondition(options: { databaseType?: DatabaseType; identifierQuote?: string; columnName: string; columnInfo?: Pick<ColumnInfo, "data_type">; rawValue: string }): Promise<string | undefined> {
  return buildDataGridColumnValueFilterCondition({
    databaseType: options.databaseType,
    identifierQuote: options.identifierQuote,
    columnName: options.columnName,
    columnInfo: options.columnInfo
      ? {
          name: options.columnName,
          data_type: options.columnInfo.data_type,
          is_nullable: true,
        }
      : undefined,
    rawValue: options.rawValue,
  });
}

export function buildColumnValuesFilterCondition(options: { databaseType?: DatabaseType; identifierQuote?: string; columnName: string; columnInfo?: Pick<ColumnInfo, "data_type">; values: GridCellValue[] }): Promise<string | undefined> {
  return buildDataGridColumnValuesFilterCondition({
    databaseType: options.databaseType,
    identifierQuote: options.identifierQuote,
    columnName: options.columnName,
    columnInfo: options.columnInfo
      ? {
          name: options.columnName,
          data_type: options.columnInfo.data_type,
          is_nullable: true,
        }
      : undefined,
    values: options.values,
  });
}

export function appendColumnValueFilterCondition(whereInput: string | undefined, condition: string | undefined): string {
  if (!condition) return normalizeWhereInput(whereInput);
  const existing = normalizeWhereInput(whereInput);
  return existing ? `(${existing}) AND (${condition})` : condition;
}

export function removeColumnValueFilterCondition(whereInput: string | undefined, condition: string | undefined): string {
  const existing = normalizeWhereInput(whereInput);
  const target = normalizeWhereInput(condition);
  if (!existing || !target) return existing;
  return removeExactCondition(existing, target).value;
}

export function replaceColumnValueFilterCondition(whereInput: string | undefined, previousCondition: string | undefined, nextCondition: string | undefined): string {
  return appendColumnValueFilterCondition(removeColumnValueFilterCondition(whereInput, previousCondition), nextCondition);
}

type RemovedCondition = {
  value: string;
  removed: boolean;
};

function removeExactCondition(expression: string, target: string): RemovedCondition {
  const normalized = normalizeWhereInput(expression);
  if (normalized === target) return { value: "", removed: true };

  // Only decompose top-level AND groups produced by appendColumnValueFilterCondition;
  // quote-aware scanning keeps literals and predicates such as BETWEEN intact.
  const inner = unwrapOuterParentheses(normalized);
  if (inner !== normalized) {
    const result = removeExactCondition(inner, target);
    if (result.removed) return result;
  }

  const split = splitTopLevelAnd(normalized);
  if (!split) return { value: normalized, removed: false };
  const left = removeExactCondition(split.left, target);
  const right = removeExactCondition(split.right, target);
  if (!left.removed && !right.removed) return { value: normalized, removed: false };
  if (!left.value) return { value: unwrapOuterParentheses(right.value), removed: true };
  if (!right.value) return { value: unwrapOuterParentheses(left.value), removed: true };
  return {
    value: `(${unwrapOuterParentheses(left.value)}) AND (${unwrapOuterParentheses(right.value)})`,
    removed: true,
  };
}

function unwrapOuterParentheses(expression: string): string {
  if (!expression.startsWith("(") || !expression.endsWith(")")) return expression;
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let bracketQuoted = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (bracketQuoted) {
      if (char === "]") {
        if (expression[index + 1] === "]") index += 1;
        else bracketQuoted = false;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (expression[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") {
      bracketQuoted = true;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth === 0 && index < expression.length - 1) return expression;
  }
  return depth === 0 ? expression.slice(1, -1).trim() : expression;
}

function splitTopLevelAnd(expression: string): { left: string; right: string } | null {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let bracketQuoted = false;
  for (let index = 0; index <= expression.length - 5; index += 1) {
    const char = expression[index];
    if (bracketQuoted) {
      if (char === "]") {
        if (expression[index + 1] === "]") index += 1;
        else bracketQuoted = false;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (expression[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") {
      bracketQuoted = true;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      continue;
    }
    if (depth === 0 && expression.slice(index, index + 5).toUpperCase() === " AND ") {
      return {
        left: expression.slice(0, index).trim(),
        right: expression.slice(index + 5).trim(),
      };
    }
  }
  return null;
}

export function combineWhereInputs(manualWhereInput?: string, structuredWhereInput?: string): string | undefined {
  const manual = normalizeWhereInput(manualWhereInput);
  const structured = normalizeWhereInput(structuredWhereInput);
  if (manual && structured) return `(${manual}) AND (${structured})`;
  return manual || structured || undefined;
}

export type ParsedWhereInputFilterRule = {
  columnName: string;
  mode: DataGridContextFilterMode;
  rawValue: string;
  rawEndValue: string;
  conjunction: "AND" | "OR";
};

export type ParsedWhereInputFilterRules = {
  rules: ParsedWhereInputFilterRule[];
  remainder: string;
};

// One identifier segment: backtick-, double-quote- or bracket-quoted, or bare.
const WHERE_COLUMN_SEGMENT = "(?:`(?:[^`]|``)+`|\"(?:[^\"]|\"\")+\"|\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_$]*)";
const WHERE_COLUMN_REFERENCE = `${WHERE_COLUMN_SEGMENT}(?:\\s*\\.\\s*${WHERE_COLUMN_SEGMENT})*`;

/**
 * Parse a manual WHERE input into structured filter rules (#15320).
 *
 * The data grid keeps the hand-typed WHERE text and the filter panel's rules
 * as two independent inputs that are only combined at query time, so a
 * condition typed in the WHERE editor never showed up in the panel below and
 * could not be edited there. This parses the simple top-level AND conditions
 * a user can type (`task_id = 100234`) into rules and returns the rest
 * untouched, so the caller can move the parsed conditions into the panel
 * without changing the effective filter.
 *
 * Only single-column comparisons against one literal (plus IS NULL, LIKE
 * patterns with a mappable shape, IN lists and BETWEEN ranges) are imported.
 * Anything else — OR groups, expressions, subqueries, unknown columns —
 * stays in `remainder` and keeps working as manual WHERE text.
 */
export function parseWhereInputToStructuredFilterRules(
  whereInput: string | undefined,
  columns: readonly string[],
  isModeSupported?: (mode: DataGridContextFilterMode) => boolean,
): ParsedWhereInputFilterRules {
  const normalized = normalizeWhereInput(whereInput);
  if (!normalized) return { rules: [], remainder: "" };
  const parts = splitTopLevelAndConditions(normalized);
  const rules: ParsedWhereInputFilterRule[] = [];
  const unparsed: string[] = [];
  for (const part of parts) {
    const rule = parseSimpleWhereCondition(part, columns, isModeSupported);
    if (rule) rules.push(rule);
    else unparsed.push(part);
  }
  return { rules, remainder: unparsed.join(" AND ") };
}

function parseSimpleWhereCondition(part: string, columns: readonly string[], isModeSupported?: (mode: DataGridContextFilterMode) => boolean): ParsedWhereInputFilterRule | null {
  const text = unwrapWhereConditionPart(part);
  if (!text) return null;
  const columnMatch = new RegExp(`^(${WHERE_COLUMN_REFERENCE})`, "i").exec(text);
  if (!columnMatch) return null;
  const columnName = canonicalWhereColumn(columnMatch[1], columns);
  if (!columnName) return null;
  const rest = text.slice(columnMatch[0].length).trim();
  if (!rest) return null;
  const rule = parseWhereConditionRest(columnName, rest);
  if (!rule) return null;
  if (isModeSupported && !isModeSupported(rule.mode)) return null;
  return rule;
}

function parseWhereConditionRest(columnName: string, rest: string): ParsedWhereInputFilterRule | null {
  const nullMatch = /^IS\s+(NOT\s+)?NULL$/i.exec(rest);
  if (nullMatch) {
    return { columnName, mode: nullMatch[1] ? "is-not-null" : "is-null", rawValue: "", rawEndValue: "", conjunction: "AND" };
  }

  const betweenMatch = /^(NOT\s+)?BETWEEN\s+(.+)$/is.exec(rest);
  if (betweenMatch) {
    const bounds = splitTopLevelAndConditions(betweenMatch[2]);
    if (bounds.length !== 2) return null;
    const lower = parseWhereLiteral(bounds[0]);
    const upper = parseWhereLiteral(bounds[1]);
    if (lower === null || upper === null) return null;
    return { columnName, mode: betweenMatch[1] ? "not-between" : "between", rawValue: lower, rawEndValue: upper, conjunction: "AND" };
  }

  const inMatch = /^(NOT\s+)?IN\s*\((.*)\)$/is.exec(rest);
  if (inMatch) {
    const inner = inMatch[2].trim();
    if (!inner) return null;
    const values = splitFilterValues(inner);
    if (!values.length || !values.every(({ value, quoted }) => isSingleWhereLiteral(value, quoted))) return null;
    return { columnName, mode: inMatch[1] ? "not-in" : "in", rawValue: inner, rawEndValue: "", conjunction: "AND" };
  }

  const likeMatch = /^(NOT\s+)?LIKE\s*(.+)$/is.exec(rest);
  if (likeMatch) {
    const rawLiteral = likeMatch[2].trim();
    if (!isSingleQuotedToken(rawLiteral)) return null;
    const mapped = mapLikePatternToFilterMode(unwrapMatchingQuotes(rawLiteral), !!likeMatch[1]);
    if (!mapped) return null;
    return { columnName, mode: mapped.mode, rawValue: mapped.rawValue, rawEndValue: "", conjunction: "AND" };
  }

  const comparisonMatch = /^(=|!=|<>|>=|<=|>|<)\s*(.+)$/s.exec(rest);
  if (comparisonMatch) {
    const literal = parseWhereLiteral(comparisonMatch[2]);
    if (literal === null) return null;
    const mode: DataGridContextFilterMode =
      comparisonMatch[1] === "="
        ? "equals"
        : comparisonMatch[1] === "!=" || comparisonMatch[1] === "<>"
          ? "not-equals"
          : comparisonMatch[1] === ">"
            ? "greater-than"
            : comparisonMatch[1] === ">="
              ? "greater-than-or-equal"
              : comparisonMatch[1] === "<"
                ? "less-than"
                : "less-than-or-equal";
    return { columnName, mode, rawValue: literal, rawEndValue: "", conjunction: "AND" };
  }

  return null;
}

function canonicalWhereColumn(reference: string, columns: readonly string[]): string | null {
  const segments = reference.match(new RegExp(WHERE_COLUMN_SEGMENT, "g"));
  if (!segments || !segments.length) return null;
  const name = unquoteWhereIdentifier(segments[segments.length - 1]);
  if (!name) return null;
  return columns.find((column) => column.toLowerCase() === name.toLowerCase()) ?? null;
}

function unquoteWhereIdentifier(segment: string): string {
  const text = segment.trim();
  if (text.length >= 2 && text.startsWith("`") && text.endsWith("`")) return text.slice(1, -1).replaceAll("``", "`");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1).replaceAll('""', '"');
  if (text.length >= 2 && text.startsWith("[") && text.endsWith("]")) return text.slice(1, -1).replaceAll("]]", "]");
  return text;
}

function unwrapWhereConditionPart(part: string): string {
  let current = part.trim();
  for (;;) {
    const unwrapped = unwrapOuterParentheses(current);
    if (unwrapped === current) return current;
    current = unwrapped.trim();
  }
}

// A single literal the panel can round-trip: a quoted string, a number, or a
// boolean. `= NULL` is deliberately not a literal: it never matches, while
// the `is-null` rule it would map to does, so it stays manual WHERE text.
function parseWhereLiteral(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith("'") || text.startsWith('"')) {
    if (!isSingleQuotedToken(text)) return null;
    return unwrapMatchingQuotes(text);
  }
  if (isNumericLiteral(text)) return text;
  if (/^(true|false)$/i.test(text)) return text;
  return null;
}

function isSingleWhereLiteral(value: string, quoted: boolean): boolean {
  if (quoted) return true;
  return isNumericLiteral(value) || /^(true|false)$/i.test(value);
}

function isSingleQuotedToken(text: string): boolean {
  if (text.length < 2) return false;
  const quote = text[0];
  if (quote !== "'" && quote !== '"') return false;
  let index = 1;
  while (index < text.length) {
    if (text[index] === quote) {
      if (text[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index === text.length - 1;
    }
    index += 1;
  }
  return false;
}

// The backend wraps `like` values in `%...%`, so only patterns whose shape
// maps exactly onto a panel mode round-trip: `%x%` is contains, `x%` starts
// with, `%x` ends with. A bare `LIKE 'x'` would silently become contains,
// and `%`/`_` inside the value would be re-escaped, so both stay manual.
function mapLikePatternToFilterMode(pattern: string, negated: boolean): { mode: DataGridContextFilterMode; rawValue: string } | null {
  const startsWithPercent = pattern.startsWith("%");
  const endsWithPercent = pattern.endsWith("%");
  const inner = pattern.slice(startsWithPercent ? 1 : 0, endsWithPercent ? pattern.length - 1 : pattern.length);
  if (!inner || /[%_\\]/.test(inner)) return null;
  if (startsWithPercent && endsWithPercent) return { mode: negated ? "not-like" : "like", rawValue: inner };
  if (endsWithPercent) return { mode: negated ? "not-begins-with" : "begins-with", rawValue: inner };
  if (startsWithPercent) return { mode: negated ? "not-ends-with" : "ends-with", rawValue: inner };
  return null;
}

// Quote/paren-aware scan for the first top-level " AND " (same quoting rules
// as splitTopLevelAnd, which only splits the first occurrence).
function findTopLevelAnd(expression: string): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let bracketQuoted = false;
  for (let index = 0; index <= expression.length - 5; index += 1) {
    const char = expression[index];
    if (bracketQuoted) {
      if (char === "]") {
        if (expression[index + 1] === "]") index += 1;
        else bracketQuoted = false;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (expression[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") {
      bracketQuoted = true;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      continue;
    }
    if (depth === 0 && expression.slice(index, index + 5).toUpperCase() === " AND ") return index;
  }
  return -1;
}

function hasTopLevelAnd(text: string): boolean {
  return findTopLevelAnd(text) >= 0;
}

function splitTopLevelAndConditions(expression: string): string[] {
  const parts: string[] = [];
  let rest = expression;
  for (;;) {
    const at = findTopLevelAnd(rest);
    if (at < 0) break;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at + 5).trim();
  }
  parts.push(rest.trim());
  return mergeBetweenConditions(parts.filter((part) => part.length > 0));
}

// `x BETWEEN 1 AND 5` contains a top-level AND that belongs to the BETWEEN,
// not to the condition list; re-join a BETWEEN start with its upper bound.
function mergeBetweenConditions(parts: string[]): string[] {
  const merged: string[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && startsBetweenCondition(previous)) {
      merged[merged.length - 1] = `${previous} AND ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function startsBetweenCondition(part: string): boolean {
  const text = unwrapWhereConditionPart(part);
  const match = new RegExp(`^${WHERE_COLUMN_REFERENCE}\\s+(?:NOT\\s+)?BETWEEN\\s+(.+)$`, "is").exec(text);
  if (!match) return false;
  // Incomplete only while the lower bound has no closing AND yet.
  return !hasTopLevelAnd(match[1]);
}

export function filterModeNeedsValue(mode: DataGridContextFilterMode): boolean {
  return mode !== "is-null" && mode !== "is-not-null" && mode !== "is-blank" && mode !== "is-not-blank";
}

export function filterModeUsesList(mode: DataGridContextFilterMode): boolean {
  return mode === "in" || mode === "not-in";
}

export function filterModeUsesRange(mode: DataGridContextFilterMode): boolean {
  return mode === "between" || mode === "not-between";
}

export function filterModeIsSupportedForDatabase(mode: DataGridContextFilterMode, databaseType?: DatabaseType): boolean {
  if (databaseType === "victoriametrics") return false;
  if (!filterModeUsesList(mode) && !filterModeUsesRange(mode)) return true;
  // These targets do not support all four new SQL predicates reliably.
  return databaseType !== "cassandra" && databaseType !== "influxdb" && databaseType !== "jdbc";
}

export function filterModeHasCompleteValue(mode: DataGridContextFilterMode, rawValue: string, rawEndValue = ""): boolean {
  if (!filterModeNeedsValue(mode)) return true;
  if (filterModeUsesList(mode)) return parseFilterValues(rawValue).length > 0;
  if (filterModeUsesRange(mode)) return rawValue.trim().length > 0 && rawEndValue.trim().length > 0;
  return rawValue.trim().length > 0;
}

export function parseFilterValue(rawValue: string, columnInfo?: Pick<DataGridColumnInfo, "data_type">, databaseType?: DatabaseType): GridCellValue {
  const unquoted = unwrapMatchingQuotes(rawValue.trim());
  const dataType = (columnInfo?.data_type ?? "").toLowerCase();

  if (isBooleanType(dataType, databaseType) && unquoted.toLowerCase() === "true") return true;
  if (isBooleanType(dataType, databaseType) && unquoted.toLowerCase() === "false") return false;

  if (isNumericType(dataType) && isNumericLiteral(unquoted)) {
    // Preserve the original decimal/integer spelling so the backend can emit it exactly.
    return unquoted;
  }

  if (!dataType && isNumericLiteral(unquoted)) {
    // Leading zeros are part of the user's text value, not numeric noise:
    // Number("0000000") is 0, which turned a text-column filter into an
    // integer comparison when the column type was not available (#13059).
    if (/^[+-]?0\d/.test(unquoted)) {
      return unquoted;
    }
    const numeric = Number(unquoted);
    if (Number.isFinite(numeric)) {
      // Keep large integers as strings to avoid JS precision loss (> Number.MAX_SAFE_INTEGER).
      if (Number.isInteger(numeric) && Math.abs(numeric) > Number.MAX_SAFE_INTEGER) {
        return unquoted;
      }
      return numeric;
    }
  }

  return unquoted;
}

export function parseFilterValues(rawValue: string, columnInfo?: Pick<DataGridColumnInfo, "data_type">, databaseType?: DatabaseType): GridCellValue[] {
  return splitFilterValues(rawValue).map(({ value, quoted }) => {
    if (!quoted && value.toLowerCase() === "null") return null;
    return parseFilterValue(value, columnInfo, databaseType);
  });
}

export function formatFilterRawValue(value: GridCellValue, quoteStrings = false): string {
  if (typeof value === "string") {
    const wrappedInMatchingQuotes = value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')));
    if (!quoteStrings && value.trim() === value && !wrappedInMatchingQuotes) return value;
    return `'${value.replaceAll("'", "''")}'`;
  }
  if (value === null) return "null";
  if (typeof value === "object") return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  return String(value);
}

export function formatFilterRawValues(values: readonly GridCellValue[]): string {
  return values.map((value) => formatFilterRawValue(value, true)).join(", ");
}

type ParsedFilterValue = {
  value: string;
  quoted: boolean;
};

function splitFilterValues(source: string): ParsedFilterValue[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if ((char === "'" || char === '"') && current.trim().length === 0) {
      quote = char;
      current += char;
      continue;
    }

    if (char === "," || char === "\n" || char === "\r") {
      tokens.push(current);
      current = "";
      continue;
    }

    current += char;
  }
  tokens.push(current);

  return tokens.map(normalizeFilterValue).filter((value): value is ParsedFilterValue => !!value);
}

function normalizeFilterValue(token: string): ParsedFilterValue | null {
  const text = token.trim();
  if (!text) return null;

  const first = text[0];
  const last = text[text.length - 1];
  const quoted = text.length >= 2 && ((first === "'" && last === "'") || (first === '"' && last === '"'));
  if (!quoted) return { value: text, quoted: false };

  const quote = first as "'" | '"';
  const value = text.slice(1, -1).replaceAll(`${quote}${quote}`, quote);
  return { value, quoted: true };
}

function unwrapMatchingQuotes(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      const quote = first as "'" | '"';
      return text.slice(1, -1).replaceAll(`${quote}${quote}`, quote);
    }
  }
  return text;
}

function isNumericType(dataType: string): boolean {
  return ["int", "integer", "bigint", "smallint", "tinyint", "mediumint", "serial", "number", "numeric", "decimal", "float", "double", "real", "money"].some((part) => dataType.split(/[^a-z0-9]+/).includes(part));
}

function isBooleanType(dataType: string, databaseType?: DatabaseType): boolean {
  return dataType.split(/[^a-z0-9]+/).some((part) => part === "bool" || part === "boolean" || (part === "bit" && databaseType !== "postgres"));
}

function isNumericLiteral(text: string): boolean {
  if (!text || text.trim() !== text) return false;
  return Number.isFinite(Number(text)) && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text);
}
