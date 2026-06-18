import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";

export interface RecentProject {
  id: string;
  name: string;
  updatedAt: string;
  thumbnailDataUrl?: string;
}

export interface ProjectStore {
  currentProjectId: string | null;
  currentProjectName: string;
  isDirty: boolean;
  recentProjects: RecentProject[];

  setProjectName: (n: string) => void;
  markDirty: () => void;
  markSaved: (id: string) => void;
  loadRecentProjects: () => void;
  addRecentProject: (p: RecentProject) => void;
  newProject: () => void;
}

const RECENT_KEY = "g3d-recent-projects";

export const useProjectStore = create<ProjectStore>((set) => ({
  currentProjectId: null,
  currentProjectName: "Untitled Project",
  isDirty: false,
  recentProjects: [],

  setProjectName: (n) => set({ currentProjectName: n, isDirty: true }),
  markDirty: () => set({ isDirty: true }),
  markSaved: (id) => set({ currentProjectId: id, isDirty: false }),

  loadRecentProjects: () => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const projects: RecentProject[] = raw ? JSON.parse(raw) : [];
      set({ recentProjects: projects });
    } catch {}
  },

  addRecentProject: (p) => {
    set((state) => {
      const updated = [p, ...state.recentProjects.filter((r) => r.id !== p.id)].slice(0, 10);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(updated)); } catch {}
      return { recentProjects: updated };
    });
  },

  newProject: () =>
    set({
      currentProjectId: uuidv4(),
      currentProjectName: "Untitled Project",
      isDirty: false,
    }),
}));
