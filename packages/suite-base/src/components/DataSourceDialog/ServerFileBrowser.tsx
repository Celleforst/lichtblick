// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
  CircularProgress,
  Collapse,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import { useState, useEffect } from "react";

import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import Stack from "@lichtblick/suite-base/components/Stack";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useAppConfigurationValue } from "@lichtblick/suite-base/hooks/useAppConfigurationValue";

import View from "./View";

type ServerFile = {
  path: string;
  size: number;
};

type TreeNode = {
  name: string;
  fullPath: string;
  size?: number;
  children: Map<string, TreeNode>;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function buildTree(files: ServerFile[]): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", children: new Map() };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (!node.children.has(part)) {
        const fullPath = parts.slice(0, i + 1).join("/");
        node.children.set(part, { name: part, fullPath, children: new Map() });
      }
      node = node.children.get(part)!;
    }
    node.size = file.size;
  }
  return root;
}

const DATE_PREFIX = /^(\d{4})[-_](\d{2})[-_](\d{2})/;

function dateKey(name: string): string | undefined {
  const m = DATE_PREFIX.exec(name);
  return m != undefined ? `${m[1]}${m[2]}${m[3]}` : undefined;
}

function sortNodes(a: TreeNode, b: TreeNode): number {
  // files always after folders
  const aIsFile = a.size != undefined ? 1 : 0;
  const bIsFile = b.size != undefined ? 1 : 0;
  if (aIsFile !== bIsFile) return aIsFile - bIsFile;

  const aDate = dateKey(a.name);
  const bDate = dateKey(b.name);

  // both dated → newest first
  if (aDate != undefined && bDate != undefined) return bDate.localeCompare(aDate);
  // only one dated → dated comes first
  if (aDate != undefined) return -1;
  if (bDate != undefined) return 1;
  // neither dated → keep original order (stable sort)
  return 0;
}

type TreeNodeViewProps = {
  node: TreeNode;
  depth: number;
  selected: string | undefined;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
};

function TreeNodeView({ node, depth, selected, onSelect, onOpen }: TreeNodeViewProps): React.JSX.Element {
  const isFile = node.size != undefined;
  const [open, setOpen] = useState(false);

  if (isFile) {
    return (
      <ListItem disablePadding>
        <ListItemButton
          selected={selected === node.fullPath}
          onClick={() => { onSelect(node.fullPath); }}
          onDoubleClick={() => { onOpen(node.fullPath); }}
          sx={{ pl: depth * 2 + 1 }}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <InsertDriveFileIcon fontSize="small" color="action" />
          </ListItemIcon>
          <ListItemText primary={node.name} />
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {node.size != undefined ? formatBytes(node.size) : ""}
          </Typography>
        </ListItemButton>
      </ListItem>
    );
  }

  const children = [...node.children.values()];
  // sort: folders first, then files
  children.sort(sortNodes);

  return (
    <>
      <ListItem disablePadding>
        <ListItemButton onClick={() => { setOpen((v) => !v); }} sx={{ pl: depth * 2 + 1 }}>
          <ListItemIcon sx={{ minWidth: 32 }}>
            {open ? (
              <FolderOpenIcon fontSize="small" color="primary" />
            ) : (
              <FolderIcon fontSize="small" color="primary" />
            )}
          </ListItemIcon>
          <ListItemText primary={node.name} />
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </ListItemButton>
      </ListItem>
      <Collapse in={open} unmountOnExit>
        <List disablePadding>
          {children.map((child) => (
            <TreeNodeView
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ))}
        </List>
      </Collapse>
    </>
  );
}

export default function ServerFileBrowser(): React.JSX.Element {
  const [files, setFiles] = useState<ServerFile[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const { selectSource } = usePlayerSelection();
  const { dialogActions } = useWorkspaceActions();
  const [savedFilesUrl] = useAppConfigurationValue<string>(AppSetting.SERVER_FILES_URL);
  const filesBaseUrl = savedFilesUrl != undefined && savedFilesUrl.length > 0
    ? savedFilesUrl.replace(/\/$/, "")
    : `${window.location.origin}/bags`;

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

  const handleOpen = (path: string) => {
    const url = `${filesBaseUrl}/${path}`;
    selectSource("remote-file", { type: "connection", params: { url } });
    dialogActions.dataSource.close();
  };

  const tree = buildTree(files);
  const rootChildren = [...tree.children.values()].sort(sortNodes);

  return (
    <View onOpen={selected != undefined ? () => { handleOpen(selected); } : undefined}>
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
            {rootChildren.map((child) => (
              <TreeNodeView
                key={child.fullPath}
                node={child}
                depth={0}
                selected={selected}
                onSelect={setSelected}
                onOpen={handleOpen}
              />
            ))}
          </List>
        )}
      </Stack>
    </View>
  );
}
