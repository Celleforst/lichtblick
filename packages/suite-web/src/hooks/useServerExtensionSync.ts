// Fetches .foxe extensions from /api/extensions and installs any that aren't already installed.
import { useEffect } from "react";

import { useExtensionCatalog } from "@lichtblick/suite-base/context/ExtensionCatalogContext";

type ServerExtension = { name: string; url: string };

export function useServerExtensionSync(): void {
  const installedExtensions = useExtensionCatalog((state) => state.installedExtensions);
  const installExtensions = useExtensionCatalog((state) => state.installExtensions);

  useEffect(() => {
    async function sync() {
      let serverExtensions: ServerExtension[];
      try {
        const res = await fetch("/api/extensions");
        if (!res.ok) return;
        serverExtensions = (await res.json()) as ServerExtension[];
      } catch {
        return;
      }
      if (serverExtensions.length === 0) return;

      const installedNames = new Set(
        (installedExtensions ?? []).map((e) => e.id),
      );

      const toInstall = serverExtensions.filter((ext) => !installedNames.has(ext.name.replace(".foxe", "")));
      if (toInstall.length === 0) return;

      const buffers = await Promise.all(
        toInstall.map(async (ext) => {
          const r = await fetch(ext.url);
          return { buffer: await r.arrayBuffer() };
        }),
      );
      await installExtensions("local", buffers);
    }
    void sync();
  }, [installedExtensions, installExtensions]);
}
