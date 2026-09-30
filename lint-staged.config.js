const workspaceSource = /[\/](apps|packages)[\/].+\.(ts|tsx|js|mjs|cjs)$/;

/** @param {string[]} files */
const quote = (files) => files.map((file) => JSON.stringify(file)).join(" ");

/**
 * Formats every staged file, then lints the staged source files in the
 * workspaces. The two steps run one after the other because both may edit
 * the same file. ESLint picks up each file's own package config.
 */
export default {
  /** @param {string[]} files */
  "*": (files) => {
    const source = files.filter((file) => workspaceSource.test(file));
    return [
      `prettier --write --ignore-unknown ${quote(files)}`,
      ...(source.length > 0
        ? [`eslint --fix --no-warn-ignored ${quote(source)}`]
        : []),
    ];
  },
};
