import * as React from 'react';
import { useRef, useState, useEffect } from 'react';
import { Layout, MdEditor, MdPreview, Sidebar } from '../components';

export default () => {
  const [content, setContent] = useState('content');
  const editorRef = useRef<HTMLDivElement>();
  const previewRef = useRef<HTMLDivElement>();

  // init editor content
  useEffect(() => {
    const editor = editorRef.current;
    editor.innerText = content;
  }, [editorRef]);

  // handle editor input
  const inputHandle = () => {
    const editor = editorRef.current;
    setContent(editor.innerText);
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

  return (
    <Layout>
      <Sidebar />
      <Layout.Left>
        <MdEditor
          ref={editorRef}
          onInput={inputHandle}
          onScroll={scrollHanlder}
        />
      </Layout.Left>
      <Layout.Right>
        <MdPreview content={content} ref={previewRef} />
      </Layout.Right>
    </Layout>
  );
};
