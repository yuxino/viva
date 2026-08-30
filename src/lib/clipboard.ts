export async function writeClipboardText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand?.("copy") ?? false;
    textarea.remove();
    return copied;
  }
}

export async function readClipboardText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export async function readClipboardImage(): Promise<File | null> {
  const clipboard = navigator.clipboard;
  if (typeof clipboard?.read !== "function") return null;

  try {
    const items = await clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (!type.startsWith("image/")) continue;
        try {
          const blob = await item.getType(type);
          return new File([blob], "clipboard-image", {
            type: blob.type || type,
          });
        } catch {
          // Try another image representation before falling back to text.
        }
      }
    }
  } catch {
    // Text paste still has its existing permission/error fallback below.
  }
  return null;
}
