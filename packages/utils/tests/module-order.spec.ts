/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { IModule, TModuleOrderByOptions } from "@plane/types";
import { getModuleSortOrderOnDrop, groupModulesByStatus, orderModules } from "../src/module";

const mod = (id: string, sort_order: number): IModule => ({ id, name: id, sort_order }) as IModule;

const withStatus = (id: string, status?: string): IModule => ({ id, name: id, status }) as IModule;
const ids = (list: IModule[] | undefined) => (list ?? []).map((m) => m.id);

const modules = [mod("c", 300), mod("a", 100), mod("b", 200)];

describe("orderModules", () => {
  it("orders by the manual sort order", () => {
    expect(orderModules(modules, "sort_order").map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("still lists every module when a descending manual order was saved", () => {
    const saved = "-sort_order" as TModuleOrderByOptions;
    expect(orderModules(modules, saved).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("groupModulesByStatus", () => {
  it("puts each module in its status column and keeps the incoming order", () => {
    const grouped = groupModulesByStatus(
      [withStatus("b", "planned"), withStatus("x", "completed"), withStatus("a", "planned")],
      ["backlog", "planned", "completed"]
    );
    expect(ids(grouped.planned)).toEqual(["b", "a"]);
    expect(ids(grouped.completed)).toEqual(["x"]);
    expect(ids(grouped.backlog)).toEqual([]);
  });

  it("keeps a module with a missing or unknown status in the first column", () => {
    const grouped = groupModulesByStatus([withStatus("none"), withStatus("odd", "archived")], ["backlog", "planned"]);
    expect(ids(grouped.backlog)).toEqual(["none", "odd"]);
  });
});

describe("getModuleSortOrderOnDrop", () => {
  const column = [mod("a", 100), mod("b", 200), mod("c", 300)];

  it("lands between two cards when dropped on the top half of the lower one", () => {
    expect(getModuleSortOrderOnDrop(column, "c", "b", "top")).toBe(150);
  });

  it("lands between two cards when dropped on the bottom half of the upper one", () => {
    expect(getModuleSortOrderOnDrop(column, "a", "b", "bottom")).toBe(250);
  });

  it("goes before the first card and after the last one", () => {
    expect(getModuleSortOrderOnDrop(column, "c", "a", "top")).toBe(-9900);
    expect(getModuleSortOrderOnDrop(column, "a", "c", "bottom")).toBe(10300);
  });

  it("goes to the end when dropped on the column's empty space", () => {
    expect(getModuleSortOrderOnDrop(column, "a", undefined)).toBe(10300);
  });

  it("places a card arriving from another column", () => {
    expect(getModuleSortOrderOnDrop(column, "x", "b", "top")).toBe(150);
    expect(getModuleSortOrderOnDrop(column, "x", undefined)).toBe(10300);
  });

  it("changes nothing when the card is already in that slot", () => {
    expect(getModuleSortOrderOnDrop(column, "b", "b", "top")).toBeUndefined();
    expect(getModuleSortOrderOnDrop(column, "b", "a", "bottom")).toBeUndefined();
    expect(getModuleSortOrderOnDrop(column, "b", "c", "top")).toBeUndefined();
    expect(getModuleSortOrderOnDrop(column, "c", undefined)).toBeUndefined();
  });

  it("never reuses a sort order held by a module in another column", () => {
    // 90 and 310 belong to other columns and sit just outside this one
    const others = [90, 100, 200, 300, 310, -5000, 9000];
    expect(getModuleSortOrderOnDrop(column, "x", "a", "top", others)).toBe(95);
    expect(getModuleSortOrderOnDrop(column, "x", "c", "bottom", others)).toBe(305);
  });

  it("leaves the order alone when the destination column is empty", () => {
    expect(getModuleSortOrderOnDrop([], "x", undefined)).toBeUndefined();
  });
});
