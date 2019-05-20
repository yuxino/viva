import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import * as extend from '../styled/extend';
import styled from 'styled-components';
import MDPreview from './MDPreview';

const Container = styled.div`
  ${extend.hc};
  height: 100%;
`;

const Left = styled.div`
  flex: 1;
  overflow: hidden;
  border-right: 1px solid orange;
`;

const Right = styled.div`
  flex: 1;
  overflow: hidden;
`;

const Textarea = styled.div`
  ${extend.resetTextarea};
  font-size: 15px;
  height: 100%;
  width: 100%;
  line-height: 20px;
  padding-left: 10px;
  padding-top: 20px;
  box-sizing: border-box;
`;

function Layout({ children }) {
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

    let previewHeight = preview.scrollHeight - window.innerHeight;
    let editorHeight = editor.scrollHeight - window.innerHeight;

    if (previewHeight < 0) previewHeight = 0;
    if (editorHeight < 0) editorHeight = 0;

    const scale = previewHeight / editorHeight;

    let toY = editor.scrollTop * scale;
    if (toY <= 0) toY = 0;
    else if (toY >= previewHeight) toY = previewHeight;
    else if (editor.scrollTop >= editorHeight) toY = previewHeight;

    preview.scrollTop = toY;
  };

  return (
    <Container>
      <Left>
        <Textarea
          ref={editorRef}
          onInput={inputHandle}
          onScroll={scrollHanlder}
          contentEditable={true}
        />
      </Left>
      <Right>
        <MDPreview content={content} r={previewRef} />
      </Right>
    </Container>
  );
}

Layout.Left = Left;
Layout.Right = Right;
export default Layout;
