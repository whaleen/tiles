import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

// Mirror of the Rust provider descriptor (commands/providers.rs). This is the
// single source of truth the AI-actions UI renders from.
export interface ProviderField {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "slider" | "select" | "bool";
  group: "core" | "advanced";
  required: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  help?: string;
}

export interface ProviderModel {
  id: string;
  label: string;
  default: boolean;
}

export interface CapabilityInfo {
  capability: string;
  label: string;
  description: string;
  input_media: "image" | "video" | "text";
  output_media: "image" | "video";
  models: ProviderModel[];
  fields: ProviderField[];
}

export interface ProviderInfo {
  id: string;
  label: string;
  docs_url?: string | null;
  capabilities: CapabilityInfo[];
}

export function useProviders() {
  const { data } = useQuery({
    queryKey: ["providers"],
    queryFn: () => invoke<ProviderInfo[]>("list_providers"),
    staleTime: Infinity,
  });
  return data ?? [];
}

export function useActiveProvider() {
  const providers = useProviders();
  const { data: storedId } = useQuery({
    queryKey: ["active-provider"],
    queryFn: () => invoke<string | null>("get_active_provider"),
    staleTime: 30_000,
  });
  // Fall back to the first declared provider so the scaffold works before the
  // user explicitly picks one in Settings.
  const activeId = storedId ?? providers[0]?.id ?? null;
  const active = providers.find((p) => p.id === activeId) ?? null;
  return { providers, activeId, active };
}

/**
 * Two-factor gating helper. A "capability action" is any action whose name is a
 * capability declared by some provider. It is enabled only when the *active*
 * provider supports it — mirroring how media-type gating already works.
 */
export function useCapabilityGating() {
  const { providers, active } = useActiveProvider();

  const allCapabilityNames = useMemo(
    () => new Set(providers.flatMap((p) => p.capabilities.map((c) => c.capability))),
    [providers]
  );
  const activeSupported = useMemo(
    () => new Set((active?.capabilities ?? []).map((c) => c.capability)),
    [active]
  );

  return {
    activeProviderId: active?.id ?? null,
    activeProviderLabel: active?.label ?? null,
    isCapabilityAction: (name: string) => allCapabilityNames.has(name),
    activeSupports: (name: string) => activeSupported.has(name),
    capabilityFor: (name: string) =>
      active?.capabilities.find((c) => c.capability === name) ?? null,
  };
}
