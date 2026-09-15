# Focused File Explorer UI

## Status

Implementation specification for adapting
[`/.prototypes/file-nav-ux.html`](../../../.prototypes/file-nav-ux.html) into the
production React frontend.

The prototype is the visual and interaction reference. This document defines
which parts of it become production behavior and how they connect to the
existing frontend. When the prototype uses sample data or a fake interaction,
this document takes precedence.

## Goal

Replace the current expandable file tree with the prototype's calm,
folder-focused browser. The Files panel must show one directory at a time,
provide breadcrumbs and visible creation actions, distinguish selection from
the file open in the editor, and support inline create and rename flows.

The result should feel like the Focus Browser prototype while continuing to use
the application's real project tree, permissions, theme, tabs, collaboration,
and file mutation functions.

## Scope

Implement the following prototype changes:

- Folder-focused navigation showing only the current directory's immediate
  children.
- Project header, editing/view-only status, theme button, and explorer options.
- New File, New Folder, and Upload toolbar.
- Breadcrumb navigation and an item-count caption.
- Large file/folder rows with icon, name, descriptive metadata, overflow menu,
  and distinct selected, focused, and active appearances.
- Inline file/folder creation and rename, including inline validation errors.
- Empty-folder presentation.
- Context menus that stay within the viewport.
- Success/error toast feedback.
- Resizable sidebar with the prototype's desktop dimensions.
- The prototype's narrow-screen Files-panel behavior.
- The adjacent activity-rail styling and existing open/close behavior needed to
  make the Files panel composition match the prototype.
- Light and dark explorer palettes matching the prototype.

Do not replace the existing Assistant, API Keys, Collaborators, editor, tab bar,
or status UI with the prototype's placeholder content. Those placeholders exist
only to demonstrate panel switching.

## Explicit non-goals

This work must not expand into the broader explorer backlog described in
`docs/specs/frontend/file-nav-ux.md`. In particular, do not add:

- Drag-and-drop, moving, cut/copy/paste, or multi-selection.
- Search, filtering, type-ahead, or new sorting rules.
- A comprehensive IDE keyboard-shortcut system.
- Undo/trash semantics.
- Generic asset upload or multi-file upload unless the existing backend already
  supports it without backend changes.
- New backend endpoints or schema changes.
- Fake sync failures, fake progress percentages, or hard-coded recent
  operations from the prototype.
- A redesign of Monaco, the editor workspace, tabs, chat, collaborators, or API
  key management.
- Unrelated reliability cleanup. Modify existing mutation behavior only where
  required for the inline explorer flows to report success or failure correctly.

## Production interpretation of the prototype

### Real state replaces prototype controls

- The header's mode is derived from the project role. Show **View only · Changes
  disabled** for viewers and **Editing · Folder-focused browser** otherwise.
- View-only mode is not toggleable from the explorer options menu.
- The theme button uses `ThemeContext`; it must not manipulate the document
  theme independently. Activating it switches the stored preference to the
  opposite of the currently resolved light/dark theme.
- The header displays the real project name. Load it through the existing
  `GET /projects/v1/projects/:id` endpoint or an equivalent existing source. Do
  not display the project UUID as a fallback title. While the name is loading,
  use the neutral label `Project`.
- Existing Activity Bar panel registrations and destinations remain intact.
  The prototype names and placeholder panels must not replace them.

### Prototype-only and unsupported actions

- Keep the existing single-image upload capability and accepted MIME types.
  Label the control **Upload image**, not **Upload files**, unless generic upload
  is already supported when implementation begins.
- The context menu may display Duplicate and Download to preserve the prototype
  composition, but they must be disabled and labeled unavailable until backed
  by real behavior. Do not ship clickable no-op commands.
- Copy Relative Path must be enabled and copy a path calculated from the root of
  the displayed project tree.
- Delete continues through the existing confirmation modal. The prototype's
  nonfunctional direct-delete button does not override that safeguard.
- Include an Operations section only when it can show a real operation from the
  current browser session. At minimum, an in-progress or failed upload may be
  shown. Use an indeterminate state if exact progress is unavailable. Hide the
  entire section when there are no real operations; never render the sample
  upload or sync error.
- The prototype's `Reset folder view` command points to a hard-coded sample
  directory and must be omitted. Provide **Return to project root** only.

