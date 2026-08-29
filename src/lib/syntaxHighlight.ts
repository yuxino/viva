import highlight from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { LanguageFn } from "highlight.js";

interface LanguageDefinition {
  aliases: readonly string[];
  displayName: string;
  grammar: LanguageFn;
  name: string;
}

export interface HighlightedCode {
  className: string;
  html: string;
  label: string | null;
  language: string | null;
}

const languageDefinitions: readonly LanguageDefinition[] = [
  { name: "typescript", displayName: "TypeScript", aliases: ["ts", "tsx"], grammar: typescript },
  { name: "javascript", displayName: "JavaScript", aliases: ["js", "jsx", "mjs", "cjs"], grammar: javascript },
  { name: "dart", displayName: "Dart", aliases: [], grammar: dart },
  { name: "rust", displayName: "Rust", aliases: ["rs"], grammar: rust },
  { name: "python", displayName: "Python", aliases: ["py"], grammar: python },
  { name: "bash", displayName: "Shell", aliases: ["sh", "shell", "zsh"], grammar: bash },
  { name: "json", displayName: "JSON", aliases: ["jsonc"], grammar: json },
  { name: "yaml", displayName: "YAML", aliases: ["yml"], grammar: yaml },
  { name: "markdown", displayName: "Markdown", aliases: ["md", "mdx"], grammar: markdownLanguage },
  { name: "xml", displayName: "HTML / XML", aliases: ["html", "svg"], grammar: xml },
  { name: "css", displayName: "CSS", aliases: [], grammar: css },
  { name: "scss", displayName: "SCSS", aliases: ["sass"], grammar: scss },
  { name: "sql", displayName: "SQL", aliases: [], grammar: sql },
  { name: "java", displayName: "Java", aliases: [], grammar: java },
  { name: "kotlin", displayName: "Kotlin", aliases: ["kt", "kts"], grammar: kotlin },
  { name: "swift", displayName: "Swift", aliases: [], grammar: swift },
  { name: "go", displayName: "Go", aliases: ["golang"], grammar: go },
  { name: "c", displayName: "C", aliases: [], grammar: c },
  { name: "cpp", displayName: "C++", aliases: ["c++", "cc", "cxx", "h", "hpp"], grammar: cpp },
  { name: "csharp", displayName: "C#", aliases: ["cs", "c#"], grammar: csharp },
];

const languageNames = new Map<string, LanguageDefinition>();

for (const definition of languageDefinitions) {
  highlight.registerLanguage(definition.name, definition.grammar);
  if (definition.aliases.length) {
    highlight.registerAliases([...definition.aliases], {
      languageName: definition.name,
    });
  }
  languageNames.set(definition.name, definition);
  for (const alias of definition.aliases) languageNames.set(alias, definition);
}

function requestedLanguage(info: string): string | null {
  const token = info.trim().split(/\s+/u)[0]?.toLocaleLowerCase() ?? "";
  return token.replace(/^language-/u, "") || null;
}

function escapeCode(code: string): string {
  return code
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function highlightCode(code: string, info: string): HighlightedCode {
  const requested = requestedLanguage(info);
  const definition = requested ? languageNames.get(requested) : undefined;

  if (!definition) {
    return {
      className: "hljs language-plaintext",
      html: escapeCode(code),
      label: requested,
      language: null,
    };
  }

  return {
    className: `hljs language-${definition.name}`,
    html: highlight.highlight(code, {
      language: definition.name,
      ignoreIllegals: true,
    }).value,
    label: definition.displayName,
    language: definition.name,
  };
}
