import { describe, expect, it } from "vitest";
import type { JdbcDialectConnection } from "@/lib/database/jdbcDialect";
import { buildAllDatabaseExportPlan, filterExportableSchemas, resolveExportSchema } from "@/lib/export/databaseExport";
import { XUGU_PUBLIC_SYNONYM_SCOPE, XUGU_SCHEDULER_JOB_SCOPE } from "@/lib/sidebar/xuguPublicSynonyms";

describe("database export schema selection", () => {
  it("hides Xugu synthetic tree scopes while preserving real schemas", () => {
    const schemas = ["APP_TEST", "GUEST", XUGU_PUBLIC_SYNONYM_SCOPE, XUGU_SCHEDULER_JOB_SCOPE];

    expect(filterExportableSchemas(schemas, "xugu")).toEqual(["APP_TEST", "GUEST"]);
  });

  it("does not apply Xugu filtering to other database types", () => {
    const schemas = ["APP_TEST", XUGU_PUBLIC_SYNONYM_SCOPE, XUGU_SCHEDULER_JOB_SCOPE];

    expect(filterExportableSchemas(schemas, "postgres")).toEqual(schemas);
  });

  it("excludes synthetic scopes from an all-database Xugu export plan", () => {
    expect(
      buildAllDatabaseExportPlan({
        databases: ["SHOP_DEMO"],
        schemaAware: true,
        dbType: "xugu",
        schemasByDatabase: {
          SHOP_DEMO: ["APP_TEST", XUGU_PUBLIC_SYNONYM_SCOPE, XUGU_SCHEDULER_JOB_SCOPE],
        },
      }),
    ).toEqual([
      {
        database: "SHOP_DEMO",
        schema: "APP_TEST",
        fileStem: "SHOP_DEMO",
        displayName: "SHOP_DEMO",
      },
    ]);
  });
});

describe("resolveExportSchema", () => {
  const mysqlJdbc: JdbcDialectConnection = {
    db_type: "jdbc",
    connection_string: "jdbc:mysql://127.0.0.1:3306/app",
    jdbc_driver_class: "com.mysql.cj.jdbc.Driver",
  };
  const mariadbJdbc: JdbcDialectConnection = {
    db_type: "jdbc",
    connection_string: "jdbc:mariadb://127.0.0.1:3306/app",
  };
  const postgresJdbc: JdbcDialectConnection = {
    db_type: "jdbc",
    connection_string: "jdbc:postgresql://127.0.0.1:5432/app",
  };

  it("uses the database as the schema when a JDBC MySQL connection reports no schemas (#15068)", () => {
    expect(resolveExportSchema({ connection: mysqlJdbc, database: "app", schemas: [] })).toEqual({ schemas: [], schema: "app" });
  });

  it("keeps the reported schema when a JDBC MySQL connection does list schemas", () => {
    expect(resolveExportSchema({ connection: mysqlJdbc, database: "app", schemas: ["app"] })).toEqual({ schemas: ["app"], schema: "app" });
  });

  it("prefers the preferred schema, then public, then the first schema", () => {
    expect(resolveExportSchema({ connection: mysqlJdbc, database: "app", schemas: ["public", "app"], preferredSchema: "app" })).toEqual({
      schemas: ["public", "app"],
      schema: "app",
    });
    expect(resolveExportSchema({ connection: mysqlJdbc, database: "app", schemas: ["public", "app"] })).toEqual({ schemas: ["public", "app"], schema: "public" });
    expect(resolveExportSchema({ connection: mysqlJdbc, database: "app", schemas: ["analytics", "app"] })).toEqual({ schemas: ["analytics", "app"], schema: "analytics" });
  });

  it("does not invent a schema for JDBC connections to schema databases", () => {
    expect(resolveExportSchema({ connection: postgresJdbc, database: "app", schemas: [] })).toEqual({ schemas: [], schema: "" });
  });

  it("does not invent a schema when the JDBC dialect cannot be identified", () => {
    expect(resolveExportSchema({ connection: { db_type: "jdbc" }, database: "app", schemas: [] })).toEqual({ schemas: [], schema: "" });
  });

  it("treats MariaDB like MySQL", () => {
    expect(resolveExportSchema({ connection: mariadbJdbc, database: "app", schemas: [] })).toEqual({ schemas: [], schema: "app" });
  });

  it("does not apply the JDBC fallback to native connections", () => {
    expect(resolveExportSchema({ connection: { db_type: "mysql" }, database: "app", schemas: [] })).toEqual({ schemas: [], schema: "" });
  });
});
