import { StatusBadge } from "./status-badge";

export function ProviderBadge({
  providerKey,
  displayName,
  isDefault = false,
}: {
  providerKey: string;
  displayName?: string;
  isDefault?: boolean;
}) {
  return (
    <StatusBadge
      label={displayName ?? providerKey}
      tone={isDefault ? "primary" : "neutral"}
      dot={isDefault}
    />
  );
}
