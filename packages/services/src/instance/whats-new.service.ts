/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import type { TWhatsNew, TWhatsNewPayload } from "@plane/types";
// api service
import { APIService } from "../api.service";

/**
 * Geotech3D: What's new notes. The instance admin writes and sends them from god-mode;
 * every user gets the ones they haven't seen yet, once.
 */
export class WhatsNewService extends APIService {
  constructor(baseURL: string = API_BASE_URL) {
    super(baseURL);
  }

  // god-mode
  async list(): Promise<TWhatsNew[]> {
    return this.get("/api/instances/whats-new/")
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(data: TWhatsNewPayload): Promise<TWhatsNew> {
    return this.post("/api/instances/whats-new/", data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(id: string, data: Partial<TWhatsNewPayload>): Promise<TWhatsNew> {
    return this.patch(`/api/instances/whats-new/${id}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async remove(id: string): Promise<void> {
    return this.delete(`/api/instances/whats-new/${id}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async send(id: string): Promise<TWhatsNew> {
    return this.post(`/api/instances/whats-new/${id}/send/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // the signed-in user
  async unseen(): Promise<TWhatsNew[]> {
    return this.get("/api/users/me/whats-new/")
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async markSeen(seenUpTo: string): Promise<void> {
    return this.post("/api/users/me/whats-new/seen/", { seen_up_to: seenUpTo })
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
