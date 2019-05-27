import * as React from 'react';
import { useRef, useState, useEffect } from 'react';
import { Layout, MdEditor, MdPreview, VivaTitleBar } from '../components';
import { readFile } from 'fs-extra';

export default () => {
  const [content, setContent] = useState('');
  const editorRef = useRef<HTMLDivElement>();
  const previewRef = useRef<HTMLDivElement>();

  // init editor content
  useEffect(() => {
    const editor = editorRef.current;
    editor.innerText = content;
    editor.focus();

    document
      .getElementById('root')
      .addEventListener('drop', async function(event) {
        event.preventDefault();
        // single file ...
        const file = event.dataTransfer.files[0];
        const path = file.path;
        const buffer = await readFile(path);
        const content = buffer.toString();
        editor.innerText = content;
        setContent(content);
      });

    document.getElementById('root').addEventListener('dragover', function() {
      event.preventDefault();
    });
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
      <Layout.Header>
        <VivaTitleBar title="Untitled-1" />
      </Layout.Header>
      <Layout.Container>
        <Layout.Sidebar />
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
    </Layout>
  );
};
