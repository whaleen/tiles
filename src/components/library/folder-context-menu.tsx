import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { FolderOpen, Pencil, FolderOutput, Trash2, Download, ExternalLink } from "lucide-react";

interface FolderContextMenuProps {
  children: ReactNode;
  folderPath: string;
  folderLabel: string;
  onNavigate: (path: string) => void;
  onRename: (path: string) => void;
  onMove: (path: string) => void;
  onDelete: (path: string) => void;
  onImport?: (path: string) => void;
  onReveal?: (path: string) => void;
  disabled?: boolean;
}

export function FolderContextMenu({
  children,
  folderPath,
  folderLabel,
  onNavigate,
  onRename,
  onMove,
  onDelete,
  onImport,
  onReveal,
  disabled,
}: FolderContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => onNavigate(folderPath)}
          className="gap-2"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Open "{folderLabel}"
        </ContextMenuItem>
        <ContextMenuSeparator />
        {onImport && (
          <ContextMenuItem
            onClick={() => onImport(folderPath)}
            disabled={disabled}
            className="gap-2"
          >
            <Download className="h-3.5 w-3.5" />
            Import files here
          </ContextMenuItem>
        )}
        {onReveal && (
          <ContextMenuItem
            onClick={() => onReveal(folderPath)}
            disabled={disabled}
            className="gap-2"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Reveal in Finder
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => onRename(folderPath)}
          disabled={disabled}
          className="gap-2"
        >
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onMove(folderPath)}
          disabled={disabled}
          className="gap-2"
        >
          <FolderOutput className="h-3.5 w-3.5" />
          Move
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => onDelete(folderPath)}
          disabled={disabled}
          className="gap-2 text-destructive focus:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
