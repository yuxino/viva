export function cx(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function joinIds(
  ...values: Array<string | null | undefined>
): string | undefined {
  const result = values.filter(Boolean).join(" ");
  return result || undefined;
}
