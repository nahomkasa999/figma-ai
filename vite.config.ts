import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { existsSync, renameSync, rmdirSync } from "fs";
import { join } from "path";

const isCode = process.env.BUILD_TARGET === "code";

function flattenHtml(): import("vite").Plugin {
  return {
    name: "flatten-html",
    closeBundle() {
      if (isCode) return;
      const root = process.cwd();
      const oldPath = join(root, "dist", "src", "ui", "index.html");
      const newPath = join(root, "dist", "index.html");
      if (existsSync(oldPath)) {
        renameSync(oldPath, newPath);
        try { rmdirSync(join(root, "dist", "src", "ui")); } catch {}
        try { rmdirSync(join(root, "dist", "src")); } catch {}
      }
    },
  };
}

export default defineConfig({
  plugins: isCode ? [] : [viteSingleFile(), flattenHtml()],
  build: {
    outDir: "dist",
    emptyOutDir: isCode,
    minify: false,
    cssCodeSplit: false,
    target: "es2020",
    ...(isCode
      ? {
          lib: {
            entry: "src/code.ts",
            formats: ["cjs"],
            fileName: () => "code.js",
          },
        }
      : {
          rollupOptions: {
            input: "src/ui/index.html",
          },
        }),
  },
});
