import { InfoIcon } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

interface InfoHoverProps {
  text: string;
  className?: string;
}

export function InfoHover({ text, className }: InfoHoverProps) {
  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-full border bg-background text-muted-foreground w-4 h-4",
            className
          )}
          aria-label="Info"
        >
          <InfoIcon className="w-3 h-3" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="text-xs leading-relaxed">
        {text}
      </HoverCardContent>
    </HoverCard>
  );
}
