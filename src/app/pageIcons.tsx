// One icon per screen, shared by the sidebar and the command palette.
import { CalendarDays, ChartNoAxesColumn, Clock3, FileText, FlaskConical, FlaskRound, FolderGit2, Gamepad2, Gauge, GitBranch, GraduationCap, LayoutTemplate, LibraryBig, MonitorPlay, Network, PawPrint, PenLine, PenTool, Settings, Sun, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { Page } from "../lib/store";

const ic = "size-4";
export const PAGE_ICON: Record<Page, ReactNode> = {
  overview: <Sun className={ic} />,
  projects: <FolderGit2 className={ic} />,
  git: <GitBranch className={ic} />,
  library: <LibraryBig className={ic} />,
  testing: <FlaskConical className={ic} />,
  subjects: <FileText className={ic} />,
  analytics: <ChartNoAxesColumn className={ic} />,
  templates: <LayoutTemplate className={ic} />,
  myepitech: <GraduationCap className={ic} />,
  skilltree: <Network className={ic} />,
  logtime: <Clock3 className={ic} />,
  cozy: <PawPrint className={ic} />,
  settings: <Settings className={ic} />,
  agenda: <CalendarDays className={ic} />,
  prompts: <PenLine className={ic} />,
  playground: <FlaskRound className={ic} />,
  arena: <Gauge className={ic} />,
  boards: <PenTool className={ic} />,
  connect: <Users className={ic} />,
  live: <MonitorPlay className={ic} />,
  space: <Gamepad2 className={ic} />,
};
