import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderField } from "@/hooks/use-providers";

interface Props {
  field: ProviderField;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}

/**
 * Renders one provider-declared field to its control. Descriptor-driven: the
 * field's `kind`, range, and options come from the Rust provider descriptor,
 * so adding a provider/field needs no new form code.
 */
export function ProviderFieldControl({ field, value, onChange }: Props) {
  const set = (v: unknown) => onChange(field.name, v);

  if (field.kind === "bool") {
    return (
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-normal">{field.label}</Label>
        <Switch checked={Boolean(value)} onCheckedChange={set} />
      </div>
    );
  }

  if (field.kind === "slider") {
    const num = typeof value === "number" ? value : Number(value ?? field.min ?? 0);
    return (
      <div>
        <Label className="text-sm">
          {field.label} - {num}
        </Label>
        <Slider
          className="mt-2"
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.step ?? 1}
          value={[num]}
          onValueChange={([v]) => set(v)}
        />
        {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
      </div>
    );
  }

  if (field.kind === "select") {
    return (
      <div>
        <Label className="text-sm">{field.label}</Label>
        <Select value={String(value ?? "")} onValueChange={set}>
          <SelectTrigger className="mt-1 w-full">
            <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
      </div>
    );
  }

  if (field.kind === "textarea") {
    return (
      <div>
        <Label className="text-sm">{field.label}</Label>
        <textarea
          className="mt-1 w-full min-h-16 rounded-md border bg-background px-3 py-2 text-sm"
          value={String(value ?? "")}
          onChange={(e) => set(e.target.value)}
        />
        {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
      </div>
    );
  }

  if (field.kind === "number") {
    return (
      <div>
        <Label className="text-sm">{field.label}</Label>
        <Input
          className="mt-1"
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))}
        />
        {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
      </div>
    );
  }

  // text (default)
  return (
    <div>
      <Label className="text-sm">{field.label}</Label>
      <Input
        className="mt-1"
        value={String(value ?? "")}
        onChange={(e) => set(e.target.value)}
        placeholder={field.help}
      />
    </div>
  );
}
