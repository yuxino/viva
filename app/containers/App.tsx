import * as React from 'react';
import { Layout, VivaTitleBar, Tabs, WorkBench } from '../components';
import FileDrop from '../dnd/FileDrop';
import H5DnD from '../dnd/h5DnD';
import EditorPreview from './EditorPreview';

/**
 * APP Layout ⤵️
 *
 * FileDrop
 * |> titlebar
 * |> sidebar
 *     |> workbench
       |> bottomIconGroup
 * |>  main
 *     |> tabs
 *     |> EditorPreview | Bootstrap
 */

function App() {
  return (
    <FileDrop>
      <Layout>
        <Layout.Header>
          <VivaTitleBar />
        </Layout.Header>
        <Layout.Container>
          <Layout.Sidebar />
          <WorkBench>213</WorkBench>
          <Layout.View>
            <Tabs />
            <EditorPreview />
          </Layout.View>
        </Layout.Container>
      </Layout>
    </FileDrop>
  );
}

export default H5DnD(App);
