/**
 * Linter validating Google TypeScript Style (GTS) and TypeScript Compiler critical invariants:
 * 1. Bans test isolation shortcuts (describe.only, it.only, test.only) [GTS001].
 * 2. Bans legacy 'var' declarations (enforcing 'const' or 'let') [GTS002].
 * 3. Enforces strict equality (=== / !==), allowing == null / != null [GTS003, GTS004].
 * 4. Checks for trailing whitespace [GTS005].
 * 5. Bans 'const enum' (tsguide.md) [GTS006].
 * 6. Bans throwing primitives or object literals (tsguide.md: only throw Error) [GTS007].
 * 7. Bans mutable exports (export let / export var) (tsguide.md) [GTS008].
 * 8. Bans top-level exported arrow functions (mandate 'export function') (tsguide.md & vscode.wiki) [GTS009].
 * 9. Bans 'I' prefix in interface names (Coding-guidelines.md) [GTS010].
 */

import {readdir} from 'node:fs/promises';
import {join, relative} from 'node:path';
import * as ts from 'typescript';

interface GTSDiagnostic {
  readonly filePath: string;
  readonly line: number;
  readonly col: number;
  readonly code: string;
  readonly message: string;
}

const diagnostics: GTSDiagnostic[] = [];
let scannedCount = 0;

async function collectFiles(dir: string, fileList: string[] = []): Promise<string[]> {
  try {
    const entries = await readdir(dir, {withFileTypes: true});
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.refs' ||
          entry.name === '.git' ||
          entry.name === 'archive' ||
          entry.name === 'upstream' ||
          entry.name === 'build'
        ) {
          continue;
        }
        await collectFiles(fullPath, fileList);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        if (!entry.name.endsWith('.d.ts')) {
          fileList.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore non-existent directories
  }
  return fileList;
}

