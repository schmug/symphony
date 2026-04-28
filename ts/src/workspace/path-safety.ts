import { resolve, sep, relative } from "node:path";
import { homedir } from "node:os";

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function slugifyIdentifier(identifier: string): string {
  const slug = identifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new Error(`Identifier produces empty slug: ${identifier}`);
  }
  return slug;
}

/**
 * Throws unless `candidate` resolves to a strict descendant of `root`.
 * Prevents `..` traversal and prevents operating on the root itself.
 */
export function assertChildPath(root: string, candidate: string): void {
  const absRoot = resolve(root);
  const absCandidate = resolve(candidate);
  if (absCandidate === absRoot) {
    throw new Error(`Refusing to operate on workspace root itself: ${absRoot}`);
  }
  const rel = relative(absRoot, absCandidate);
  if (!rel || rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
    throw new Error(
      `Path is not a descendant of root: candidate=${absCandidate} root=${absRoot}`,
    );
  }
}
