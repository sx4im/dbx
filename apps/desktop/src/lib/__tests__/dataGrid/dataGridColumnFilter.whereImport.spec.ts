import { describe, expect, it } from "vitest";
import { parseWhereInputToStructuredFilterRules } from "@/lib/dataGrid/dataGridColumnFilter";

const COLUMNS = ["task_id", "status", "name", "age", "score", "active", "updated_at"];

describe("parseWhereInputToStructuredFilterRules", () => {
  it("imports the reported case: a WHERE condition shows as a panel rule (#15320)", () => {
    expect(parseWhereInputToStructuredFilterRules("task_id = 100234", COLUMNS)).toEqual({
      rules: [{ columnName: "task_id", mode: "equals", rawValue: "100234", rawEndValue: "", conjunction: "AND" }],
      remainder: "",
    });
  });

  it("imports several AND conditions and strips a WHERE prefix and semicolon", () => {
    expect(parseWhereInputToStructuredFilterRules("WHERE task_id = 100234 AND status = 'active';", COLUMNS)).toEqual({
      rules: [
        { columnName: "task_id", mode: "equals", rawValue: "100234", rawEndValue: "", conjunction: "AND" },
        { columnName: "status", mode: "equals", rawValue: "active", rawEndValue: "", conjunction: "AND" },
      ],
      remainder: "",
    });
  });

  it("imports comparisons without spaces and every comparison operator", () => {
    const parsed = parseWhereInputToStructuredFilterRules("task_id=100234 AND age > 18 AND age >= 18 AND score < 60 AND score <= 60 AND status != 'x' AND status <> 'y'", COLUMNS);
    expect(parsed.remainder).toBe("");
    expect(parsed.rules.map((rule) => [rule.columnName, rule.mode, rule.rawValue])).toEqual([
      ["task_id", "equals", "100234"],
      ["age", "greater-than", "18"],
      ["age", "greater-than-or-equal", "18"],
      ["score", "less-than", "60"],
      ["score", "less-than-or-equal", "60"],
      ["status", "not-equals", "x"],
      ["status", "not-equals", "y"],
    ]);
  });

  it("unquotes quoted and qualified column references and matches columns case-insensitively", () => {
    const parsed = parseWhereInputToStructuredFilterRules("`task_id` = 100234 AND t.status = 'x' AND [name] = 'n' AND \"age\" > 3", COLUMNS);
    expect(parsed.remainder).toBe("");
    expect(parsed.rules.map((rule) => rule.columnName)).toEqual(["task_id", "status", "name", "age"]);
    expect(parseWhereInputToStructuredFilterRules("TASK_ID = 1", ["Task_Id"]).rules[0]?.columnName).toBe("Task_Id");
  });

  it("unwraps quoted string values and doubled-quote escapes", () => {
    expect(parseWhereInputToStructuredFilterRules("name = 'O''Brien'", COLUMNS).rules).toEqual([
      { columnName: "name", mode: "equals", rawValue: "O'Brien", rawEndValue: "", conjunction: "AND" },
    ]);
    expect(parseWhereInputToStructuredFilterRules("active = TRUE", COLUMNS).rules[0]).toMatchObject({ mode: "equals", rawValue: "TRUE" });
  });

  it("imports IS NULL and IS NOT NULL", () => {
    expect(parseWhereInputToStructuredFilterRules("name IS NULL AND status IS NOT NULL", COLUMNS).rules).toEqual([
      { columnName: "name", mode: "is-null", rawValue: "", rawEndValue: "", conjunction: "AND" },
      { columnName: "status", mode: "is-not-null", rawValue: "", rawEndValue: "", conjunction: "AND" },
    ]);
  });

  it("maps LIKE patterns onto the matching panel mode", () => {
    const parsed = parseWhereInputToStructuredFilterRules("name LIKE '%john%' AND name LIKE 'john%' AND name LIKE '%john' AND name NOT LIKE '%john%'", COLUMNS);
    expect(parsed.remainder).toBe("");
    expect(parsed.rules.map((rule) => [rule.mode, rule.rawValue])).toEqual([
      ["like", "john"],
      ["begins-with", "john"],
      ["ends-with", "john"],
      ["not-like", "john"],
    ]);
  });

  it("leaves LIKE patterns that would change meaning as manual text", () => {
    // A bare LIKE 'john' would rebuild as contains, and %/_ inside the value
    // would be re-escaped, so neither round-trips.
    expect(parseWhereInputToStructuredFilterRules("name LIKE 'john'", COLUMNS)).toEqual({ rules: [], remainder: "name LIKE 'john'" });
    expect(parseWhereInputToStructuredFilterRules("name LIKE '%jo%n%'", COLUMNS)).toEqual({ rules: [], remainder: "name LIKE '%jo%n%'" });
  });

  it("imports IN lists and keeps subqueries manual", () => {
    const parsed = parseWhereInputToStructuredFilterRules("status IN (1, 2, 3) AND name NOT IN ('a', 'b')", COLUMNS);
    expect(parsed).toEqual({
      rules: [
        { columnName: "status", mode: "in", rawValue: "1, 2, 3", rawEndValue: "", conjunction: "AND" },
        { columnName: "name", mode: "not-in", rawValue: "'a', 'b'", rawEndValue: "", conjunction: "AND" },
      ],
      remainder: "",
    });
    expect(parseWhereInputToStructuredFilterRules("status IN (SELECT id FROM t)", COLUMNS)).toEqual({ rules: [], remainder: "status IN (SELECT id FROM t)" });
  });

  it("imports BETWEEN without splitting on its own AND", () => {
    const parsed = parseWhereInputToStructuredFilterRules("age BETWEEN 18 AND 65 AND task_id = 1", COLUMNS);
    expect(parsed).toEqual({
      rules: [
        { columnName: "age", mode: "between", rawValue: "18", rawEndValue: "65", conjunction: "AND" },
        { columnName: "task_id", mode: "equals", rawValue: "1", rawEndValue: "", conjunction: "AND" },
      ],
      remainder: "",
    });
    expect(parseWhereInputToStructuredFilterRules("age NOT BETWEEN 18 AND 65", COLUMNS).rules[0]).toMatchObject({ mode: "not-between", rawValue: "18", rawEndValue: "65" });
  });

  it("imports parenthesized conditions", () => {
    expect(parseWhereInputToStructuredFilterRules("(task_id = 100234) AND (status = 'x')", COLUMNS).remainder).toBe("");
    expect(parseWhereInputToStructuredFilterRules("(task_id = 100234)", COLUMNS).rules).toHaveLength(1);
  });

  it("keeps unparseable conditions as manual text and still imports the rest", () => {
    expect(parseWhereInputToStructuredFilterRules("task_id = 100234 AND updated_at > NOW()", COLUMNS)).toEqual({
      rules: [{ columnName: "task_id", mode: "equals", rawValue: "100234", rawEndValue: "", conjunction: "AND" }],
      remainder: "updated_at > NOW()",
    });
    expect(parseWhereInputToStructuredFilterRules("nope = 1", COLUMNS)).toEqual({ rules: [], remainder: "nope = 1" });
    expect(parseWhereInputToStructuredFilterRules("task_id = NULL", COLUMNS)).toEqual({ rules: [], remainder: "task_id = NULL" });
    expect(parseWhereInputToStructuredFilterRules("task_id = 1 OR status = 'x'", COLUMNS)).toEqual({ rules: [], remainder: "task_id = 1 OR status = 'x'" });
  });

  it("returns empty for empty input and keeps unsupported modes manual", () => {
    expect(parseWhereInputToStructuredFilterRules("", COLUMNS)).toEqual({ rules: [], remainder: "" });
    expect(parseWhereInputToStructuredFilterRules(undefined, COLUMNS)).toEqual({ rules: [], remainder: "" });
    expect(parseWhereInputToStructuredFilterRules("status IN (1, 2) AND task_id = 1", COLUMNS, (mode) => mode !== "in")).toEqual({
      rules: [{ columnName: "task_id", mode: "equals", rawValue: "1", rawEndValue: "", conjunction: "AND" }],
      remainder: "status IN (1, 2)",
    });
  });
});
