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
  padding-top: 20px;
  padding-left: 10px;
  padding-bottom: 20px;
  box-sizing: border-box;
  &:empty:before {
    content: attr(placeholder);
    color: #54545480;
  }
  &:focus:before {
    content: none;
  }
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
        contentEditable={true}
        placeholder={placeholder}
      />
    );
  }
);

export default MdEditor;
