import { isSafeUrl, parseMarkdown } from "@dsd/shared";
import type { Definition, Nodes, Root } from "mdast";
import type { ReactNode } from "react";

import { cn } from "./cn";

/*
 * Knowledge-base markdown rendered as React elements (NFR-7, ADR-0012).
 * The API sanitised the text when it was saved; this renderer still treats
 * it as untrusted:
 *
 * - it builds elements from the syntax tree and never sets HTML, so React
 *   escapes every piece of text;
 * - raw HTML in the source is shown as the literal text it is;
 * - every link and image URL is checked again with the shared `isSafeUrl`,
 *   the same function the sanitiser used. An unsafe link keeps its text and
 *   loses its destination; an unsafe image is dropped.
 *
 * Images from other origins aren't loaded (the page CSP allows images from
 * the app only); they become a link to the image instead.
 */

type Definitions = ReadonlyMap<string, Definition>;

export function Markdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const tree = parseMarkdown(source);
  const definitions = collectDefinitions(tree);
  return (
    <div className={cn("text-md leading-7 text-foreground", className)}>
      {renderChildren(tree, definitions)}
    </div>
  );
}

function collectDefinitions(tree: Root): Definitions {
  const map = new Map<string, Definition>();
  const visit = (node: Nodes) => {
    if (node.type === "definition") map.set(node.identifier, node);
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(tree);
  return map;
}

function renderChildren(node: Nodes, definitions: Definitions): ReactNode {
  if (!("children" in node)) return null;
  return node.children.map((child, index) => (
    // Markdown trees have no stable IDs, so a node's position is its key.
    <Node key={index} node={child} definitions={definitions} />
  ));
}

const isExternal = (url: string) => /^[a-z][a-z0-9+.-]*:/i.test(url.trim());

function SafeLink({
  url,
  title,
  children,
}: {
  url: string;
  title?: string | null | undefined;
  children: ReactNode;
}) {
  if (!isSafeUrl(url)) return <>{children}</>;
  const external =
    isExternal(url) && !url.trim().toLowerCase().startsWith("mailto:");
  return (
    <a
      href={url}
      title={title ?? undefined}
      className="font-medium text-primary underline decoration-primary/30 underline-offset-[3px] hover:decoration-primary"
      {...(external
        ? { target: "_blank", rel: "noopener noreferrer nofollow" }
        : {})}
    >
      {children}
    </a>
  );
}

function SafeImage({
  url,
  alt,
}: {
  url: string;
  alt: string | null | undefined;
}) {
  if (!isSafeUrl(url)) return null;
  const label = alt ?? "";
  if (isExternal(url)) {
    return (
      <SafeLink url={url}>
        {label === "" ? "View image" : `Image: ${label}`}
      </SafeLink>
    );
  }
  return (
    <img
      src={url}
      alt={label}
      loading="lazy"
      className="my-4 max-w-full rounded-md border border-border"
    />
  );
}

function Node({
  node,
  definitions,
}: {
  node: Nodes;
  definitions: Definitions;
}): ReactNode {
  const children = renderChildren(node, definitions);
  switch (node.type) {
    case "root":
      return <>{children}</>;
    case "paragraph":
      return <p className="my-4 first:mt-0 last:mb-0">{children}</p>;
    case "heading": {
      // The article title is the page's h1, so markdown headings start at h2.
      const level = Math.min(node.depth + 1, 6);
      const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag
          className={cn(
            "mt-8 mb-3 font-semibold tracking-tight first:mt-0",
            level === 2 ? "text-lg" : "text-md",
          )}
        >
          {children}
        </Tag>
      );
    }
    case "text":
      return node.value;
    case "emphasis":
      return <em>{children}</em>;
    case "strong":
      return <strong className="font-semibold">{children}</strong>;
    case "delete":
      return <del>{children}</del>;
    case "break":
      return <br />;
    case "inlineCode":
      return (
        <code className="rounded-sm border border-border bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {node.value}
        </code>
      );
    case "code":
      return (
        <pre className="my-4 overflow-x-auto rounded-md border border-border bg-muted px-4 py-3 font-mono text-sm leading-6">
          <code>{node.value}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote className="my-4 border-l-2 border-border-strong pl-4 text-muted-foreground">
          {children}
        </blockquote>
      );
    case "list": {
      const List = node.ordered === true ? "ol" : "ul";
      return (
        <List
          start={
            node.ordered === true && node.start !== null && node.start !== 1
              ? node.start
              : undefined
          }
          className={cn(
            "my-4 space-y-1.5 pl-6",
            node.ordered === true ? "list-decimal" : "list-disc",
            "marker:text-subtle",
          )}
        >
          {children}
        </List>
      );
    }
    case "listItem":
      return (
        <li className="pl-1 [&>p]:my-0">
          {node.checked === null || node.checked === undefined ? null : (
            <input
              type="checkbox"
              checked={node.checked}
              disabled
              aria-label={node.checked ? "Done" : "Not done"}
              className="mr-2 align-middle"
            />
          )}
          {children}
        </li>
      );
    case "thematicBreak":
      return <hr className="my-8 border-border" />;
    case "link":
      return (
        <SafeLink url={node.url} title={node.title}>
          {children}
        </SafeLink>
      );
    case "linkReference": {
      const definition = definitions.get(node.identifier);
      return definition === undefined ? (
        <>{children}</>
      ) : (
        <SafeLink url={definition.url} title={definition.title}>
          {children}
        </SafeLink>
      );
    }
    case "image":
      return <SafeImage url={node.url} alt={node.alt} />;
    case "imageReference": {
      const definition = definitions.get(node.identifier);
      return definition === undefined ? null : (
        <SafeImage url={definition.url} alt={node.alt} />
      );
    }
    case "definition":
      return null;
    case "html":
      // Raw HTML is never interpreted: show it as the text it is.
      return node.value;
    case "table":
      return (
        <div className="my-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {node.children.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-b border-border last:border-b-0"
                >
                  {row.children.map((cell, cellIndex) => {
                    const Cell = rowIndex === 0 ? "th" : "td";
                    return (
                      <Cell
                        key={cellIndex}
                        style={{
                          textAlign: node.align?.[cellIndex] ?? undefined,
                        }}
                        className={cn(
                          "px-3 py-2 align-top",
                          rowIndex === 0 && "bg-muted text-left font-semibold",
                        )}
                      >
                        {renderChildren(cell, definitions)}
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "footnoteReference":
      return <sup>[{node.label ?? node.identifier}]</sup>;
    case "footnoteDefinition":
      return (
        <div className="mt-4 flex gap-2 text-sm text-muted-foreground">
          <span>[{node.label ?? node.identifier}]</span>
          <div>{children}</div>
        </div>
      );
    default:
      return children;
  }
}
