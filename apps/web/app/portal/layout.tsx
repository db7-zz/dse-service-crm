import type { ReactNode } from "react";
import { PortalShell } from "../../src/portal/portal-shell";

export default function Layout({ children }: { children: ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
