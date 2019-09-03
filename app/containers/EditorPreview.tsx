import * as React from 'react';
import { useRef, useState, useEffect } from 'react';
import { useDispatch } from 'redux-react-hook';
import { Layout, MdEditor, MdPreview } from '../components';
import ViewActions from '../actions/View';

export default function() {
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

    // scroll target
    const t1 = e.target === editor ? editor : preview;
    const t2 = t1 === editor ? preview : editor;

    setTimeout(() => {
      const percentage = t1.scrollTop / (t1.scrollHeight - t1.offsetHeight);
      const height = percentage * (t2.scrollHeight - t2.offsetHeight);
      t2.scrollTop = height;
    }, 0);
  };

  // async editor ref in reducer
  useEffect(() => {
    updateEditorSyncFn({ edtiorSyncFn });
  }, [editorRef]);

  return (
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
        <MdPreview
          content={content}
          ref={previewRef}
          onScroll={scrollHanlder}
        />
      </Layout.Right>
    </Layout.Container>
  );
}
