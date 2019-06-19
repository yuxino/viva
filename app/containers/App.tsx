import * as React from 'react';
import { useRef, useState, useEffect } from 'react';
import { Layout, MdEditor, MdPreview, VivaTitleBar, Tabs } from '../components';
import { useDispatch } from 'redux-react-hook';
import ViewActions from '../actions/view';
import FileDrop from '../dnd/FileDrop';
import H5DnD from '../dnd/h5DnD';

function App() {
  const dispath = useDispatch();
  const updateEditorSyncFn = payload =>
    dispath({ type: ViewActions.UPDATE_EDITOR_SYNC_FN, payload });

  const [content, setContent] = useState('');

  const editorRef = useRef<HTMLDivElement>();
  const previewRef = useRef<HTMLDivElement>();

  // handle editor input
  const inputHandle = () => {
    const editor = editorRef.current;
    setContent(editor.innerText);
  };

  const edtiorSyncFn = content => {
    const editor = editorRef.current;
    editor.innerText = content;
    setContent(content);
  };

  const scrollHanlder = e => {
    const editor = editorRef.current;
    const preview = previewRef.current;

    setTimeout(() => {
      var percentage =
        editor.scrollTop / (editor.scrollHeight - editor.offsetHeight);
      var height = percentage * (preview.scrollHeight - preview.offsetHeight);
      preview.scrollTop = height;
    }, 0);
  };

  // async editor ref in reducer
  useEffect(() => {
    updateEditorSyncFn({ edtiorSyncFn });
  }, [editorRef]);

  return (
    <FileDrop>
      <Layout>
        <Layout.Header>
          <VivaTitleBar />
        </Layout.Header>
        <Layout.Container>
          <Layout.Sidebar />
          <Layout.View>
            <Tabs />
            <Layout.Container>
              <Layout.Left>
                <MdEditor
                  ref={editorRef}
                  onInput={inputHandle}
                  onScroll={scrollHanlder}
                  placeholder="type something here ..."
                />
              </Layout.Left>
              <Layout.Right>
                <MdPreview content={content} ref={previewRef} />
              </Layout.Right>
            </Layout.Container>
          </Layout.View>
        </Layout.Container>
      </Layout>
    </FileDrop>
  );
}

export default H5DnD(App);
