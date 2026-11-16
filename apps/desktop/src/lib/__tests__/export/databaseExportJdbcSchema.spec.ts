import { describe, expect, it } from "vitest";
import { jdbcMysqlConnectionUsesDatabaseAsSchema } from "@/lib/export/databaseExport";

describe("jdbcMysqlConnectionUsesDatabaseAsSchema", () => {
  it("treats a generic JDBC connection to MySQL as database-as-schema (#15068)", () => {
    expect(jdbcMysqlConnectionUsesDatabaseAsSchema({ db_type: "jdbc", connection_string: "jdbc:mysql://db.example.test:3306/mydb" })).toBe(true);
  });

  it("treats a MariaDB JDBC connection the same way", () => {
    expect(jdbcMysqlConnectionUsesDatabaseAsSchema({ db_type: "jdbc", connection_string: "jdbc:mariadb://db.example.test:3306/mydb" })).toBe(true);
  });

  it("does not apply to a generic JDBC connection to PostgreSQL", () => {
    expect(jdbcMysqlConnectionUsesDatabaseAsSchema({ db_type: "jdbc", connection_string: "jdbc:postgresql://db.example.test:5432/mydb" })).toBe(false);
  });

  it("does not apply to a native MySQL connection", () => {
    expect(jdbcMysqlConnectionUsesDatabaseAsSchema({ db_type: "mysql", connection_string: "jdbc:mysql://db.example.test:3306/mydb" })).toBe(false);
  });

  it("does not apply to a JDBC connection with no recognizable dialect", () => {
    expect(jdbcMysqlConnectionUsesDatabaseAsSchema({ db_type: "jdbc", connection_string: "jdbc:example://db.example.test:1234/mydb" })).toBe(false);
  });

  it("returns false without a connection", () => {
    expect(jdbcMysqlConnectionUsesDatabaseAsSchema(undefined)).toBe(false);
  });
});
