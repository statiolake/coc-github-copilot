#!/usr/bin/env node
/**
 * Custom script to detect 'as' type casts in TypeScript files
 * This is a temporary solution until Biome supports comprehensive type cast detection
 */

const fs = require("node:fs");
const path = require("node:path");

const EXCLUDED_PATTERNS = [
  /\/\/ TODO: Remove when/, // TODOコメント付きは許可
  /\/\/ FIXME:/, // FIXMEコメント付きは許可
  /import \* as /, // import * as は許可
  /`[^`]*as/, // テンプレートリテラル内の文字列は許可
  /"[^"]*as[^"]*"/, // 文字列内の "as" は許可
  /'[^']*as[^']*'/, // 文字列内の 'as' は許可
  /as Record<string, unknown>/, // Record<string, unknown>は許可（型ガード内）
  /as const/, // as const は許可（定数アサーション）
  /extensions as any/, // extensions as any は許可（coc.nvimの型定義が不足）
];

function checkTypeAssertion(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const violations = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // " as " パターンを検出
    if (
      trimmed.includes(" as ") &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("*")
    ) {
      // 除外パターンをチェック
      const isExcluded = EXCLUDED_PATTERNS.some((pattern) =>
        pattern.test(line),
      );

      if (!isExcluded) {
        violations.push({
          file: filePath,
          line: index + 1,
          content: trimmed,
          message:
            "Type assertion detected. Consider using type guards or proper typing instead.",
        });
      }
    }
  });

  return violations;
}

function findTypeScriptFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);

  items.forEach((item) => {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && !["node_modules", "lib", "dist"].includes(item)) {
      files.push(...findTypeScriptFiles(fullPath));
    } else if (
      stat.isFile() &&
      item.endsWith(".ts") &&
      !item.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  });

  return files;
}

function main() {
  const srcDir = path.join(__dirname, "..", "src");
  const tsFiles = findTypeScriptFiles(srcDir);

  let totalViolations = 0;

  tsFiles.forEach((file) => {
    const violations = checkTypeAssertion(file);
    totalViolations += violations.length;

    violations.forEach((violation) => {
      console.log(`\x1b[33m${violation.file}:${violation.line}\x1b[0m`);
      console.log(`  ${violation.message}`);
      console.log(`  \x1b[90m${violation.content}\x1b[0m`);
      console.log("");
    });
  });

  if (totalViolations > 0) {
    console.log(
      `\x1b[31m✗ Found ${totalViolations} type assertion(s) that should be reviewed\x1b[0m`,
    );
    process.exit(1);
  } else {
    console.log("\x1b[32m✓ No problematic type assertions found\x1b[0m");
  }
}

main();
