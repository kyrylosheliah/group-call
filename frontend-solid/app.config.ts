import { defineConfig } from "@solidjs/start/config";
import UnoCSS from "unocss/vite";
import fs from 'fs';

export default defineConfig({
  vite: () => ({
    plugins: [
      UnoCSS(),
    ],
  }),
  server: {
    https: {
      key: fs.readFileSync('../.ssl/key.pem', 'utf-8').toString(),
      cert: fs.readFileSync('../.ssl/cert.pem', 'utf-8').toString(),
    },
  },
});
