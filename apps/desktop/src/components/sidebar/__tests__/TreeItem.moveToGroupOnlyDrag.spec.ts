// @vitest-environment happy-dom

import { createApp, defineComponent, h, nextTick, type App } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import TreeItem from "@/components/sidebar/TreeItem.vue";
import { createSidebarTreeRuntime, sidebarTreeRuntimeKey } from "@/lib/sidebar/sidebarTreeRuntime";
import type { TreeNode } from "@/types/database";

const reorderSidebarEntries = vi.fn();

const connectionStore = {
  activeConnectionId: "connection-1",
  connectedIds: new Set(["connection-1"]),
  connectingIds: new Set<string>(),
  connectionMultiSelectActive: false,
  connections: [],
  getConfig: () => ({ id: "connection-1", db_type: "sqlite" }),
  isDefaultDatabase: () => false,
  isDefaultSchema: () => false,
  isPinnedTreeNodeReorderTarget: () => false,
  isTreeNodeChildrenLoaded: () => false,
  isTreeNodePinned: () => false,
  reorderSidebarEntries,
  selectedTreeNodeId: null,
  selectedTreeNodeIds: [],
  selectedTreeNodeIdsSet: new Set<string>(),
  sidebarLayout: { order: [], groups: [] },
  sidebarTableSearchQueries: {},
  tableNameFilterForScope: () => undefined,
  treeNodes: [],
  treeSelectionAnchorId: null,
};

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: () => connectionStore,
}));

vi.mock("@/stores/queryStore", () => ({
  useQueryStore: () => ({ openDatabaseKeys: new Set<string>() }),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({
    editorSettings: {
      shortcuts: { openDataInNewTab: "" },
      sidebarActivation: "single",
      sidebarAllowHorizontalScroll: false,
      sidebarHiddenTablePrefixes: [],
      sidebarObjectInfoMode: "none",
      sidebarCopyTableNameSeparator: "comma",
      sidebarCopyTableNameIncludeSchema: false,
    },
  }),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const draggedGroup: TreeNode = {
  id: "group-nested",
  label: "Nested",
  type: "connection-group",
  connectionId: "connection-1",
};

const rootGroup: TreeNode = {
  id: "group-root",
  label: "Root",
  type: "connection-group",
  connectionId: "connection-1",
};

const otherNestedGroup: TreeNode = {
  id: "group-other-nested",
  label: "Other nested",
  type: "connection-group",
  connectionId: "connection-1",
};

const mountedApps: App[] = [];

async function mountRows(target: { node: TreeNode; depth: number; moveToGroupOnly: boolean }) {
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp(
    defineComponent({
      setup: () => () => h("div", [h(TreeItem, { node: draggedGroup, depth: 1, moveToGroupOnly: target.moveToGroupOnly }), h(TreeItem, { node: target.node, depth: target.depth, moveToGroupOnly: target.moveToGroupOnly })]),
    }),
  );
  mountedApps.push(app);
  app.use(i18n);
  app.provide(sidebarTreeRuntimeKey, createSidebarTreeRuntime());
  app.mount(container);
  await nextTick();

  const rows = container.querySelectorAll<HTMLElement>("[tabindex]");
  if (rows.length !== 2) throw new Error(`Expected 2 tree rows, got ${rows.length}: ${container.innerHTML}`);
  return { draggedRow: rows[0], targetRow: rows[1] };
}

function dragToTarget(draggedRow: HTMLElement, targetRow: HTMLElement) {
  draggedRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1, clientX: 20, clientY: 20 }));
  targetRow.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1, clientX: 20, clientY: 20 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 20, clientY: 20 }));
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  document.body.innerHTML = "";
  reorderSidebarEntries.mockClear();
  vi.restoreAllMocks();
});

describe("TreeItem move-to-group-only dragging", () => {
  it("allows dropping a nested folder before/after a root-level row, moving it back to the root", async () => {
    const { draggedRow, targetRow } = await mountRows({ node: rootGroup, depth: 0, moveToGroupOnly: true });
    dragToTarget(draggedRow, targetRow);

    expect(reorderSidebarEntries).toHaveBeenCalledExactlyOnceWith(["group-nested"], "group-root", "after", { preserveSameGroupOrder: true });
  });

  it("still blocks before/after drops on nested rows while sorted", async () => {
    const { draggedRow, targetRow } = await mountRows({ node: otherNestedGroup, depth: 1, moveToGroupOnly: true });
    dragToTarget(draggedRow, targetRow);

    expect(reorderSidebarEntries).not.toHaveBeenCalled();
  });

  it("allows before/after drops on nested rows in manual order", async () => {
    const { draggedRow, targetRow } = await mountRows({ node: otherNestedGroup, depth: 1, moveToGroupOnly: false });
    dragToTarget(draggedRow, targetRow);

    expect(reorderSidebarEntries).toHaveBeenCalledExactlyOnceWith(["group-nested"], "group-other-nested", "after", { preserveSameGroupOrder: false });
  });
});
