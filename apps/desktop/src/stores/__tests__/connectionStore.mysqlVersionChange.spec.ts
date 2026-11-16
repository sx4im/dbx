import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/types/database";

const mocks = vi.hoisted(() => ({
  checkConnectionHealth: vi.fn().mockResolvedValue(undefined),
  connectionDatabaseInfo: vi.fn().mockResolvedValue({ productName: "MySQL", productVersion: "5.7.26" }),
  deleteSchemaCachePrefix: vi.fn().mockResolvedValue(undefined),
  getColumns: vi.fn().mockResolvedValue([]),
  listDatabases: vi.fn().mockResolvedValue([{ name: "db57" }]),
  listInstalledAgents: vi.fn().mockResolvedValue([]),
  listObjects: vi.fn().mockResolvedValue([]),
  listSchemas: vi.fn().mockResolvedValue([]),
  listTables: vi.fn().mockResolvedValue([]),
  listTriggers: vi.fn().mockResolvedValue([]),
  loadSchemaCache: vi.fn().mockResolvedValue(null),
  saveConnectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
  saveConnections: vi.fn().mockResolvedValue(undefined),
  saveSchemaCache: vi.fn().mockResolvedValue(undefined),
  saveSidebarLayout: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/backend/api", () => mocks);
vi.mock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => false }));

function installLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
    removeItem: vi.fn((key: string) => data.delete(key)),
  });
}

async function mysqlStore(options?: { expanded?: boolean }) {
  const { useConnectionStore } = await import("@/stores/connectionStore");
  const store = useConnectionStore();
  const connection = {
    id: "mysql-1",
    name: "MySQL",
    db_type: "mysql",
    host: "127.0.0.1",
    port: 3306,
    username: "root",
    password: "",
    database: "",
    database_info: { productName: "MySQL", productVersion: "5.7.26" },
  } as ConnectionConfig;
  store.connections = [connection];
  store.connectedIds.add(connection.id);
  store.treeNodes = [
    {
      id: connection.id,
      label: connection.name,
      type: "connection",
      connectionId: connection.id,
      isExpanded: options?.expanded ?? true,
      children: [],
    },
  ];
  return store;
}

function databaseLabels(store: { treeNodes: { children?: { label?: string; type?: string }[] }[] }): (string | undefined)[] {
  return (store.treeNodes[0]?.children ?? []).filter((child) => child.type === "database").map((child) => child.label);
}

describe("connectionStore MySQL server-version change (#15034)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    installLocalStorage();
    setActivePinia(createPinia());
    mocks.listDatabases.mockResolvedValue([{ name: "db57" }]);
  });

  it("reloads the database list when the detected MySQL server version changes", async () => {
    const store = await mysqlStore();
    mocks.listDatabases.mockResolvedValueOnce([{ name: "db57" }]);
    mocks.listDatabases.mockResolvedValue([{ name: "db80" }]);
    await store.loadDatabases("mysql-1", { force: true });
    expect(databaseLabels(store)).toEqual(["db57"]);

    // The server behind the same connection was swapped from MySQL 5.7 to 8.0;
    // background version detection now reports 8.0.12. The sidebar must show
    // the 8.0 databases instead of the stale 5.7 list.
    await store.updateConnectionDatabaseInfo("mysql-1", { productName: "MySQL", productVersion: "8.0.12" });
    await vi.waitFor(() => expect(mocks.listDatabases).toHaveBeenCalledTimes(2));
    expect(databaseLabels(store)).toEqual(["db80"]);
  }, 30_000);

  it("keeps the loaded database list when the server version is unchanged", async () => {
    const store = await mysqlStore();
    await store.loadDatabases("mysql-1", { force: true });
    expect(mocks.listDatabases).toHaveBeenCalledTimes(1);

    // Another metadata field changed but the server is the same: no reload.
    await store.updateConnectionDatabaseInfo("mysql-1", { productName: "MySQL", productVersion: "5.7.26", serverCharset: "utf8mb4" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.listDatabases).toHaveBeenCalledTimes(1);
    expect(databaseLabels(store)).toEqual(["db57"]);
  }, 30_000);

  it("drops the persisted database cache when the version changes while the connection node is collapsed", async () => {
    const store = await mysqlStore({ expanded: false });
    await store.updateConnectionDatabaseInfo("mysql-1", { productName: "MySQL", productVersion: "8.0.12" });
    expect(mocks.deleteSchemaCachePrefix).toHaveBeenCalledWith("mysql-1:");
    expect(mocks.listDatabases).not.toHaveBeenCalled();
  }, 30_000);
});
