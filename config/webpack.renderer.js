const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  mode: "development",
  entry: `./src/renderer.ts`,
  target: "electron-renderer",
  output: {
    path: path.resolve(__dirname, "../.tmp"),
    filename: "renderer.js",
  },
  stats: "none",
  devServer: {
    noInfo: true,
    quiet: true,
    port: 8080,
    hot: true,
    watchContentBase: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  plugins: [
    new HtmlWebpackPlugin({
      filename: "./index.html",
      template: "./index.html",
    }),
  ],
  watchOptions: {
    ignored: /node_modules/,
  },
};
