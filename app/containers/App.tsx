import * as React from 'react';
import { Layout, Tabs, WorkBench } from '../components';
import FileDrop from '../dnd/FileDrop';
import H5DnD from '../dnd/h5DnD';
import EditorPreview from './EditorPreview';
import Header from './Header';
import Bootstrap from './Bootstrap';
import { Dialog } from '@viva-ui/ui';

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

function App() {
  return (
    <FileDrop>
      <Layout>
        <Header />
        <Layout.Container>
          <Layout.Sidebar />
          <WorkBench />
          <Layout.View>
            <Tabs />
            <EditorPreview />
            <Bootstrap />
          </Layout.View>
        </Layout.Container>
        <Dialog title="viva editor" />
      </Layout>
    </FileDrop>
  );
}

export default H5DnD(App);
