import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router";
import { Layout } from "@/components/Layout";
import { ProjectLayout } from "@/components/ProjectLayout";
import { RowsSkeleton } from "@/components/States";

const Dashboard = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const ShowcasePage = lazy(() => import("@/pages/ShowcasePage").then((m) => ({ default: m.ShowcasePage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const WorktreesPage = lazy(() => import("@/pages/WorktreesPage").then((m) => ({ default: m.WorktreesPage })));
const PipelinesPage = lazy(() => import("@/pages/PipelinesPage").then((m) => ({ default: m.PipelinesPage })));
const BacklogPage = lazy(() => import("@/pages/BacklogPage").then((m) => ({ default: m.BacklogPage })));
const PreviewsPage = lazy(() => import("@/pages/PreviewsPage").then((m) => ({ default: m.PreviewsPage })));
const SessionsPage = lazy(() => import("@/pages/SessionsPage").then((m) => ({ default: m.SessionsPage })));
const DocsPage = lazy(() => import("@/pages/DocsPage").then((m) => ({ default: m.DocsPage })));

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RowsSkeleton rows={6} className="m-4 h-8" />}>{children}</Suspense>;
}

function ToWorktrees() {
  const { id = "" } = useParams();
  return <Navigate to={`/p/${encodeURIComponent(id)}/worktrees`} replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Page><ShowcasePage /></Page>} />
        <Route path="projects" element={<Page><Dashboard /></Page>} />
        <Route path="settings" element={<Page><SettingsPage /></Page>} />
        <Route path="previews" element={<Page><PreviewsPage /></Page>} />
        <Route path="p/:id" element={<ProjectLayout />}>
          <Route index element={<ToWorktrees />} />
          <Route path="worktrees/:wt?" element={<Page><WorktreesPage /></Page>} />
          <Route path="pipelines" element={<Page><PipelinesPage /></Page>} />
          <Route path="sessions" element={<Page><SessionsPage /></Page>} />
          <Route path="docs/*" element={<Page><DocsPage /></Page>} />
          <Route path="backlog" element={<Page><BacklogPage /></Page>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