## Browser behavior

### Current directory

- On initial tree load, the current directory is the first root directory in
  `treeData`.
- Render only the current directory's immediate child directories and files.
- A folder row is selected with one click and opened with a double-click.
- A file row is selected and opened in the editor with one click.
- The overflow button and context-click select their row without opening the
  file or folder.
- Breadcrumb segments navigate directly to any ancestor, including the root.
- **Return to project root** navigates to the first root directory.
- On entering another directory, select and focus its first visible child. If
  it has no children, clear row selection and show the empty state.
- The current directory is independent from the active editor file. Opening a
  file must not automatically navigate the browser when another file becomes
  active through the tab bar.

If a tree refresh removes the current directory, move to its nearest surviving
ancestor, falling back to the first root directory. Preserve current directory,
selection, and focus by stable IDs across ordinary refreshes. Clear a selected
or focused ID only if it no longer exists in the current directory.

### Row state

Maintain these states separately:

- `currentDirectoryId`: directory whose children are displayed.
- `selectedNodeId`: row targeted by row actions.
- `focusedNodeId`: row carrying roving DOM focus.
- `activeFileId`: file currently displayed by the editor; this remains owned by
  `EditorView`/the tab manager.
- `edit`: either no edit, an inline creation, or an inline rename, with pending
  and error details.
- `contextMenu`: menu target and viewport position, or closed.

Their appearance must match the prototype:

- Selection uses the filled green-tinted surface and subtle border.
- The active file uses the short green bar at the left edge.
- Focus uses the inset warm-colored outline.
- A row may be selected, focused, and active simultaneously.
- Long names truncate with an ellipsis without displacing the overflow button.
  Expose the full name with a `title` or equivalent accessible label.

Use stable backend IDs as the source of truth. Do not infer identity from names
or paths.

### Display labels and icons

- Folders use the green folder treatment from the prototype.
- Files use a consistent non-emoji icon treatment. Use the already-installed
  `react-icons` package or local SVGs.
- File metadata should be derived from the actual type. At minimum support
  LaTeX source, bibliography, image, PDF, plain text, and a generic file label.
- Folder metadata is **Folder · open to browse** when it has children and
  **Empty folder** otherwise.
- The caption is `<count> item(s) in <directory name>` with correct singular and
  plural wording.

## Create and rename

Creation and rename happen inline; remove the use of `CreateItemModal` and
`RenameModal` from the Files panel. `DeleteConfirmModal` remains.

### Create

- New File and New Folder create inside the current directory.
- Starting creation appends a temporary row to the visible list and immediately
  focuses its input.
- Use placeholders `chapter.tex` for a file and `folder-name` for a folder.
- Only one inline create or rename may be active at a time.
- Submitting trims surrounding whitespace and calls the existing mutation
  function with the current directory ID.
- On success, close the input and select/focus the newly created item. A newly
  created file retains the existing behavior of opening in a tab.

### Rename

- Rename is available from the row menu and context menu.
- Replace the selected row's name with an input rather than opening a modal.
- Prepopulate the current name. For files, initially select only the basename;
  keep the final extension outside the selection. For folders, select the full
  name.
- On success, preserve selection and focus on the renamed ID. If it is the
  active file, update the corresponding tab title and stored file data.

### Commit, cancel, validation, and failures

- Enter commits an inline edit.
- Escape cancels it without making a request.
- Moving focus away from the inline input cancels it, matching the prototype.
- Reject an empty trimmed name locally with `A name is required`.
- Reject a case-insensitive duplicate among the current directory's immediate
  children with `That name already exists here`.
- While a mutation is pending, keep the row visible, disable repeated submit,
  and do not allow another edit to start.
- If the server rejects the mutation, keep the input open and show the returned
  message inline followed by `— edit and press Enter to retry`.
- Mutation failures are local explorer errors. They must not replace the entire
  editor with the initial-load error screen.
- On success, announce `Saved <name>` through the toast/status region.

Mutation functions used by the Files panel must return or throw enough
information for the panel to distinguish success from failure. Do not close an
inline editor merely because a caught error was converted to `null` or
`undefined`.

## Menus

Every visible row has an overflow button, and context-click opens the same menu.

Folder menu:

