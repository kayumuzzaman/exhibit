export function downloadText(filename: string, mime: string, content: string): void {
  let objectUrl: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    objectUrl = URL.createObjectURL(new Blob([content], { type: mime }));
    anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } finally {
    try {
      anchor?.remove();
    } finally {
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }
}