function checkAST(sourceFile: ts.SourceFile, relPath: string): void {
  function visit(node: ts.Node): void {
    // 1. GTS Rule: No .only in test suites
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === 'only') {
        const expr = node.expression;
        if (
          ts.isIdentifier(expr) &&
          (expr.text === 'describe' || expr.text === 'it' || expr.text === 'test')
        ) {
          const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          diagnostics.push({
            filePath: relPath,
            line: line + 1,
            col: character + 1,
            code: 'GTS001',
            message: 'Forbidden test isolation modifier (.only). Do not commit focused tests.',
          });
        }
      }
    }

    // 2. GTS Rule: No 'var' declarations
    if (ts.isVariableDeclarationList(node)) {
      const isConstOrLet = (node.flags & ts.NodeFlags.BlockScoped) !== 0;
      if (!isConstOrLet) {
        const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        diagnostics.push({
          filePath: relPath,
          line: line + 1,
          col: character + 1,
          code: 'GTS002',
          message: "Forbidden 'var' keyword. Use 'const' or 'let'.",
        });
      }
    }

    // 3. GTS Rule: Strict equality (=== and !==)
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
        const isNullCheck =
          node.right.kind === ts.SyntaxKind.NullKeyword ||
          node.left.kind === ts.SyntaxKind.NullKeyword ||
          (ts.isIdentifier(node.right) && node.right.text === 'undefined') ||
          (ts.isIdentifier(node.left) && node.left.text === 'undefined');

        if (!isNullCheck) {
          const {line, character} = sourceFile.getLineAndCharacterOfPosition(
            node.operatorToken.getStart(),
          );
          const code = op === ts.SyntaxKind.EqualsEqualsToken ? 'GTS003' : 'GTS004';
          const opStr = op === ts.SyntaxKind.EqualsEqualsToken ? '==' : '!=';
          const fixStr = op === ts.SyntaxKind.EqualsEqualsToken ? '===' : '!==';
          diagnostics.push({
            filePath: relPath,
            line: line + 1,
            col: character + 1,
            code,
            message: `Use strict equality (${fixStr}) instead of loose equality (${opStr}).`,
          });
        }
      }
    }

    // 4. GTS Rule: No const enum (tsguide.md)
    if (ts.isEnumDeclaration(node)) {
      const isConst = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ConstKeyword);
      if (isConst) {
        const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        diagnostics.push({
          filePath: relPath,
          line: line + 1,
          col: character + 1,
          code: 'GTS006',
          message: "Forbidden 'const enum'. Use string literal union or standard enum.",
        });
      }
    }

    // 5. GTS Rule: Only throw Error instances (no primitives or object literals)
    if (ts.isThrowStatement(node)) {
      const expr = node.expression;
      const isLiteral =
        ts.isStringLiteral(expr) ||
        ts.isNoSubstitutionTemplateLiteral(expr) ||
        ts.isTemplateExpression(expr) ||
        ts.isNumericLiteral(expr) ||
        ts.isObjectLiteralExpression(expr) ||
        expr.kind === ts.SyntaxKind.TrueKeyword ||
        expr.kind === ts.SyntaxKind.FalseKeyword ||
        expr.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(expr) && expr.text === 'undefined');

      if (isLiteral) {
        const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        diagnostics.push({
          filePath: relPath,
          line: line + 1,
          col: character + 1,
          code: 'GTS007',
          message:
            'Only throw instances of Error (or subclasses). Do not throw strings, plain objects, or primitives.',
        });
      }
    }

    // 6. GTS Rule: No mutable exports (export let / export var)
    // 7. GTS & VS Code Rule: No exported arrow functions at top-level
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
      if (isExported) {
        const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
        if (!isConst) {
          const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          diagnostics.push({
            filePath: relPath,
            line: line + 1,
            col: character + 1,
            code: 'GTS008',
            message:
              'Forbidden mutable export (export let / export var). Use const export or accessor functions.',
          });
        }

        // Check for exported arrow functions
        for (const decl of node.declarationList.declarations) {
          if (
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
          ) {
            const {line, character} = sourceFile.getLineAndCharacterOfPosition(decl.getStart());
            diagnostics.push({
              filePath: relPath,
              line: line + 1,
              col: character + 1,
              code: 'GTS009',
              message:
                "Exported function must use 'export function name(...) { ... }' declaration syntax instead of arrow function assignment.",
            });
          }
        }
      }
    }

    // 8. TS Compiler Rule: No 'I' prefix on interface names
    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      if (
        name.length > 2 &&
        name.startsWith('I') &&
        /^[A-Z]/.test(name.slice(1)) &&
        name !== 'IDisposable'
      ) {
        const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.name.getStart());
        diagnostics.push({
          filePath: relPath,
          line: line + 1,
          col: character + 1,
          code: 'GTS010',
          message: `Forbidden 'I' prefix in interface name '${name}'. Use '${name.slice(1)}' (TypeScript Compiler Coding Guideline).`,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function checkWhitespace(content: string, relPath: string): void {
  const lines = content.split(/\r?\n/);
  lines.forEach((lineText, idx) => {
    if (/\s+$/.test(lineText)) {
      diagnostics.push({
        filePath: relPath,
        line: idx + 1,
        col: lineText.length,
        code: 'GTS005',
        message: 'Trailing whitespace detected. GTS forbids trailing whitespace.',
      });
    }
  });
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const files: string[] =
    args.length > 0
      ? args.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      : [
          ...(await collectFiles(join(process.cwd(), 'src'))),
          ...(await collectFiles(join(process.cwd(), '.agents', 'scripts'))),
        ];

  for (const file of files) {
    try {
      const content = await Bun.file(file).text();
      const relPath = relative(process.cwd(), file).replace(/\\/g, '/');
      scannedCount++;

      const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
      checkAST(sourceFile, relPath);
      checkWhitespace(content, relPath);
    } catch (err) {
      console.error(`Failed to read ${file}:`, err);
    }
  }

  if (diagnostics.length > 0) {
    console.error(`\nFound ${diagnostics.length} style & compiler guideline violations:\n`);
    for (const d of diagnostics) {
      console.error(`${d.filePath}:${d.line}:${d.col} - error ${d.code}: ${d.message}`);
    }
    process.exit(30);
  }

  console.log(`GTS Style Check: ${scannedCount} files verified with 0 violations.`);
  process.exit(0);
}

void run();