1. Open folder
2. Separator
3. Rename
4. Duplicate — disabled/unavailable
5. Copy relative path
6. Download — disabled/unavailable
7. Separator
8. Delete

File menu:

1. Rename
2. Duplicate — disabled/unavailable
3. Copy relative path
4. Download — disabled/unavailable unless existing production behavior supports
   it
5. Separator
6. Delete

The explorer-options menu contains only production-valid commands:

1. A noninteractive indication of Editing or View only
2. Return to project root

Menu behavior:

- Opening a menu selects its target.
- Position row-button menus adjacent to the button and context menus at the
  pointer.
- Clamp the menu to an 8px viewport inset.
- Move focus to the first enabled command on open.
- Escape and outside pointer-down close the menu.
- Disabled commands cannot receive focus or activation and explain their state
  with a tooltip or accessible description.
- Restore focus to the invoking row or button when the menu closes when
  practical.

These menu interactions are part of faithfully implementing the prototype;
they do not imply adding the broader explorer keyboard shortcuts listed in the
older design document.

## Read-only behavior

When `readOnly` is true:

- Disable New File, New Folder, and Upload image.
- Disable Rename and Delete in every menu.
- Cancel an active inline edit if the role changes to read-only.
- Keep selection, folder navigation, opening files, breadcrumbs, Copy Relative
  Path, theme switching, panel switching, and resizing available.
- Use the prototype's disabled styling; do not merely suppress click handlers.

## Layout and visual design

### Desktop

- Default sidebar width: 350px.
- Minimum width: 260px.
- Maximum width: 520px.
- Sidebar is a fixed-width flex child and the editor consumes the remaining
  space with `min-width: 0`.
- Apply one editor-level sidebar width to Files, Assistant, and Collaborators so
  switching panels does not cause a width jump.
- Persist the last width per project in `localStorage`. Clamp restored values to
  the current limits.
- The resize handle is 8px wide, centered over the sidebar's right edge. It uses
  the green accent while hovered or dragged and exposes separator semantics and
  its current/min/max values.

Match the prototype's geometry:

- 50px activity rail with 38px square buttons.
- 18px serif project title and small mode line.
- 34px circular header/toolbar icon buttons.
- 36px minimum toolbar action height.
- 48px minimum rows, 34px rounded icon tiles, and 30px overflow buttons.
- 11px rounded rows, 12px menus, restrained borders, and the prototype's soft
  shadow treatment.

Use explorer-scoped design tokens based on the prototype rather than changing
the global application palette:

| Token | Light | Dark |
| --- | --- | --- |
| ink | `#17302c` | `#eef6f2` |
| muted | `#64746f` | `#9caaa5` |
| panel | `#eef2ed` | `#17211e` |
| card | `#ffffff` | `#202c28` |
| line | `#d6ddd7` | `#34423d` |
| brand | `#237966` | `#65c7ac` |
| brand soft | `#dcece7` | `#253f37` |
| selection | `#dbe8e3` | `#2c443c` |
| focus | `#bd6b30` | `#f1ac6d` |
| danger | `#b63f46` | `#ff8e92` |
| warning | `#a95723` | `#ffae6f` |

The explorer may use `color-mix()` as in the prototype, but provide a sensible
solid token fallback where loss of the mixed color would hide state.

Respect `prefers-reduced-motion: reduce`. Avoid adding motion not present in the
prototype.

### Narrow screens

At 720px and below:

- Keep the 50px activity rail visible.
- When the Files panel is open, it fills the remaining viewport width and the
  editor workspace is hidden.
- Hide the resize handle and ignore the stored desktop width.
- Increase row minimum height to 52px.
- Closing the active Files activity button reveals the editor workspace.
- Preserve the current directory and selection when opening or closing the
  panel.

Do not carry forward the current layout that stacks a 200px file tree above the
editor on narrow screens.

## Accessibility

- The activity rail remains a labeled navigation region and buttons expose
  their pressed state.
- Breadcrumbs are a `nav` labeled **Current folder**; the final segment uses
  `aria-current="page"`.
- The item container is a labeled listbox and rows are options with accurate
  `aria-selected` values, matching the prototype's one-directory-at-a-time
  interaction model.
- Only the focused row participates in the row tab stop. When rows change,
  ensure there is never more than one row with `tabIndex={0}`.
