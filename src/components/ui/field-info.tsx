import { Label } from "@/components/ui/label";
import { InfoHover } from "@/components/ui/info-hover";
import { cn } from "@/lib/utils";

interface FieldInfoProps {
  label: string;
  info: string;
  className?: string;
  labelClassName?: string;
}

export function FieldInfo({ label, info, className, labelClassName }: FieldInfoProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Label className={labelClassName}>{label}</Label>
      <InfoHover text={info} />
    </div>
  );
}
