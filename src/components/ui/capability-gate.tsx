import { hasCapability, type CapabilityDescriptor, type CapabilityFlag } from "@/shared";

export function CapabilityGate({
  descriptor,
  requires,
  fallback = null,
  children,
}: {
  descriptor: CapabilityDescriptor | null | undefined;
  requires: CapabilityFlag;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!descriptor || !hasCapability(descriptor, requires)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
