// Language display names in the pack's own language (Intl.DisplayNames), falling back to the code.
export function languageName(code: string, inLang: string): string {
  try {
    return new Intl.DisplayNames([inLang], { type: "language", fallback: "code" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
