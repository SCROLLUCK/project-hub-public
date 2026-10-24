import { FolderGit2, Menu, Monitor, Moon, Pin, Search, Settings, Sun } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo, useEffect } from "react";
import { usePrefs, useVisibleProjects } from "@/lib/prefs";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useRunning } from "@/lib/api";
import { Hint } from "./Hint";
import { Logo } from "./Logo";
import { ProviderIcon } from "./ProviderIcon";
import { QuotaWidget } from "./QuotaWidget";

function SidebarList({ onNavigate }: { onNavigate?: () => void }) {
  const [q, setQ] = useState("");
  const { projects, query } = useVisibleProjects();
  const { pinned } = usePrefs();
  const shown = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())), [projects, q]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative px-3">
        <Search className="pointer-events-none absolute left-5.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label="Search projects" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
      </div>
      <nav aria-label="Projects" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {query.isLoading && (
          <div className="flex flex-col gap-1.5 px-1">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}
        {query.isError && <p className="px-2 text-sm text-destructive">Could not load projects.</p>}
        {query.isSuccess && shown.length === 0 && <p className="px-2 text-sm text-muted-foreground">No projects</p>}
        <ul className="flex flex-col gap-0.5">
          {shown.map((p) => (
            <li key={p.id}>
              <NavLink
                to={`/p/${encodeURIComponent(p.id)}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                    isActive ? "bg-accent font-semibold" : "text-foreground/90",
                  )
                }
              >
                <ProviderIcon provider={p.provider ?? "other"} className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {pinned.has(p.id) && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
                {p.dirty > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.dirty}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function ProjectsLink() {
  return (
    <NavLink
      to="/projects"
      className={({ isActive }) =>
        cn("flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:text-foreground", isActive ? "font-semibold text-foreground" : "text-muted-foreground")
      }
    >
      <FolderGit2 className="size-4" aria-hidden />
      <span className="hidden sm:inline">Projects</span>
    </NavLink>
  );
}

function PreviewsLink() {
  const n = useRunning().data?.length ?? 0;
  return (
    <NavLink
      to="/previews"
      className={({ isActive }) =>
        cn("flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:text-foreground", isActive ? "font-semibold text-foreground" : "text-muted-foreground")
      }
    >
      <Monitor className="size-4" aria-hidden />
      <span className="hidden sm:inline">Previews</span>
      {n > 0 && (
        <Hint text="Dev servers listening right now: hub previews, local processes and docker containers.">
          <span aria-label={`${n} running`} className="min-w-5 rounded-full border px-1.5 text-center text-xs font-semibold tabular-nums text-foreground">
            {n}
          </span>
        </Hint>
      )}
    </NavLink>
  );
}

export function Layout() {
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card pt-3 md:flex">
        <Link to="/" className="mx-3 mb-3 flex items-center gap-2 rounded-md px-2 py-1 text-base font-semibold">
          <Logo />
          Project Hub
        </Link>
        <SidebarList />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-card p-0 pt-3">
          <SheetHeader className="px-5 pb-3">
            <SheetTitle className="flex items-center gap-2">
              <Logo />
              Project Hub
            </SheetTitle>
            <SheetDescription className="sr-only">Project list</SheetDescription>
          </SheetHeader>
          <SidebarList onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open project list" onClick={() => setOpen(true)}>
            <Menu />
          </Button>
          <Link to="/" className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold md:hidden">
            <Logo className="size-5" />
            Project Hub
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <QuotaWidget />
            <ProjectsLink />
            <PreviewsLink />
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" size="icon" asChild aria-label="Settings">
              <Link to="/settings">
                <Settings />
              </Link>
            </Button>
          </div>
        </header>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
