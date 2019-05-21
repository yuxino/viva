import * as React from 'react';
import styled from 'styled-components';
import * as extend from '../styled/extend';

interface MdEditorProps {
  onInput(event?): void;
  onScroll(event?): void;
}

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

const MdEditor = React.forwardRef(
  ({ onInput, onScroll }: MdEditorProps, ref: React.Ref<HTMLDivElement>) => {
    return (
      <Textarea
        ref={ref}
        onInput={onInput}
        onScroll={onScroll}
        contentEditable={true}
      />
    );
  }
);

export default MdEditor;
