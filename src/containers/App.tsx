import * as React from "react";
import { Layout, Tabs, WorkBench } from "../components";
// import FileDrop from "../dnd/FileDrop";
// import H5DnD from "../dnd/h5DnD";
import EditorPreview from "./EditorPreview";
import Header from "./Header";
import Bootstrap from "./Bootstrap";
import { Dialog } from "@viva-ui/ui";

// TODO: 待删除
import { store } from "../store/configureStore";
import ViewActions from "../actions/View";

/**
 * APP Layout ⤵️
 *
 * FileDrop
 * |> Header
 * |> Sidebar
 * |> Workbench
 * |> Main
 *     |> tabs
 *     |> EditorPreview | Bootstrap
 */

export default function App() {
  // TODO: 待删除
  const fileInfo = { path: "/Users/gavin/Desktop/测试文件" };
  store.dispatch({
    type: ViewActions.OPEN_DIR,
    payload: { fileInfo },
  });

  // <FileDrop>
  // </FileDrop>

  return (
    <>
      <Layout>
        <Header />
        <Layout.Container>
          <Layout.Sidebar />
          <WorkBench />
          <Layout.View>
            {/* <Tabs /> */}
            <EditorPreview />
            <Bootstrap />
          </Layout.View>
        </Layout.Container>
        <Dialog title="viva editor" />
      </Layout>
    </>
  );
}

// export default () => <App />;
