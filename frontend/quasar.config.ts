import { configure } from "quasar/wrappers";

export default configure(() => ({
  boot: ["pinia"],
  css: ["app.scss"],
  extras: ["roboto-font", "material-icons"],

  build: {
    target: { browser: ["es2022"], node: "node20" },
    typescript: {
      strict: true,
      vueShim: true,
    },
    vitePlugins: [],
  },

  devServer: {
    port: 9000,
    proxy: {
      "/api": { target: "http://127.0.0.1:8388", changeOrigin: true },
    },
  },

  framework: {
    config: {},
    // Notify - design-notes.md의 "notices piggyback"을 실제로 사람 눈에
    // 띄게 띄우는 용도(모든 액션 응답에 실려오는 메시지를 토스트로 보여준다).
    plugins: ["Notify"],
  },
}));
