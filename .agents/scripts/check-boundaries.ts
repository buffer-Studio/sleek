/**
 * AST-based architectural boundary validator for Sleek's 5-tier hierarchy:
 * base -> platform -> core -> {adapters, modules} -> app
 * Enforces layer DAG, base/common purity, _internal/ encapsulation,
 * acyclic *.contract.ts inter-module imports, and Bun.env isolation.
 */

import {readdir} from 'node:fs/promises';
import {dirname, join, normalize, relative, resolve} from 'node:path';
import * as ts from 'typescript';

interface BoundaryViolation {
  readonly filePath: string;
  readonly line: number;
  readonly message: string;
}

const LAYER_ORDER: Readonly<Record<string, number>> = {
  base: 0,
  platform: 1,
  core: 2,
  adapters: 3,
  modules: 3,
  app: 4,
};

const violations: BoundaryViolation[] = [];

async function collectTsFiles(dir: string, out: string[] = []): Promise<string[]> {
  try {
    const entries = await readdir(dir, {withFileTypes: true});
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'build') {
          continue;
        }
        await collectTsFiles(fullPath, out);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        if (!entry.name.endsWith('.d.ts')) {
          out.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore missing directories
  }
  return out;
}

function getLayer(relPosix: string): string | undefined {
  const parts = relPosix.split('/');
  if (parts[0] !== 'src' || parts.length < 2) {
    return undefined;
  }
  return parts[1];
}

function getModuleName(relPosix: string): string | undefined {
  const parts = relPosix.split('/');
  if (parts[0] === 'src' && parts[1] === 'modules' && parts.length >= 3) {
    const mod = parts[2];
    if (mod !== undefined && !mod.endsWith('.ts')) {
      return mod;
    }
  }
  return undefined;
}

function resolveImportTarget(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const base = resolve(dirname(fromFile), specifier);
  const rel = relative(process.cwd(), base).replace(/\\/g, '/');
  return normalize(rel).replace(/\\/g, '/');
}

function checkFile(filePath: string, content: string): Map<string, string[]> {
  const relPosix = relative(process.cwd(), filePath).replace(/\\/g, '/');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const srcLayer = getLayer(relPosix);
  const srcModule = getModuleName(relPosix);
  const isTest = relPosix.endsWith('.test.ts') || relPosix.endsWith('.spec.ts');
  const contractEdges = new Map<string, string[]>();

  function addViolation(node: ts.Node, message: string): void {
    const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    violations.push({filePath: relPosix, line: line + 1, message});
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;

      if (relPosix.startsWith('src/base/common/')) {
        if (specifier.startsWith('node:') || specifier === 'bun' || specifier.startsWith('bun:')) {
          addViolation(
            node,
            `src/base/common/ must remain runtime-pure (disallowed import '${specifier}').`,
          );
        }
      }

      if (specifier === 'node:module' && relPosix !== 'src/adapters/native/addonLoader.ts') {
        addViolation(node, `Only src/adapters/native/addonLoader.ts may import 'node:module'.`);
      }

      const targetRel = resolveImportTarget(filePath, specifier);
      if (targetRel?.startsWith('src/') === true) {
        const targetLayer = getLayer(targetRel);

        if (srcLayer !== undefined && targetLayer !== undefined) {
          const srcRank = LAYER_ORDER[srcLayer];
          const targetRank = LAYER_ORDER[targetLayer];
          if (srcRank !== undefined && targetRank !== undefined) {
            if (targetRank > srcRank) {
              addViolation(
                node,
                `Layer violation: '${srcLayer}' cannot import from higher layer '${targetLayer}' ('${targetRel}').`,
              );
            }
            if (
              (srcLayer === 'adapters' && targetLayer === 'modules') ||
              (srcLayer === 'modules' && targetLayer === 'adapters')
            ) {
              addViolation(
                node,
                `Sibling isolation violation: '${srcLayer}' cannot import from '${targetLayer}'.`,
              );
            }
          }
        }

        if (relPosix.startsWith('src/base/common/') && targetRel.startsWith('src/base/bun/')) {
          addViolation(node, `src/base/common/ cannot import from src/base/bun/.`);
        }

        if (targetRel.includes('/_internal/')) {
          const targetModule = getModuleName(targetRel);
          if (targetModule !== undefined && targetModule !== srcModule) {
            addViolation(
              node,
              `Encapsulation violation: cannot import '${targetRel}' outside module '${targetModule}'.`,
            );
          }
        }

        const targetModule = getModuleName(targetRel);
        if (srcModule !== undefined && targetModule !== undefined && srcModule !== targetModule) {
          const isContract = targetRel.endsWith('.contract.ts') || targetRel.endsWith('.contract');
          if (!isContract) {
            addViolation(
              node,
              `Cross-module import must target '*.contract.ts' (got '${targetRel}').`,
            );
          } else {
            const list = contractEdges.get(srcModule) ?? [];
            list.push(targetModule);
            contractEdges.set(srcModule, list);
          }
        }

        if (targetRel.endsWith('/manifest.ts') || targetRel.endsWith('/manifest')) {
          if (!relPosix.startsWith('src/app/')) {
            addViolation(node, `Only src/app/ may import src/modules/manifest.ts.`);
          }
        }
      }
    }

    if (
      !isTest &&
      !relPosix.startsWith('src/platform/config/') &&
      ts.isPropertyAccessExpression(node)
    ) {
      const obj = node.expression;
      if (
        ts.isIdentifier(obj) &&
        (obj.text === 'Bun' || obj.text === 'process') &&
        node.name.text === 'env'
      ) {
        addViolation(
          node,
          `Environment access (${obj.text}.env) is restricted to src/platform/config/.`,
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return contractEdges;
}

function detectContractCycles(graph: Map<string, Set<string>>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (visiting.has(node)) {
      violations.push({
        filePath: `src/modules/${node}`,
        line: 1,
        message: `Circular module contract dependency detected: ${[...path, node].join(' -> ')}.`,
      });
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    for (const next of graph.get(node) ?? []) {
      dfs(next, [...path, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const mod of graph.keys()) {
    if (!visited.has(mod)) {
      dfs(mod, []);
    }
  }
}

async function run(): Promise<void> {
  const files = await collectTsFiles(join(process.cwd(), 'src'));
  const graph = new Map<string, Set<string>>();

  for (const file of files) {
    const content = await Bun.file(file).text();
    const edges = checkFile(file, content);
    for (const [srcMod, targets] of edges.entries()) {
      const set = graph.get(srcMod) ?? new Set<string>();
      for (const t of targets) {
        set.add(t);
      }
      graph.set(srcMod, set);
    }
  }

  detectContractCycles(graph);

  if (violations.length > 0) {
    console.error(`\nFound ${violations.length} architectural boundary violation(s):\n`);
    for (const v of violations) {
      console.error(`${v.filePath}:${v.line} - error BOUNDARY: ${v.message}`);
    }
    process.exit(31);
  }

  console.log(`Boundary Check: ${files.length} files verified with 0 violations.`);
  process.exit(0);
}

void run();
