export function basename(path: string) {
  const parts = path.split(/[\\/]/);

  if (parts.length === 0) {
    throw Error(`Invalid path. Couldn't extract basename from ${path}`);
  }

  return parts.pop() || "";
}
