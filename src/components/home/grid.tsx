import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeading } from "@/components/ui";
import type { Tile as HomeTile } from "@/modules/home/service";
import { Tile } from "./tile";

// "Home, Ada": the first word of the person's name, or just "Home" without one.
export async function HomeHeading({ name, children }: { name: string; children?: ReactNode }) {
  const t = await getTranslations("home");
  const first = name.trim().split(/\s+/)[0] ?? "";
  return <PageHeading title={first ? t("title", { name: first }) : t("titleAnonymous")}>{children}</PageHeading>;
}

// The tiles, one column on phones and two from md up.
export function TileGrid({ tiles }: { tiles: HomeTile[] }) {
  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      {tiles.map((tile) => (
        <Tile key={tile.id} tile={tile} />
      ))}
    </div>
  );
}

// What shows while a home loads: the same grid of blank tiles.
export function HomeSkeleton({ tiles = 6 }: { tiles?: number }) {
  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-2" aria-hidden="true">
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-inner bg-paper" />
      ))}
    </div>
  );
}

// The page body every home shares with the other role pages.
export function HomeShell({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      {children}
    </main>
  );
}
