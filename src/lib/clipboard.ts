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
