import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ExternalLink, FolderOutput, Pencil, Trash2 } from "lucide-react";
import type { VideoEntry } from "@/types";

interface MediaContextMenuProps {
  children: ReactNode;
  media: VideoEntry;
  onRename: (media: VideoEntry) => void;
  onMove: (media: VideoEntry) => void;
  onDelete: (media: VideoEntry) => void;
  onReveal: (media: VideoEntry) => void;
  disabled?: boolean;
  wrapperClassName?: string;
}

export function MediaContextMenu({
  children,
  media,
  onRename,
  onMove,
  onDelete,
  onReveal,
  disabled,
  wrapperClassName,
}: MediaContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={wrapperClassName}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onReveal(media)} disabled={disabled} className="gap-2">
          <ExternalLink className="h-3.5 w-3.5" />
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onRename(media)} disabled={disabled} className="gap-2">
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onMove(media)} disabled={disabled} className="gap-2">
          <FolderOutput className="h-3.5 w-3.5" />
          Move
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => onDelete(media)}
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
