// Must be imported before @excalidraw/excalidraw so asset resolution uses bundled offline fonts.
(globalThis as {EXCALIDRAW_ASSET_PATH?: string}).EXCALIDRAW_ASSET_PATH =
  './excalidraw-assets/';
