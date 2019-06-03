import * as React from 'react';
import styled from 'styled-components';
import * as extend from '../styled/extend';

interface MdEditorProps {
  onInput(event?): void;
  onScroll(event?): void;
  placeholder?: string;
}

const Textarea = styled.div`
  ${extend.resetTextarea};
  font-size: 16px;
  height: 100%;
  width: 100%;
  line-height: 20px;
  padding-left: 10px;
  padding-bottom: 20px;
  box-sizing: border-box;
`;

const MdEditor = React.forwardRef(
  (
    { onInput, onScroll, placeholder }: MdEditorProps,
    ref: React.Ref<HTMLDivElement>
  ) => {
    return (
      <Textarea
        ref={ref}
        onInput={onInput}
        onScroll={onScroll}
        placeholder={placeholder}
        contentEditable={true}
      />
    );
  }
);

export default MdEditor;
