const path = require("path");
const { spawn } = require("child_process");

module.exports = {
  mode: "development",
  entry: `./src/main.ts`,
  target: "electron-main",
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, "../dist"),
    filename: "main.js",
    publicPath: "./",
  },
  stats: "errors-only",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  watchOptions: {
    ignored: /node_modules/,
  },
  plugins: [
    {
      apply: (compiler) => {
        let program;
        compiler.hooks.assetEmitted.tap("AfterEmitPlugin", (compilation) => {
          program && program.kill("SIGHUP");
          program = spawn("yarn", ["start"], {
            shell: true,
            env: process.env,
            stdio: "inherit",
          });
        });
      },
    },
  ],
};
