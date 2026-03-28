import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActionInfo } from "@/types";

interface ActionPanelProps {
  actions: ActionInfo[];
  loading?: boolean;
  error?: string | null;
  onSelect: (name: string) => void;
}

export function ActionPanel({ actions, loading, error, onSelect }: ActionPanelProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Actions</h2>
      {loading && (
        <div className="text-sm text-muted-foreground">Loading actions...</div>
      )}
      {error && !loading && (
        <div className="text-sm text-destructive">{error}</div>
      )}
      {!loading && !error && actions.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No actions available.
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {actions.map((action) => (
          <Card
            key={action.name}
            className="cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
            onClick={() => onSelect(action.name)}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{action.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {action.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
