import { defineStore } from "pinia";
import { useAuthStore } from "./auth";

export interface CurrentProject {
  id: string;
  name: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  defaultBranch: string;
  messageTtlDefault: number;
  pushMirrorUrl: string | null;
  myRole: "READ" | "WRITE" | "ADMIN" | null;
  createdAt: string;
}

export const useProjectStore = defineStore("project", {
  state: () => ({
    current: null as CurrentProject | null,
    loading: false,
  }),
  getters: {
    isAdmin: (state) => state.current?.myRole === "ADMIN",
    canWrite: (state) => state.current?.myRole === "ADMIN" || state.current?.myRole === "WRITE",
  },
  actions: {
    async load(projectId: string) {
      this.loading = true;
      const auth = useAuthStore();
      const result = await auth.run({ action: "project.get", projectId });
      this.loading = false;
      if (result.ok) {
        this.current = result.data as CurrentProject;
      }
      return result;
    },
  },
});
