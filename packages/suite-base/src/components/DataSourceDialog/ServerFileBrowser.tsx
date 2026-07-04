// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import { useState, useEffect } from "react";

import Stack from "@lichtblick/suite-base/components/Stack";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";

import View from "./View";

type ServerFile = {
  path: string;
  size: number;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function ServerFileBrowser(): React.JSX.Element {
  const [files, setFiles] = useState<ServerFile[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const { selectSource } = usePlayerSelection();
  const { dialogActions } = useWorkspaceActions();

  useEffect(() => {
    fetch("/api/server-files")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return (await r.json()) as ServerFile[];
      })
      .then((data) => {
        setFiles(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  const handleOpen = () => {
    if (selected == undefined) return;
    const url = `${window.location.origin}/bags/${selected}`;
    selectSource("remote-file", { type: "connection", params: { url } });
    dialogActions.dataSource.close();
  };

  return (
    <View onOpen={selected != undefined ? handleOpen : undefined}>
      <Stack paddingX={4} paddingTop={4} gap={2} flexGrow={1} overflow="hidden">
        <Typography variant="h5">Open server file</Typography>
        {loading && (
          <Stack alignItems="center" padding={4}>
            <CircularProgress />
          </Stack>
        )}
        {error != undefined && <Typography color="error">{error}</Typography>}
        {!loading && error == undefined && files.length === 0 && (
          <Typography color="text.secondary">No .bag or .mcap files found on server.</Typography>
        )}
        {!loading && error == undefined && files.length > 0 && (
          <List dense disablePadding sx={{ overflowY: "auto", flexGrow: 1 }}>
            {files.map((file) => {
              const parts = file.path.split("/");
              const filename = parts[parts.length - 1] ?? file.path;
              const folder = parts.slice(0, -1).join("/");
              return (
                <ListItem key={file.path} disablePadding>
                  <ListItemButton
                    selected={selected === file.path}
                    onClick={() => {
                      setSelected(file.path);
                    }}
                    onDoubleClick={handleOpen}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      {folder.length > 0 ? (
                        <FolderIcon fontSize="small" color="action" />
                      ) : (
                        <InsertDriveFileIcon fontSize="small" color="action" />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={filename}
                      secondary={folder.length > 0 ? folder : undefined}
                      secondaryTypographyProps={{ noWrap: true }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1, flexShrink: 0 }}>
                      {formatBytes(file.size)}
                    </Typography>
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </Stack>
    </View>
  );
}
