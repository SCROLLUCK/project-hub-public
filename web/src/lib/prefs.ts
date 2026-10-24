import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, useProjects, type Project } from "./api";

/** Pin / hide go through the toggle endpoints; the projects query carries the flags. */
export function usePrefs() {
  const qc = useQueryClient();
  const projects = useProjects();
  const toggle = useMutation({
    mutationFn: ({ id, key }: { id: string; key: "pin" | "hide" }) => api(`/projects/${encodeURIComponent(id)}/${key}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  const pinned = new Set((projects.data ?? []).filter((p) => p.pinned).map((p) => p.id));
  return {
    pinned,
    togglePin: (id: string) => toggle.mutate({ id, key: "pin" }),
    toggleHide: (id: string) => toggle.mutate({ id, key: "hide" }),
  };
}

/** Visible projects: pinned first, then newest commit first (server order is kept). */
export function useVisibleProjects(): { projects: Project[]; query: ReturnType<typeof useProjects> } {
  const query = useProjects();
  const projects = (query.data ?? []).filter((p) => !p.hidden);
  return { projects, query };
}
