import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { InfoHover } from "@/components/ui/info-hover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FolderAssignmentProps {
  tileCount: number;
  folders: string[];
  folderOptions: string[];
  folderThumbs?: Record<string, string[]>;
  onChange: (folders: string[]) => void;
  openTileIndex?: number | null;
  onOpenTileChange?: (index: number | null) => void;
  inline?: boolean;
}

export function FolderAssignment({
  tileCount,
  folders,
  folderOptions,
  folderThumbs,
  onChange,
  openTileIndex,
  onOpenTileChange,
  inline = true,
}: FolderAssignmentProps) {
  const [openTile, setOpenTile] = useState<number | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [search, setSearch] = useState("");
  const controlled = openTileIndex !== undefined;
  const activeTile = controlled ? openTileIndex : openTile;

  const optionSet = useMemo(() => new Set(folderOptions), [folderOptions]);

  const update = (index: number, value: string) => {
    const next = [...folders];
    while (next.length < tileCount) next.push("");
    next[index] = value === "__none__" ? "" : value;
    onChange(next);
  };

  const openPicker = (index: number) => {
    const selected = folders[index] || "";
    if (controlled) {
      onOpenTileChange?.(index);
    } else {
      setOpenTile(index);
    }
    setSearch("");
    setCurrentPath(getParentPath(selected));
  };

  const closePicker = () => {
    if (controlled) {
      onOpenTileChange?.(null);
    } else {
      setOpenTile(null);
    }
    setSearch("");
  };

  const selectFolder = (path: string) => {
    if (activeTile === null || activeTile === undefined) return;
    update(activeTile, path);
    closePicker();
  };

  useEffect(() => {
    if (!controlled) return;
    if (openTileIndex === null || openTileIndex === undefined) {
      setOpenTile(null);
      return;
    }
    setOpenTile(openTileIndex);
  }, [controlled, openTileIndex]);

  const hasChildren = (path: string) => {
    const prefix = path ? `${path}/` : "";
    return folderOptions.some((f) => f.startsWith(prefix) && f !== path);
  };

  const children = useMemo(() => {
    const prefix = currentPath ? `${currentPath}/` : "";
    const unique = new Map<string, string>();
    for (const folder of folderOptions) {
      if (currentPath && !folder.startsWith(prefix)) continue;
      const remainder = currentPath ? folder.slice(prefix.length) : folder;
      const segment = remainder.split("/")[0];
      if (!segment) continue;
      const path = currentPath ? `${currentPath}/${segment}` : segment;
      if (!unique.has(path)) {
        unique.set(path, segment);
      }
    }
    return Array.from(unique.entries()).map(([path, label]) => ({ path, label }));
  }, [folderOptions, currentPath]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as string[];
    return folderOptions.filter((f) => f.toLowerCase().includes(q)).slice(0, 100);
  }, [folderOptions, search]);

  return (
    <div>
      {inline && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-medium">Folder Assignment</h3>
            <InfoHover text="Assign a folder (including subfolders) to each tile. These folders determine which clips are used in the layout." />
          </div>
          <div className="space-y-2">
            {Array.from({ length: tileCount }, (_, i) => {
              const selected = folders[i] || "";
              const thumbs = selected ? folderThumbs?.[selected] : null;
              return (
                <div key={i} className="flex items-center gap-2">
                  <Label className="text-xs w-12">Tile {i}</Label>
                  <div className="w-12 h-8 rounded border bg-muted overflow-hidden flex items-center justify-center text-[10px] text-muted-foreground">
                    {thumbs && thumbs.length > 0 ? (
                      thumbs.length === 1 ? (
                        <img
                          src={thumbs[0]}
                          alt={selected}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid grid-cols-2 gap-0.5 w-full h-full">
                          {thumbs.slice(0, 4).map((src, idx) => (
                            <img
                              key={`${selected}-thumb-${idx}`}
                              src={src}
                              alt={selected}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ))}
                        </div>
                      )
                    ) : (
                      "--"
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs justify-start w-full"
                    onClick={() => openPicker(i)}
                  >
                    {selected || "Select folder..."}
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Dialog
        open={activeTile !== null && activeTile !== undefined}
        onOpenChange={(open) => !open && closePicker()}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Choose folder</DialogTitle>
            <DialogDescription>
              Pick a folder for Tile {activeTile ?? 0}. Browse by hierarchy or search.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCurrentPath(getParentPath(currentPath))}
              disabled={!currentPath}
            >
              Up
            </Button>
            {currentPath && optionSet.has(currentPath) && (
              <Button size="sm" onClick={() => selectFolder(currentPath)}>
                Use {currentPath}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => activeTile !== null && update(activeTile, "")}
            >
              Clear
            </Button>
            <div className="flex-1" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search folders..."
            />
          </div>
          {searchResults.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[360px] overflow-auto">
              {searchResults.map((path) => (
                <button
                  key={path}
                  className="flex items-center gap-3 p-2 border rounded hover:bg-accent/50 text-left"
                  onClick={() => selectFolder(path)}
                >
                  <div className="w-16 h-10 rounded border bg-muted overflow-hidden">
                    {folderThumbs?.[path] && folderThumbs[path].length > 0 ? (
                      folderThumbs[path].length === 1 ? (
                        <img
                          src={folderThumbs[path][0]}
                          alt={path}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid grid-cols-2 gap-0.5 w-full h-full">
                          {folderThumbs[path].slice(0, 4).map((src, idx) => (
                            <img
                              key={`${path}-thumb-${idx}`}
                              src={src}
                              alt={path}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ))}
                        </div>
                      )
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{path}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[360px] overflow-auto">
              {children.map((child) => {
                const thumbs = folderThumbs?.[child.path] ?? null;
                const childHasKids = hasChildren(child.path);
                return (
                  <div key={child.path} className="border rounded p-2">
                    <button
                      className="w-full text-left"
                      onClick={() =>
                        childHasKids
                          ? setCurrentPath(child.path)
                          : selectFolder(child.path)
                      }
                    >
                      <div className="h-20 rounded bg-muted overflow-hidden">
                        {thumbs && thumbs.length > 0 ? (
                          thumbs.length === 1 ? (
                            <img
                              src={thumbs[0]}
                              alt={child.label}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="grid grid-cols-2 gap-1 w-full h-full">
                              {thumbs.slice(0, 4).map((src, idx) => (
                                <img
                                  key={`${child.path}-thumb-${idx}`}
                                  src={src}
                                  alt={child.label}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ))}
                            </div>
                          )
                        ) : (
                          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                            No preview
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-2 truncate">
                        {child.label}
                      </div>
                    </button>
                    {childHasKids && optionSet.has(child.path) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 w-full text-xs"
                        onClick={() => selectFolder(child.path)}
                      >
                        Use this folder
                      </Button>
                    )}
                  </div>
                );
              })}
              {children.length === 0 && (
                <div className="text-xs text-muted-foreground">No folders found.</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getParentPath(path: string) {
  if (!path) return "";
  const parts = path.split("/").slice(0, -1);
  return parts.join("/");
}
