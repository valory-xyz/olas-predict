// Resolve hook for `node --experimental-strip-types --test`: maps the tsconfig path aliases
// to the repo root and resolves extensionless imports to `.ts` files, so tests can load the
// app's TypeScript modules as they are written. Registered by `scripts/ts-resolve.mjs`.
import { statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const ALIAS_PREFIXES = ['components/', 'constants/', 'hooks/', 'utils/', 'types/'];

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

export async function resolve(specifier, context, nextResolve) {
  const isAlias = specifier === 'types' || ALIAS_PREFIXES.some((p) => specifier.startsWith(p));
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!isAlias && !isRelative) return nextResolve(specifier, context);

  const target = isAlias
    ? new URL(specifier === 'types' ? 'types/index' : specifier, ROOT)
    : new URL(specifier, context.parentURL);
  const path = fileURLToPath(target);
  const file = [path, `${path}.ts`, `${path}/index.ts`].find(isFile);
  return nextResolve(file ? pathToFileURL(file).href : specifier, context);
}