- Every icon-only control has an accessible name and tooltip.
- Inline errors are associated with their inputs and announced when they
  appear.
- Toasts use `role="status"`; failure announcements must not be hidden by color
  alone.
- Focus indicators must remain visible in both themes.

Do not introduce additional global shortcuts as part of this work. The focused
row, inline input, menu, and resize handle only need the local interactions
specified above and demonstrated by the prototype.

## Module seam and ownership

The Files panel should be a deep module: callers provide project data and real
application actions, while folder navigation, row state, menus, inline editing,
breadcrumbs, and rendering remain inside the module's implementation.

Its interface should remain close to:

```jsx
<FileBrowser
  projectName={projectName}
  treeData={treeData}
  activeFileId={activeFileId}
  readOnly={isReadOnly}
  actions={{
    openFile,
    createFile,
    createFolder,
    renameItem,
    deleteItem,
    uploadImage,
  }}
/>
```

The exact filenames are implementation choices, but ownership is not:

- `EditorView` owns project loading, role, active tabs, and wiring between
  modules. It must not absorb browser navigation logic.
- `useFileManager` owns server-backed tree/content mutations and refreshes.
- The file-browser module owns transient explorer interaction state.
- The tab manager remains the source of truth for the active/open tabs.
- Theme preference remains owned by `ThemeContext`.

Pure tree indexing helpers may live inside the file-browser module. Build a
single ID-index/parent-index representation per `treeData` update and use it for
children, breadcrumbs, relative paths, and refresh reconciliation rather than
duplicating recursive searches across event handlers.

## Existing integration points

The implementation will primarily touch:

- `frontend/src/components/Editor/FileTree.jsx` and `FileTree.css` — replace or
  rename as the new file-browser module.
- `frontend/src/views/EditorView.jsx` and `EditorView.css` — project metadata,
  sidebar width/layout, and wiring only.
- `frontend/src/hooks/useFileManager.js` — mutation outcomes required by inline
  editing.
- `frontend/src/api/editor.js` or `frontend/src/api/projects.js` — use the
  existing project-details endpoint for the real header name if no existing
  caller already exposes it.
- `frontend/src/components/Editor/ActivityBar.jsx` and `ActivityBar.css` — visual
  alignment with the prototype without changing registered panels.

Remove Files-panel imports/usages of `CreateItemModal` and `RenameModal` after
their inline replacements are complete. Do not delete shared files unless an
`rg` check confirms that nothing else uses them.

## Acceptance criteria

The change is complete when all of the following are true:

1. Opening a project shows its real name and real role above a folder-focused
   view of the root directory.
2. Only immediate children of the current directory are displayed, and
   breadcrumbs can return to every ancestor.
3. Folder single-click selects; folder double-click opens; file single-click
   selects and opens without conflating selected and active styling.
4. File, folder, empty-folder, long-name, selected, focused, active, light, dark,
   writable, and view-only states visually match the prototype.
5. New file, new folder, and rename use inline inputs. Success, local validation,
   server failure/retry, Escape cancellation, and blur cancellation work as
   specified.
6. Creating a file opens it. Renaming an open file immediately updates its tab.
7. Row and context menus use real targets, remain in the viewport, disable
   unsupported commands, copy a correct relative path, and preserve the existing
   delete confirmation.
8. No mutation control can be activated by a viewer.
9. The theme button goes through `ThemeContext`, and both theme palettes remain
   legible.
10. The sidebar resizes from 260px through 520px, persists per project, and all
    sidebar panels use the same width.
11. At 720px and below, the open Files panel occupies the space beside the
    activity rail and hides the editor until the Files button closes it.
12. No sample project names, files, operation records, fake failures, or fake
    percentages from the prototype appear in production.
13. Existing Assistant, API Keys, Collaborators, tabs, editor, image preview,
    collaboration, save, and activity-bar navigation continue to work.
14. `npm run build` succeeds from `frontend/` with no new warnings caused by the
    implementation.

## Manual verification route

Use a writable project containing nested folders, an empty folder, several file
types, and one long filename. Verify the acceptance criteria in both themes,
then repeat navigation and menu checks with a viewer account and at viewport
widths above and below 720px. Exercise a rejected duplicate name and a real
server-side failure to confirm that the inline editor remains available for
retry without replacing the entire editor screen.
